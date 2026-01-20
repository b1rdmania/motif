/**
 * Arpeggiator
 * 
 * Converts chords (simultaneous notes) into fast arpeggios.
 * This is a classic Game Boy technique to simulate polyphony
 * on limited channels.
 */

import type { ArpNote, ArpChord } from '../../types';

export interface ArpeggiatorConfig {
  /** Speed of arpeggiation in beats (1/64 = 64th note, 1/32 = 32nd note) */
  speed: number;
  
  /** BPM for calculating actual timing */
  bpm: number;
  
  /** Pattern: 'up', 'down', 'updown', 'random' */
  pattern: 'up' | 'down' | 'updown' | 'random';
  
  /** Minimum number of notes to trigger arpeggiation (2 = any chord) */
  minNotes: number;
}

const DEFAULT_CONFIG: ArpeggiatorConfig = {
  speed: 1 / 32,      // 32nd notes
  bpm: 120,
  pattern: 'up',
  minNotes: 2,
};

export class Arpeggiator {
  private config: ArpeggiatorConfig;
  
  constructor(config: Partial<ArpeggiatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Update configuration.
   */
  setConfig(config: Partial<ArpeggiatorConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Get current configuration.
   */
  getConfig(): ArpeggiatorConfig {
    return { ...this.config };
  }
  
  /**
   * Calculate the duration of one arp step in seconds.
   */
  private getStepDuration(): number {
    // One beat = 60 / BPM seconds
    // speed is in beats (e.g., 1/32 = 32nd note = 1/8 of a beat)
    const beatDuration = 60 / this.config.bpm;
    return beatDuration * this.config.speed;
  }
  
  /**
   * Convert an array of notes to arpeggiated output.
   * Single notes pass through unchanged.
   * Chords are converted to fast arpeggios.
   */
  arpeggiate(notes: ArpNote[]): ArpNote[] {
    if (notes.length === 0) return [];
    
    // Group notes by time (detect chords)
    const chords = this.groupIntoChords(notes);
    
    // Process each chord
    const result: ArpNote[] = [];
    
    for (const chord of chords) {
      if (chord.notes.length < this.config.minNotes) {
        // Not enough notes for a chord, pass through
        result.push(...chord.notes);
      } else {
        // Arpeggiate the chord
        result.push(...this.arpeggiateChord(chord));
      }
    }
    
    // Sort by time
    return result.sort((a, b) => a.time - b.time);
  }
  
  /**
   * Group notes into chords based on timing.
   */
  private groupIntoChords(notes: ArpNote[]): ArpChord[] {
    const tolerance = 0.02; // 20ms tolerance
    const sorted = [...notes].sort((a, b) => a.time - b.time);
    
    const chords: ArpChord[] = [];
    let currentChord: ArpChord | null = null;
    
    for (const note of sorted) {
      if (!currentChord || note.time - currentChord.startTime > tolerance) {
        // Start a new chord
        currentChord = {
          startTime: note.time,
          notes: [note],
        };
        chords.push(currentChord);
      } else {
        // Add to current chord
        currentChord.notes.push(note);
      }
    }
    
    return chords;
  }
  
  /**
   * Arpeggiate a single chord.
   */
  private arpeggiateChord(chord: ArpChord): ArpNote[] {
    const stepDuration = this.getStepDuration();
    
    // Sort notes by pitch based on pattern
    const sortedNotes = this.sortNotesForPattern(chord.notes);
    
    // Calculate how long the original chord should last
    const maxDuration = Math.max(...chord.notes.map(n => n.duration));
    
    // Calculate how many complete cycles we can fit
    const cycleLength = sortedNotes.length * stepDuration;
    const numCycles = Math.max(1, Math.floor(maxDuration / cycleLength));
    
    const result: ArpNote[] = [];
    let noteIndex = 0;
    let direction = 1; // For updown pattern
    
    // Generate arpeggiated notes
    for (let cycle = 0; cycle < numCycles; cycle++) {
      for (let i = 0; i < sortedNotes.length; i++) {
        const originalNote = sortedNotes[noteIndex];
        const time = chord.startTime + (cycle * sortedNotes.length + i) * stepDuration;
        
        // Only add if within original duration
        if (time < chord.startTime + maxDuration) {
          result.push({
            midiNote: originalNote.midiNote,
            time,
            duration: stepDuration * 0.9, // Slight gap between notes
            velocity: originalNote.velocity,
          });
        }
        
        // Update index based on pattern
        if (this.config.pattern === 'updown') {
          noteIndex += direction;
          if (noteIndex >= sortedNotes.length - 1) {
            direction = -1;
            noteIndex = sortedNotes.length - 1;
          } else if (noteIndex <= 0) {
            direction = 1;
            noteIndex = 0;
          }
        } else if (this.config.pattern === 'random') {
          noteIndex = Math.floor(Math.random() * sortedNotes.length);
        } else {
          noteIndex = (noteIndex + 1) % sortedNotes.length;
        }
      }
    }
    
    return result;
  }
  
  /**
   * Sort notes based on the arpeggio pattern.
   */
  private sortNotesForPattern(notes: ArpNote[]): ArpNote[] {
    const sorted = [...notes];
    
    switch (this.config.pattern) {
      case 'up':
      case 'updown':
        sorted.sort((a, b) => a.midiNote - b.midiNote);
        break;
      case 'down':
        sorted.sort((a, b) => b.midiNote - a.midiNote);
        break;
      case 'random':
        // Shuffle
        for (let i = sorted.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
        }
        break;
    }
    
    return sorted;
  }
  
  /**
   * Check if a set of notes would be arpeggiated.
   */
  wouldArpeggiate(notes: ArpNote[]): boolean {
    const chords = this.groupIntoChords(notes);
    return chords.some(chord => chord.notes.length >= this.config.minNotes);
  }
  
  /**
   * Set BPM (updates timing calculations).
   */
  setBPM(bpm: number): void {
    this.config.bpm = Math.max(20, Math.min(300, bpm));
  }
  
  /**
   * Set arpeggio speed.
   */
  setSpeed(speed: number): void {
    this.config.speed = speed;
  }
  
  /**
   * Set arpeggio pattern.
   */
  setPattern(pattern: ArpeggiatorConfig['pattern']): void {
    this.config.pattern = pattern;
  }
}
