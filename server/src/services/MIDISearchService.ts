import type { SearchAdapter, MIDICandidate } from '../types.js';
import { BitMidiAdapter } from '../adapters/BitMidiAdapter.js';

export class MIDISearchService {
  private adapters: SearchAdapter[];

  constructor() {
    this.adapters = [
      new BitMidiAdapter()
    ];
    console.log('MIDISearchService initialized with adapters:', this.adapters.map(a => a.name));
  }

  async search(query: string): Promise<MIDICandidate[]> {
    const allResults: MIDICandidate[] = [];
    
    // Search all adapters in parallel
    const searchPromises = this.adapters.map(async adapter => {
      try {
        const results = await adapter.search(query);
        console.log(`${adapter.name}: Found ${results.length} results`);
        return { ok: true, results } as const;
      } catch (error) {
        console.error(`${adapter.name} search failed:`, error);
        return { ok: false, results: [] as MIDICandidate[] } as const;
      }
    });

    const results = await Promise.all(searchPromises);
    const allFailed = results.length > 0 && results.every(r => !r.ok);
    
    // Combine and deduplicate results
    for (const adapterResults of results) {
      allResults.push(...adapterResults.results);
    }

    // Remove duplicates (same MIDI URL)
    const uniqueResults = this.deduplicateResults(allResults);

    // Distinguish provider outage from "no matches found"
    if (uniqueResults.length === 0 && allFailed) {
      throw new Error('MIDI_SOURCE_UNAVAILABLE');
    }
    
    // Sort by confidence score
    uniqueResults.sort((a, b) => b.confidence - a.confidence);
    
    // Return top 10 results
    return uniqueResults.slice(0, 10);
  }

  private deduplicateResults(results: MIDICandidate[]): MIDICandidate[] {
    const seen = new Set<string>();
    const unique: MIDICandidate[] = [];

    for (const result of results) {
      // Create dedup key from MIDI URL or title+source
      const key = result.midiUrl || `${result.title}_${result.source}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(result);
      }
    }

    return unique;
  }
}
