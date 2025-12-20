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

interface MIDISearchResponse {
  results: MIDISearchResult[];
  count: number;
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
    const response = await this.fetchWithRetry(`${this.baseUrl}/api/midi/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error(`Search failed: ${response.status}`);
    const data: MIDISearchResponse = await response.json();
    return data.results;
  }

  async fetchMIDI(url: string): Promise<ArrayBuffer | null> {
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
    try {
      const response = await this.fetchWithRetry(`${this.baseUrl}/api/midi/parse?u=${encodeURIComponent(url)}`);
      
      if (!response.ok) {
        throw new Error(`Parse failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('MIDI parse error:', error);
      return null;
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