export class ScoreUtils {
  static calculateConfidence(title: string, query: string, source: string): number {
    const titleLower = title.toLowerCase();
    const queryLower = query.toLowerCase();

    let score = 0;

    // Token matching - split and check individual words
    const titleTokens = this.tokenize(titleLower);
    const queryTokens = this.tokenize(queryLower);

    // Exact title match gets very high score
    if (titleLower === queryLower) {
      score += 1.0;
    } else if (titleLower.includes(queryLower)) {
      score += 0.8;
    }

    // Parse for artist + song patterns (e.g., "Artist - Song" or "Artist Song")
    const artistSongPattern = this.parseArtistSongQuery(queryLower);
    if (artistSongPattern) {
      const { artist, song } = artistSongPattern;

      // Check if title contains both artist and song (high confidence)
      const hasArtist = titleLower.includes(artist);
      const hasSong = titleLower.includes(song);

      if (hasArtist && hasSong) {
        score += 0.9; // Very high confidence for artist + song match
      } else if (hasArtist) {
        score += 0.4; // Partial credit for artist match
      } else if (hasSong) {
        score += 0.5; // Partial credit for song match
      }
    } else {
      // Standard token overlap scoring (fallback)
      const matchingTokens = queryTokens.filter(token =>
        titleTokens.some(titleToken =>
          titleToken.includes(token) || token.includes(titleToken)
        )
      );

      const tokenMatchRatio = matchingTokens.length / queryTokens.length;
      score += tokenMatchRatio * 0.6;

      // Bonus for having all query words present (in any order)
      if (tokenMatchRatio === 1.0) {
        score += 0.2;
      }
    }
    
    // Penalty for low-quality indicators
    const penalties = [
      { pattern: /karaoke|kar|midkar/, penalty: 0.3 },
      { pattern: /vocal|lyrics/, penalty: 0.2 },
      { pattern: /demo|test|sample/, penalty: 0.2 },
      { pattern: /incomplete|broken/, penalty: 0.5 },
    ];
    
    for (const { pattern, penalty } of penalties) {
      if (pattern.test(titleLower)) {
        score -= penalty;
      }
    }
    
    // Bonus for direct .mid links
    if (title.includes('.mid')) {
      score += 0.1;
    }
    
    // Source-specific scoring adjustments
    if (source === 'bitmidi') {
      score += 0.1; // Slight preference for BitMidi (more curated)
    }
    
    // Ensure score is between 0 and 1
    return Math.max(0, Math.min(1, score));
  }
  
  static assessQuality(buffer: ArrayBuffer): { 
    score: number; 
    duration?: number; 
    trackCount?: number; 
    issues: string[] 
  } {
    const issues: string[] = [];
    let score = 0.5; // Base score
    
    // File size checks
    const size = buffer.byteLength;
    if (size < 1000) {
      issues.push('File too small');
      score -= 0.3;
    } else if (size > 5_000_000) {
      issues.push('File very large');
      score -= 0.1;
    } else {
      score += 0.1; // Good size range
    }
    
    // Basic MIDI header validation
    const view = new Uint8Array(buffer);
    const header = String.fromCharCode(...view.slice(0, 4));
    
    if (header !== 'MThd') {
      issues.push('Invalid MIDI header');
      score -= 0.5;
    } else {
      score += 0.2;
    }
    
    // TODO: More sophisticated parsing for duration, tempo changes, track count
    // For MVP, we'll do basic heuristics
    
    return {
      score: Math.max(0, Math.min(1, score)),
      issues
    };
  }
  
  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(token => token.length > 1) // Remove single characters
      .filter(token => !this.isStopWord(token));
  }
  
  private static isStopWord(word: string): boolean {
    const stopWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
    return stopWords.includes(word);
  }

  /**
   * Parse query for artist + song patterns
   * Handles patterns like: "Artist Song", "Artist - Song", "Artist: Song", etc.
   * Returns null if no clear pattern detected
   */
  private static parseArtistSongQuery(query: string): { artist: string; song: string } | null {
    // Pattern 1: "Artist - Song" or "Artist : Song"
    const dashPattern = /^(.+?)\s*[-:]\s*(.+)$/;
    const dashMatch = query.match(dashPattern);
    if (dashMatch) {
      return {
        artist: dashMatch[1].trim(),
        song: dashMatch[2].trim()
      };
    }

    // Pattern 2: Multi-word query where first few words might be artist
    // Common patterns: "[FirstName LastName] [SongWords...]"
    const words = query.split(/\s+/);
    if (words.length >= 3) {
      // Try 2-word artist name (e.g., "David Barry Live on Mars")
      const twoWordArtist = words.slice(0, 2).join(' ');
      const remainingSong = words.slice(2).join(' ');

      // Heuristic: if first words are capitalized names and rest is longer, likely artist + song
      if (remainingSong.length > twoWordArtist.length) {
        return {
          artist: twoWordArtist,
          song: remainingSong
        };
      }

      // Try 1-word artist name (e.g., "Madonna Like a Prayer")
      if (words.length >= 3) {
        return {
          artist: words[0],
          song: words.slice(1).join(' ')
        };
      }
    }

    return null;
  }
}