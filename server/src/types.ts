export interface MIDICandidate {
  id: string;
  title: string;
  source: 'bitmidi' | 'dongrays';
  pageUrl: string;
  midiUrl: string;
  confidence: number;
  fileSize?: number;
  duration?: number;
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