import type { SearchAdapter, MIDICandidate } from '../types.js';
import { ScoreUtils } from '../utils/ScoreUtils.js';

export class FreeMidiAdapter implements SearchAdapter {
  name = 'freemidi';
  private baseUrl = 'https://freemidi.org';

  async search(query: string): Promise<MIDICandidate[]> {
    try {
      const searchUrl = `${this.baseUrl}/search?q=${encodeURIComponent(query)}`;
      console.log(`FreeMidi: Fetching ${searchUrl}`);

      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      });

      console.log(`FreeMidi: Response status ${response.status}`);

      if (!response.ok) {
        throw new Error(`FreeMidi search failed: ${response.status}`);
      }

      const html = await response.text();
      return this.parseSearchResults(html, query);
    } catch (error) {
      console.error('FreeMidi search error:', error);
      return [];
    }
  }

  private parseSearchResults(html: string, query: string): MIDICandidate[] {
    const candidates: MIDICandidate[] = [];

    // Pattern: <h5 class=card-title><a href=download3-2896-hotel-california-eagles title="Hotel California">
    const regex = /<h5[^>]*class=["']?card-title["']?[^>]*>\s*<a\s+href=["']?(download3-(\d+)-[^"'\s>]+)["']?\s+title=["']([^"']+)["']/gi;

    let match;
    while ((match = regex.exec(html)) !== null && candidates.length < 10) {
      const [, path, id, title] = match;

      if (path && title) {
        const pageUrl = `${this.baseUrl}/${path}`;
        // FreeMidi getter URL pattern
        const midiUrl = `${this.baseUrl}/getter-${id}`;
        const confidence = ScoreUtils.calculateConfidence(title, query, this.name);

        candidates.push({
          id: `freemidi_${id}`,
          title: title.trim(),
          source: 'freemidi',
          pageUrl,
          midiUrl,
          confidence
        });
      }
    }

    console.log(`FreeMidi: Found ${candidates.length} results`);

    return candidates
      .filter(c => c.confidence > 0.3)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }
}
