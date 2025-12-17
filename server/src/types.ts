export interface MIDICandidate {
  id: string;
  title: string;
  source: 'bitmidi' | 'dongrays';
  pageUrl: string;
  midiUrl: string;
  confidence: number;
  fileSize?: number;
  duration?: number;
  parsed?: ParsedMIDIInfo;
}

export interface ParsedMIDIInfo {
  durationSec: number;
  tempoBpm: number;
  timeSig?: { num: number; den: number };
  tracks: TrackInfo[];
  noteCount: number;
  issues: string[];
}

export interface TrackInfo {
  id: number;
  name?: string;
  program?: number;
  noteCount: number;
  channel?: number;
  register: 'low' | 'mid' | 'high';
}

export interface SearchAdapter {
  name: string;
  search(query: string): Promise<MIDICandidate[]>;
}

export interface CacheEntry {
  hash: string;
  filename: string;
  size: number;
  timestamp: number;
}