interface MIDISearchResult {
  id: string;
  title: string;
  source: string;
  pageUrl: string;
  midiUrl: string;
  confidence: number;
}

interface MIDISearchResponse {
  results: MIDISearchResult[];
  count: number;
}

export class MIDIService {
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
  }

  async search(query: string): Promise<MIDISearchResult[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/midi/search?q=${encodeURIComponent(query)}`);
      
      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const data: MIDISearchResponse = await response.json();
      return data.results;
    } catch (error) {
      console.error('MIDI search error:', error);
      return [];
    }
  }

  async fetchMIDI(url: string): Promise<ArrayBuffer | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/midi/fetch?u=${encodeURIComponent(url)}`);
      
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status}`);
      }

      return await response.arrayBuffer();
    } catch (error) {
      console.error('MIDI fetch error:', error);
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