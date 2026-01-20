/**
 * MIDI Track Analyzer
 * 
 * Analyzes MIDI tracks to determine their musical role and characteristics.
 * This information is used by the ChannelMapper to intelligently assign
 * tracks to the appropriate GB channels.
 */

import type { TrackAnalysis, TrackRole } from '../../types';

/**
 * Raw note data from a MIDI track
 */
export interface MIDINote {
  midi: number;        // MIDI note number (0-127)
  time: number;        // Start time in seconds
  duration: number;    // Duration in seconds
  velocity: number;    // Velocity (0-127)
}

/**
 * Parsed track data from a MIDI file
 */
export interface MIDITrack {
  channel: number;     // MIDI channel (0-15)
  notes: MIDINote[];
  name?: string;
}

export class TrackAnalyzer {
  
  /**
   * Analyze a single MIDI track and determine its characteristics.
   */
  analyzeTrack(track: MIDITrack, trackIndex: number): TrackAnalysis {
    const notes = track.notes;
    
    if (notes.length === 0) {
      return this.createEmptyAnalysis(trackIndex, track.channel);
    }
    
    // Calculate basic statistics
    const noteRange = this.calculateNoteRange(notes);
    const noteDensity = this.calculateNoteDensity(notes);
    const avgVelocity = this.calculateAverageVelocity(notes);
    const avgDuration = this.calculateAverageDuration(notes);
    const complexity = this.calculateComplexity(notes);
    const hasChords = this.detectChords(notes);
    
    // Detect if this is a drums track
    const isDrums = track.channel === 9 || this.detectDrums(notes);
    const isPercussive = this.detectPercussive(notes);
    
    // Determine the musical role
    const role = this.detectRole(notes, noteRange, isDrums, noteDensity, hasChords, avgDuration);
    
    // Calculate priority for channel assignment
    const priority = this.calculatePriority(role, noteDensity, avgVelocity, notes.length);
    
    return {
      trackIndex,
      channel: track.channel,
      isDrums,
      isPercussive,
      noteRange,
      noteDensity,
      complexity,
      hasChords,
      avgVelocity,
      avgDuration,
      noteCount: notes.length,
      role,
      priority,
    };
  }
  
  /**
   * Analyze multiple tracks and return sorted by priority.
   */
  analyzeTracks(tracks: MIDITrack[]): TrackAnalysis[] {
    const analyses = tracks.map((track, index) => this.analyzeTrack(track, index));
    
    // Sort by priority (highest first)
    return analyses.sort((a, b) => b.priority - a.priority);
  }
  
  /**
   * Create an empty analysis for a track with no notes.
   */
  private createEmptyAnalysis(trackIndex: number, channel: number): TrackAnalysis {
    return {
      trackIndex,
      channel,
      isDrums: false,
      isPercussive: false,
      noteRange: { min: 0, max: 0, avg: 0 },
      noteDensity: 0,
      complexity: 0,
      hasChords: false,
      avgVelocity: 0,
      avgDuration: 0,
      noteCount: 0,
      role: 'fx',
      priority: 0,
    };
  }
  
  /**
   * Calculate the note range (min, max, average pitch).
   */
  private calculateNoteRange(notes: MIDINote[]): { min: number; max: number; avg: number } {
    if (notes.length === 0) {
      return { min: 0, max: 0, avg: 0 };
    }
    
    let min = 127;
    let max = 0;
    let sum = 0;
    
    for (const note of notes) {
      min = Math.min(min, note.midi);
      max = Math.max(max, note.midi);
      sum += note.midi;
    }
    
    return {
      min,
      max,
      avg: sum / notes.length,
    };
  }
  
  /**
   * Calculate note density (notes per second).
   */
  private calculateNoteDensity(notes: MIDINote[]): number {
    if (notes.length < 2) return 0;
    
    const startTime = notes[0].time;
    const endTime = notes[notes.length - 1].time + notes[notes.length - 1].duration;
    const duration = endTime - startTime;
    
    if (duration <= 0) return 0;
    
    return notes.length / duration;
  }
  
  /**
   * Calculate average velocity.
   */
  private calculateAverageVelocity(notes: MIDINote[]): number {
    if (notes.length === 0) return 0;
    
    const sum = notes.reduce((acc, note) => acc + note.velocity, 0);
    return sum / notes.length;
  }
  
  /**
   * Calculate average note duration.
   */
  private calculateAverageDuration(notes: MIDINote[]): number {
    if (notes.length === 0) return 0;
    
    const sum = notes.reduce((acc, note) => acc + note.duration, 0);
    return sum / notes.length;
  }
  
