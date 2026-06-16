import { searchBitMidi } from './BitMidiClient';
import { MIDIParser } from '../midi/MIDIParser';

interface MIDISearchResult {
  id: string;
  title: string;
  source: string;
  pageUrl: string;
  midiUrl: string;
  confidence: number;
  parsed?: ParsedMIDIInfo;
}

interface ParsedMIDIInfo {
  durationSec: number;
  tempoBpm: number;
  timeSig?: { num: number; den: number };
  tracks: TrackInfo[];
  noteCount: number;
  issues: string[];
}

interface TrackInfo {
  id: number;
  name?: string;
  program?: number;
  noteCount: number;
  channel?: number;
  register: 'low' | 'mid' | 'high';
}

export class MIDIService {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    // Production (Vercel): prefer same-origin API (no env var needed)
    // Dev: default to local backend on :3001
    const envUrl = (import.meta as any).env?.VITE_API_URL as string | undefined;
    const isDev = Boolean((import.meta as any).env?.DEV);

    if (baseUrl) {
      this.baseUrl = baseUrl;
    } else if (envUrl) {
      this.baseUrl = envUrl;
    } else if (isDev) {
      this.baseUrl = 'http://localhost:3001';
    } else {
      this.baseUrl = '';
    }
  }

  private async fetchWithRetry(url: string, init?: RequestInit, timeoutMs = 20000): Promise<Response> {
    const attempt = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        // iOS Safari can behave oddly with cached API responses; force no-store.
        return await fetch(url, {
          ...init,
          cache: 'no-store',
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeout);
      }
    };

    try {
      return await attempt();
    } catch (e) {
      // One fast retry for transient iOS/network hiccups.
      await new Promise(r => window.setTimeout(r, 200));
      return await attempt();
    }
  }

  async search(query: string): Promise<MIDISearchResult[]> {
    // Search BitMidi directly from the browser. BitMidi's JSON API is
    // CORS-enabled, so we skip the Vercel function entirely — which also fixes
    // the production outage where BitMidi rejected/garbled the server-side
    // HTML scrape from datacenter IPs. A thrown error here means the source is
    // unreachable; an empty array means no matches (handled separately in the UI).
    return await searchBitMidi(query);
  }

  async fetchMIDI(url: string): Promise<ArrayBuffer | null> {
    // BitMidi serves MIDI files with permissive CORS, so fetch them straight
    // from the browser. For any other host (e.g. arbitrary shared `?u=` links
    // on /play that may lack CORS) fall back to the SSRF-safe server proxy.
    if (this.isBitMidiUrl(url)) {
      try {
        const direct = await this.fetchWithRetry(url);
        if (direct.ok) {
          const buffer = await direct.arrayBuffer();
          if (buffer.byteLength >= 14) return buffer;
        }
      } catch {
        // fall through to the server proxy
      }
    }

    try {
      const response = await this.fetchWithRetry(`${this.baseUrl}/api/midi/fetch?u=${encodeURIComponent(url)}`);

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status}`);
      }

      return await response.arrayBuffer();
    } catch (error) {
      console.error('MIDI fetch error:', error);
      return null;
    }
  }

  async parseMIDI(url: string): Promise<ParsedMIDIInfo | null> {
    // Parse client-side off the fetched buffer so no server round-trip is
    // needed. Returns null on failure; callers fall back to parsing on select.
    try {
      const buffer = await this.fetchMIDI(url);
      if (!buffer) return null;

      const info = MIDIParser.getMIDIInfo(buffer);
      return {
        durationSec: info.duration,
        tempoBpm: info.tempo,
        tracks: [],
        noteCount: info.noteCount,
        issues: [],
      };
    } catch (error) {
      console.error('MIDI parse error:', error);
      return null;
    }
  }

  private isBitMidiUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'bitmidi.com' || host.endsWith('.bitmidi.com');
    } catch {
      return false;
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
