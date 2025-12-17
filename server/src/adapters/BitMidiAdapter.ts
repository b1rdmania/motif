import type { SearchAdapter, MIDICandidate } from '../types.js';
import { ScoreUtils } from '../utils/ScoreUtils.js';

export class BitMidiAdapter implements SearchAdapter {
  name = 'bitmidi';
  private baseUrl = 'https://bitmidi.com';

  async search(query: string): Promise<MIDICandidate[]> {
    try {
      const searchUrl = `${this.baseUrl}/search?q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MotifBot/1.0)'
        }
      });

      if (!response.ok) {
        throw new Error(`BitMidi search failed: ${response.status}`);
      }

      const html = await response.text();
      return this.parseSearchResults(html, query);
    } catch (error) {
      console.error('BitMidi search error:', error);
      return [];
    }
  }

  private parseSearchResults(html: string, query: string): MIDICandidate[] {
    const candidates: MIDICandidate[] = [];
    
    // Simple regex-based parsing for MVP (would use cheerio in production)
    const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]*)</gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null && candidates.length < 10) {
      const [, href, title] = match;
      
      // Look for MIDI file links
      if (href.includes('/midi/') && !href.includes('.mp3') && !href.includes('.wav')) {
        const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
        const midiUrl = this.extractMidiUrl(fullUrl);
        
        if (midiUrl && title.trim()) {
          const confidence = ScoreUtils.calculateConfidence(title, query, this.name);
          
          candidates.push({
            id: `bitmidi_${Buffer.from(fullUrl).toString('base64').slice(0, 16)}`,
            title: title.trim(),
            source: 'bitmidi',
            pageUrl: fullUrl,
            midiUrl: midiUrl,
            confidence
          });
        }
      }
    }

    return candidates
      .filter(c => c.confidence > 0.3) // Filter low confidence matches
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5); // Top 5 results
  }

  private extractMidiUrl(pageUrl: string): string {
    // For BitMidi, the MIDI download is typically at the same path with .mid extension
    // or through a download endpoint
    if (pageUrl.includes('/midi/')) {
      // Try direct .mid file first
      const basePath = pageUrl.replace(/\/$/, '');
      return `${basePath}.mid`;
    }
    return pageUrl;
  }
}