  /**
   * Calculate complexity score (0-1).
   * Based on pitch variation, rhythm variation, and density.
   */
  private calculateComplexity(notes: MIDINote[]): number {
    if (notes.length < 2) return 0;
    
    // Pitch variation
    const range = this.calculateNoteRange(notes);
    const pitchVariation = Math.min(1, (range.max - range.min) / 36); // Normalize to 3 octaves
    
    // Rhythm variation (variance in inter-note timing)
    const timeDiffs: number[] = [];
    for (let i = 1; i < notes.length; i++) {
      timeDiffs.push(notes[i].time - notes[i - 1].time);
    }
    
    if (timeDiffs.length === 0) return pitchVariation * 0.5;
    
    const avgTimeDiff = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
    const timeVariance = timeDiffs.reduce((acc, t) => acc + Math.pow(t - avgTimeDiff, 2), 0) / timeDiffs.length;
    const rhythmVariation = Math.min(1, Math.sqrt(timeVariance) / avgTimeDiff);
    
    return (pitchVariation * 0.6 + rhythmVariation * 0.4);
  }
  
  /**
   * Detect if notes contain chords (multiple simultaneous notes).
   */
  private detectChords(notes: MIDINote[]): boolean {
    // Group notes by time (10ms tolerance)
    const tolerance = 0.01;
    const timeSlots = new Map<number, number>();
    
    for (const note of notes) {
      const slot = Math.floor(note.time / tolerance);
      timeSlots.set(slot, (timeSlots.get(slot) || 0) + 1);
    }
    
    // Count how many slots have more than 2 notes
    let chordSlots = 0;
    for (const count of timeSlots.values()) {
      if (count >= 2) chordSlots++;
    }
    
    // If more than 10% of time slots have chords, this track has chords
    return chordSlots > timeSlots.size * 0.1;
  }
  
  /**
   * Detect if this is a drums track (based on note patterns, not just channel).
   */
  private detectDrums(notes: MIDINote[]): boolean {
    if (notes.length < 4) return false;
    
    // Drums typically have:
    // 1. Short note durations
    // 2. Limited pitch range (clustered around GM drum notes 35-81)
    // 3. High velocity variation
    
    const avgDuration = this.calculateAverageDuration(notes);
    const range = this.calculateNoteRange(notes);
    
    // Very short notes
    const shortNotes = avgDuration < 0.1;
    
    // Limited pitch range around drum notes
    const drumPitchRange = range.min >= 35 && range.max <= 81 && (range.max - range.min) < 30;
    
    // High repetition (same notes repeated often)
    const pitchCounts = new Map<number, number>();
    for (const note of notes) {
      pitchCounts.set(note.midi, (pitchCounts.get(note.midi) || 0) + 1);
    }
    const uniquePitches = pitchCounts.size;
    const highRepetition = uniquePitches < 10 && notes.length > 20;
    
    return shortNotes && (drumPitchRange || highRepetition);
  }
  
  /**
   * Detect if track is percussive (short, rhythmic).
   */
  private detectPercussive(notes: MIDINote[]): boolean {
    const avgDuration = this.calculateAverageDuration(notes);
    return avgDuration < 0.15;
  }
  
  /**
   * Determine the musical role of the track.
   */
  private detectRole(
    notes: MIDINote[],
    range: { min: number; max: number; avg: number },
    isDrums: boolean,
    density: number,
    hasChords: boolean,
    avgDuration: number
  ): TrackRole {
    // Drums are drums
    if (isDrums) return 'drums';
    
    // Bass: low average pitch (MIDI 52 = E3, typical bass range)
    // Also consider tracks where the max note is low
    if (range.avg < 52 || range.max < 55) return 'bass';
    
    // Lead: high pitch with high density
    if (range.avg > 58 && density > 2) return 'lead';
    
    // Pad: low density, long notes
    if (density < 1.5 && avgDuration > 0.5) return 'pad';
    
    // Harmony: has chords
    if (hasChords) return 'harmony';
    
    // FX: very high density
    if (density > 8) return 'fx';
    
    // Default to lead for melodic content
    return 'lead';
  }
  
  /**
   * Calculate priority for channel assignment.
   * Higher priority = assigned first to best channels.
   */
  private calculatePriority(
    role: TrackRole,
    density: number,
    avgVelocity: number,
    noteCount: number
  ): number {
    let priority = 50;
    
    // Role-based priority
    switch (role) {
      case 'drums':
        priority += 30;
        break;
      case 'bass':
        priority += 25;
        break;
      case 'lead':
        priority += 20;
        break;
      case 'harmony':
        priority += 15;
        break;
      case 'pad':
        priority += 10;
        break;
      case 'fx':
        priority += 5;
        break;
    }
    
    // Density bonus (up to 20 points)
    priority += Math.min(20, density * 2);
    
    // Velocity bonus (up to 10 points)
    priority += (avgVelocity / 127) * 10;
    
    // Note count bonus (logarithmic, up to 10 points)
    priority += Math.min(10, Math.log10(noteCount + 1) * 3);
    
    return priority;
  }
}
