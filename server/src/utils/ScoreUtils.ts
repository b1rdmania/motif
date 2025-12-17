export class ScoreUtils {
  static calculateConfidence(title: string, query: string, source: string): number {
    const titleLower = title.toLowerCase();
    const queryLower = query.toLowerCase();
    
    let score = 0;
    
    // Token matching - split and check individual words
    const titleTokens = this.tokenize(titleLower);
    const queryTokens = this.tokenize(queryLower);
    
    // Exact title match gets high score
    if (titleLower.includes(queryLower)) {
      score += 0.8;
    }
    
    // Token overlap scoring
    const matchingTokens = queryTokens.filter(token => 
      titleTokens.some(titleToken => 
        titleToken.includes(token) || token.includes(titleToken)
      )
    );
    
    const tokenMatchRatio = matchingTokens.length / queryTokens.length;
    score += tokenMatchRatio * 0.6;
    
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
}