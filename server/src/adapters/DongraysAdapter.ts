import type { SearchAdapter, MIDICandidate } from '../types.js';
import { ScoreUtils } from '../utils/ScoreUtils.js';

export class DongraysAdapter implements SearchAdapter {
  name = 'dongrays';
  private baseUrl = 'https://www.dongrays.net';

  async search(query: string): Promise<MIDICandidate[]> {
    try {
      // Dongrays search endpoint (simplified for MVP)
      const searchUrl = `${this.baseUrl}/search?q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MotifBot/1.0)'
        }
      });

      if (!response.ok) {
        throw new Error(`Dongrays search failed: ${response.status}`);
      }

      const html = await response.text();
      return this.parseSearchResults(html, query);
    } catch (error) {
      console.error('Dongrays search error:', error);
      return [];
    }
  }

  private parseSearchResults(html: string, query: string): MIDICandidate[] {
    const candidates: MIDICandidate[] = [];
    
    // Look for .mid file links in the HTML
    const midiRegex = /<a[^>]*href="([^"]*\.mid)"[^>]*>([^<]*)</gi;
    let match;

    while ((match = midiRegex.exec(html)) !== null && candidates.length < 10) {
      const [, href, title] = match;
      
      if (href && title.trim()) {
        const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
        const confidence = ScoreUtils.calculateConfidence(title, query, this.name);
        
        candidates.push({
          id: `dongrays_${Buffer.from(fullUrl).toString('base64').slice(0, 16)}`,
          title: title.trim(),
          source: 'dongrays',
          pageUrl: fullUrl,
          midiUrl: fullUrl, // Direct link to MIDI file
          confidence
        });
      }
    }

    // Also look for download links that might contain MIDI files
    const downloadRegex = /<a[^>]*href="([^"]*download[^"]*)"[^>]*>([^<]*mid[^<]*)</gi;
    while ((match = downloadRegex.exec(html)) !== null && candidates.length < 10) {
      const [, href, title] = match;
      
      if (href && title.trim()) {
        const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
        const confidence = ScoreUtils.calculateConfidence(title, query, this.name);
        
        candidates.push({
          id: `dongrays_dl_${Buffer.from(fullUrl).toString('base64').slice(0, 16)}`,
          title: title.trim(),
          source: 'dongrays',
          pageUrl: fullUrl,
          midiUrl: fullUrl,
          confidence: confidence * 0.8 // Slightly lower confidence for download links
        });
      }
    }

    return candidates
      .filter(c => c.confidence > 0.3)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }
}