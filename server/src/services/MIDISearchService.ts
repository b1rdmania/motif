import type { SearchAdapter, MIDICandidate } from '../types.js';
import { BitMidiAdapter } from '../adapters/BitMidiAdapter.js';
import { DongraysAdapter } from '../adapters/DongraysAdapter.js';

export class MIDISearchService {
  private adapters: SearchAdapter[];

  constructor() {
    this.adapters = [
      new BitMidiAdapter(),
      new DongraysAdapter()
    ];
  }

  async search(query: string): Promise<MIDICandidate[]> {
    const allResults: MIDICandidate[] = [];
    
    // Search all adapters in parallel
    const searchPromises = this.adapters.map(async adapter => {
      try {
        const results = await adapter.search(query);
        console.log(`${adapter.name}: Found ${results.length} results`);
        return results;
      } catch (error) {
        console.error(`${adapter.name} search failed:`, error);
        return [];
      }
    });

    const results = await Promise.all(searchPromises);
    
    // Combine and deduplicate results
    for (const adapterResults of results) {
      allResults.push(...adapterResults);
    }

    // Remove duplicates (same MIDI URL)
    const uniqueResults = this.deduplicateResults(allResults);
    
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