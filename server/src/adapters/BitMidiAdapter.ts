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
    
    try {
      // Look for different possible variable names containing search data
      let initStoreStart = html.indexOf('window.initStore = ');
      if (initStoreStart === -1) {
        initStoreStart = html.indexOf('window.__INITIAL_STATE__ = ');
        if (initStoreStart === -1) {
          initStoreStart = html.indexOf('window.INITIAL_PROPS = ');
          if (initStoreStart === -1) {
            // Look for any assignment that contains the data structure we need
            // From the context, we know the pattern is: {"data":{"midis":{...
            const dataStartPattern = '"data":{"midis":';
            const dataPatternIndex = html.indexOf(dataStartPattern);
            if (dataPatternIndex !== -1) {
              // Go backwards to find the start of the containing object
              let bracketStart = dataPatternIndex;
              let bracketDepth = 0;
              while (bracketStart > 0) {
                bracketStart--;
                if (html[bracketStart] === '}') bracketDepth++;
                if (html[bracketStart] === '{') {
                  if (bracketDepth === 0) break;
                  bracketDepth--;
                }
              }
              initStoreStart = bracketStart;
            } else {
              
              return [];
            }
          }
        }
      }

      let jsonStart = initStoreStart;
      // If initStoreStart is not already at a brace, find the next one
      if (html[initStoreStart] !== '{') {
        jsonStart = html.indexOf('{', initStoreStart);
        if (jsonStart === -1) {
          console.log('BitMidi: Could not find JSON start');
          return [];
        }
      }

      // Find the matching closing brace
      let braceCount = 0;
      let jsonEnd = -1;
      for (let i = jsonStart; i < html.length; i++) {
        if (html[i] === '{') braceCount++;
        else if (html[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }

      if (jsonEnd === -1) {
        console.log('BitMidi: Could not find JSON end');
        return [];
      }

      const jsonString = html.slice(jsonStart, jsonEnd);
      const jsonData = JSON.parse(jsonString);
      
      // Extract search results from the JSON structure
      if (jsonData.data && jsonData.data.midis) {
        const midisData = jsonData.data.midis;
        const midiKeys = Object.keys(midisData);
        
        for (let i = 0; i < Math.min(midiKeys.length, 10); i++) {
          const midiKey = midiKeys[i];
          const midiData = midisData[midiKey];
          
          if (midiData && midiData.name) {
            const title = midiData.name;
            const slug = midiData.slug;
            const downloadUrl = midiData.downloadUrl || `/uploads/${midiData.id}.mid`;
            
            const pageUrl = `${this.baseUrl}/${slug}`;
            const fullDownloadUrl = downloadUrl.startsWith('http') 
              ? downloadUrl 
              : `${this.baseUrl}${downloadUrl}`;
            
            const confidence = ScoreUtils.calculateConfidence(title, query, this.name);
            
            candidates.push({
              id: `bitmidi_${midiData.id}`,
              title: title.trim(),
              source: 'bitmidi',
              pageUrl: pageUrl,
              midiUrl: fullDownloadUrl,
              confidence
            });
            
          }
        }
      }
      
    } catch (error) {
      console.error('BitMidi: Error parsing JSON data:', error);
      return [];
    }

    return candidates
      .filter(c => c.confidence > 0.3) // Filter low confidence matches
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5); // Top 5 results
  }

  async getMidiDownloadUrl(pageUrl: string): Promise<string> {
    try {
      const response = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MotifBot/1.0)'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch MIDI page: ${response.status}`);
      }

      const html = await response.text();
      
      // Extract the actual download URL from the page
      // Pattern: href="/uploads/12345.mid" or similar
      const downloadMatch = html.match(/href="(\/uploads\/[^"]*\.mid)"/);
      if (downloadMatch) {
        return `${this.baseUrl}${downloadMatch[1]}`;
      }

      // Fallback: look for any .mid download link
      const midiMatch = html.match(/href="([^"]*\.mid)"/);
      if (midiMatch) {
        const url = midiMatch[1];
        return url.startsWith('http') ? url : `${this.baseUrl}${url}`;
      }

      throw new Error('Could not find MIDI download URL');
    } catch (error) {
      console.error('Error extracting MIDI URL:', error);
      return pageUrl; // Fallback to page URL
    }
  }

  private extractMidiUrl(pageUrl: string): string {
    // This method is deprecated in favor of getMidiDownloadUrl
    // but keeping for backward compatibility
    return pageUrl;
  }
}