import type { SearchAdapter, MIDICandidate } from '../types.js';
import { ScoreUtils } from '../utils/ScoreUtils.js';

export class MockAdapter implements SearchAdapter {
  name = 'mock';

  async search(query: string): Promise<MIDICandidate[]> {
    // Generate mock MIDI search results for testing
    const mockSongs = [
      { title: 'Bohemian Rhapsody - Queen', url: 'synthetic:bohemian-rhapsody-queen' },
      { title: 'Hotel California - Eagles', url: 'synthetic:hotel-california-eagles' },
      { title: 'Sweet Child O Mine - Guns N Roses', url: 'synthetic:sweet-child-o-mine-guns-n-roses' },
      { title: 'Stairway to Heaven - Led Zeppelin', url: 'synthetic:stairway-to-heaven-led-zeppelin' },
      { title: 'Yesterday - The Beatles', url: 'synthetic:yesterday-the-beatles' }
    ];

    const results: MIDICandidate[] = [];

    for (const song of mockSongs) {
      const confidence = ScoreUtils.calculateConfidence(song.title, query, this.name);
      
      if (confidence > 0.1) { // Include if there's any relevance
        results.push({
          id: `mock_${Buffer.from(song.url).toString('base64').slice(0, 16)}`,
          title: song.title,
          source: 'mock',
          pageUrl: song.url,
          midiUrl: song.url,
          confidence
        });
      }
    }

    return results
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }
}