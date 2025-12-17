import type { NoteEvent, StructuralFeatures } from '../types';

export class MIDIProcessor {
  extractFeatures(events: NoteEvent[]): StructuralFeatures {
    if (events.length === 0) {
      return this.getDefaultFeatures();
    }

    const tempo = this.estimateTempo(events);
    const totalDuration = Math.max(...events.map(e => e.time + e.duration));
    const noteDensity = this.calculateDensity(events, totalDuration);
    const registerDistribution = this.analyzeRegisterDistribution(events);
    
    return {
      tempo,
      totalDuration,
      noteDensity,
      registerDistribution,
      trackRoles: new Map(),
      trackFeatures: new Map()
    };
  }

  private estimateTempo(events: NoteEvent[]): number {
    // Simple tempo estimation based on note onset intervals
    const onsets = events.map(e => e.time).sort((a, b) => a - b);
    const intervals: number[] = [];
    
    for (let i = 1; i < Math.min(onsets.length, 20); i++) {
      intervals.push(onsets[i] - onsets[i - 1]);
    }
    
    if (intervals.length === 0) return 120;
    
    // Find most common interval (simplified)
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)];
    
    // Convert to BPM (assuming quarter notes)
    return 60 / Math.max(medianInterval, 0.1);
  }

  private calculateDensity(events: NoteEvent[], duration: number): number[] {
    const windows = Math.ceil(duration / 4); // 4-second windows
    const density = new Array(windows).fill(0);
    
    for (const event of events) {
      const windowIndex = Math.floor(event.time / 4);
      if (windowIndex < windows) {
        density[windowIndex]++;
      }
    }
    
    return density;
  }

  private analyzeRegisterDistribution(events: NoteEvent[]): { low: number; mid: number; high: number } {
    let low = 0, mid = 0, high = 0;
    
    for (const event of events) {
      if (event.pitch < 48) low++;
      else if (event.pitch < 72) mid++;
      else high++;
    }
    
    const total = events.length;
    return {
      low: low / total,
      mid: mid / total,
      high: high / total
    };
  }

  private getDefaultFeatures(): StructuralFeatures {
    return {
      tempo: 120,
      totalDuration: 30,
      noteDensity: [4, 4, 4, 4, 4, 4, 4, 4],
      registerDistribution: { low: 0.3, mid: 0.5, high: 0.2 },
      trackRoles: new Map(),
      trackFeatures: new Map()
    };
  }
}