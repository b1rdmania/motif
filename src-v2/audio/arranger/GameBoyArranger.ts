/**
 * Game Boy Arranger
 * 
 * This is the "secret sauce" that makes arbitrary MIDI files sound like
 * actual Game Boy music. Professional GB composers used specific techniques
 * to make 4 channels sound full - this module applies those techniques
 * automatically to sparse MIDI arrangements.
 * 
 * Techniques applied:
 * 1. Bass Enhancement - Make bass lines rhythmically active
 * 2. Drum Enhancement - Add hi-hats and fill percussion gaps
 * 3. Melody Doubling - Add octave harmonies on spare channels
 * 4. Counter-Melody Generation - Create interweaving parts
 * 5. Gap Filling - Ensure channels stay busy
 * 6. Arpeggio Insertion - Turn static chords into motion
 */

import type { ChannelNote, ChannelId, ChannelAssignment, TrackAnalysis } from '../../types';
import type { ArpNote } from '../../types';

export interface ArrangerConfig {
  /** Enable bass enhancement */
  enhanceBass: boolean;
  
  /** Enable drum/percussion enhancement */
  enhanceDrums: boolean;
  
  /** Enable melody doubling */
  doubleMelody: boolean;
  
  /** Enable gap filling */
  fillGaps: boolean;
  
  /** Minimum gap duration to fill (seconds) */
  minGapToFill: number;
  
  /** Target channel utilization (0-1) */
  targetUtilization: number;
  
  /** Hi-hat rate (notes per beat) */
  hihatRate: number;
  
  /** BPM for timing calculations */
  bpm: number;
}

const DEFAULT_CONFIG: ArrangerConfig = {
  enhanceBass: true,
  enhanceDrums: false,  // Disabled - no phantom drums/hi-hats
  doubleMelody: true,
  fillGaps: true,
  minGapToFill: 0.5,
  targetUtilization: 0.7,
  hihatRate: 1,
  bpm: 120,
};

export interface ArrangementResult {
  notes: ChannelNote[];
  stats: {
    originalNotes: number;
    addedNotes: number;
    channelUtilization: Record<ChannelId, number>;
  };
}

export class GameBoyArranger {
  private config: ArrangerConfig;
  
  constructor(config: Partial<ArrangerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Set configuration.
   */
  setConfig(config: Partial<ArrangerConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Set BPM for timing calculations.
   */
  setBPM(bpm: number): void {
    this.config.bpm = bpm;
  }
  
  /**
   * Arrange and enhance notes for fuller GB sound.
   */
  arrange(
    notes: ChannelNote[],
    assignments: ChannelAssignment[],
    duration: number
  ): ArrangementResult {
    const originalCount = notes.length;
    let enhanced = [...notes];
    
    // Group notes by channel
    const byChannel = this.groupByChannel(enhanced);
    
    // 1. Enhance bass
    if (this.config.enhanceBass) {
      const bassChannels = ['w1', 'w2'] as ChannelId[];
      for (const channelId of bassChannels) {
        if (byChannel.has(channelId)) {
          const bassNotes = byChannel.get(channelId)!;
          const enhancedBass = this.enhanceBass(bassNotes, duration);
          byChannel.set(channelId, enhancedBass);
        }
      }
    }
    
    // 2. Enhance drums
    if (this.config.enhanceDrums) {
      const noiseChannels = ['n1', 'n2'] as ChannelId[];
      for (const channelId of noiseChannels) {
        const drumNotes = byChannel.get(channelId) || [];
        const enhancedDrums = this.enhanceDrums(drumNotes, duration, channelId);
        byChannel.set(channelId, enhancedDrums);
      }
    }
    
    // 3. Double melody if spare pulse channel available
    if (this.config.doubleMelody) {
      const pulseChannels = ['p1', 'p2', 'p3', 'p4'] as ChannelId[];
      const usedPulse = pulseChannels.filter(c => 
        byChannel.has(c) && byChannel.get(c)!.length > 0
      );
      const sparePulse = pulseChannels.filter(c => !usedPulse.includes(c));
      
      if (sparePulse.length > 0 && usedPulse.length > 0) {
        // Find the lead channel (most notes, highest pitch)
        const leadChannel = this.findLeadChannel(byChannel, usedPulse);
        if (leadChannel && byChannel.get(leadChannel)) {
          const doubled = this.doubleMelody(
            byChannel.get(leadChannel)!,
            sparePulse[0]
          );
          byChannel.set(sparePulse[0], doubled);
        }
      }
    }
    
    // 4. Fill gaps in all channels
    if (this.config.fillGaps) {
      for (const [channelId, channelNotes] of byChannel) {
        const filled = this.fillGaps(channelNotes, duration, channelId);
        byChannel.set(channelId, filled);
      }
    }
    
    // Flatten back to array
    enhanced = [];
    for (const channelNotes of byChannel.values()) {
      enhanced.push(...channelNotes);
    }
    
    // Sort by time
    enhanced.sort((a, b) => a.startTime - b.startTime);
    
    // Calculate utilization stats
    const utilization = this.calculateUtilization(byChannel, duration);
    
    return {
      notes: enhanced,
      stats: {
        originalNotes: originalCount,
        addedNotes: enhanced.length - originalCount,
        channelUtilization: utilization,
      },
    };
  }
  
  /**
   * Group notes by channel.
   */
  private groupByChannel(notes: ChannelNote[]): Map<ChannelId, ChannelNote[]> {
    const grouped = new Map<ChannelId, ChannelNote[]>();
    
    for (const note of notes) {
      if (!grouped.has(note.channel)) {
        grouped.set(note.channel, []);
      }
      grouped.get(note.channel)!.push(note);
    }
    
    // Sort each channel by time
    for (const channelNotes of grouped.values()) {
      channelNotes.sort((a, b) => a.startTime - b.startTime);
    }
    
    return grouped;
  }
  
  /**
   * Enhance bass to be more rhythmically active.
   * GB bass doesn't just play root notes - it has rhythmic variation.
   */
  private enhanceBass(notes: ChannelNote[], duration: number): ChannelNote[] {
    if (notes.length === 0) return notes;
    
    const enhanced: ChannelNote[] = [];
    const beatDuration = 60 / this.config.bpm;
    
    for (const note of notes) {
      // Keep original note
      enhanced.push(note);
      
      // If note is long, add rhythmic subdivisions
      if (note.duration > beatDuration * 1.5) {
        // Add a "bounce" note halfway through
        const bounceTime = note.startTime + note.duration / 2;
        enhanced.push({
          ...note,
          startTime: bounceTime,
          duration: Math.min(beatDuration * 0.5, note.duration / 4),
          velocity: note.velocity * 0.7,
        });
      }
      
      // Add octave jump on strong beats occasionally
      if (note.duration > beatDuration * 2 && Math.random() > 0.6) {
        enhanced.push({
          ...note,
          midiNote: note.midiNote + 12, // Octave up
          startTime: note.startTime + beatDuration,
          duration: beatDuration * 0.4,
          velocity: note.velocity * 0.6,
        });
      }
    }
    
    return enhanced.sort((a, b) => a.startTime - b.startTime);
  }
  
  /**
   * Enhance drums with hi-hats and fills.
   * GB drums are BUSY - hi-hats on every 8th note.
   */
  private enhanceDrums(
    notes: ChannelNote[],
    duration: number,
    channelId: ChannelId
  ): ChannelNote[] {
    const enhanced = [...notes];
    const beatDuration = 60 / this.config.bpm;
    const subdivisionDuration = beatDuration / this.config.hihatRate;
    
    // n2 is for hi-hats (15-bit noise = more "tsss")
    // n1 is for kick/snare (7-bit noise = more punchy)
    if (channelId === 'n2') {
      // Add hi-hats on every subdivision if not already occupied
      for (let time = 0; time < duration; time += subdivisionDuration) {
        const hasNote = notes.some(n => 
          Math.abs(n.startTime - time) < subdivisionDuration * 0.3
        );
        
        if (!hasNote) {
          enhanced.push({
            channel: channelId,
            midiNote: 66, // High pitch = high frequency noise
            startTime: time,
            duration: subdivisionDuration * 0.4,
            velocity: 40 + Math.random() * 15, // Quieter, sits back in mix
          });
        }
      }
    } else if (channelId === 'n1') {
      // Ensure kick and snare on basic beats if sparse
      const kickTimes = this.getKickTimes(notes);
      const snareTimes = this.getSnareTimes(notes);
      
      // Add kick on beat 1 and 3 if missing
      for (let beat = 0; beat < duration / beatDuration; beat++) {
        const beatTime = beat * beatDuration;
        
        if (beat % 4 === 0 || beat % 4 === 2) { // Beats 1 and 3
          if (!kickTimes.some(t => Math.abs(t - beatTime) < beatDuration * 0.2)) {
            enhanced.push({
              channel: channelId,
              midiNote: 36, // Low pitch = low frequency noise (kick)
              startTime: beatTime,
              duration: 0.15,
              velocity: 100,
            });
          }
        }
        
        if (beat % 4 === 1 || beat % 4 === 3) { // Beats 2 and 4
          if (!snareTimes.some(t => Math.abs(t - beatTime) < beatDuration * 0.2)) {
            enhanced.push({
              channel: channelId,
              midiNote: 48, // Mid pitch (snare)
              startTime: beatTime,
              duration: 0.1,
              velocity: 90,
            });
          }
        }
      }
    }
    
    return enhanced.sort((a, b) => a.startTime - b.startTime);
  }
  
  /**
   * Get times of kick-like notes.
   */
  private getKickTimes(notes: ChannelNote[]): number[] {
    return notes
      .filter(n => n.midiNote < 45 && n.velocity > 80)
      .map(n => n.startTime);
  }
  
  /**
   * Get times of snare-like notes.
   */
  private getSnareTimes(notes: ChannelNote[]): number[] {
    return notes
      .filter(n => n.midiNote >= 45 && n.midiNote < 55 && n.velocity > 70)
      .map(n => n.startTime);
  }
  
  /**
   * Double the melody an octave up on a spare channel.
   */
  private doubleMelody(
    leadNotes: ChannelNote[],
    targetChannel: ChannelId
  ): ChannelNote[] {
    return leadNotes.map(note => ({
      ...note,
      channel: targetChannel,
      midiNote: note.midiNote + 12, // Octave up
      velocity: Math.round(note.velocity * 0.5), // Quieter
    }));
  }
  
  /**
   * Find the lead channel (highest average pitch, most notes).
   */
  private findLeadChannel(
    byChannel: Map<ChannelId, ChannelNote[]>,
    candidates: ChannelId[]
  ): ChannelId | null {
    let bestChannel: ChannelId | null = null;
    let bestScore = 0;
    
    for (const channelId of candidates) {
      const notes = byChannel.get(channelId);
      if (!notes || notes.length === 0) continue;
      
      const avgPitch = notes.reduce((sum, n) => sum + n.midiNote, 0) / notes.length;
      const noteCount = notes.length;
      
      // Score = high pitch + many notes
      const score = avgPitch / 127 * 0.5 + Math.min(1, noteCount / 100) * 0.5;
      
      if (score > bestScore) {
        bestScore = score;
        bestChannel = channelId;
      }
    }
    
    return bestChannel;
  }
  
  /**
   * Fill gaps in a channel with sustain notes or echoes.
   */
  private fillGaps(
    notes: ChannelNote[],
    duration: number,
    channelId: ChannelId
  ): ChannelNote[] {
    if (notes.length === 0) return notes;
    
    const enhanced = [...notes];
    const minGap = this.config.minGapToFill;
    
    // Find gaps
    for (let i = 0; i < notes.length - 1; i++) {
      const current = notes[i];
      const next = notes[i + 1];
      const gapStart = current.startTime + current.duration;
      const gapDuration = next.startTime - gapStart;
      
      if (gapDuration > minGap) {
        // Add an echo/sustain note in the gap
        enhanced.push({
          channel: channelId,
          midiNote: current.midiNote,
          startTime: gapStart + 0.1,
          duration: Math.min(gapDuration - 0.2, 0.3),
          velocity: Math.round(current.velocity * 0.4), // Quiet echo
        });
      }
    }
    
    // Check gap at the end
    const lastNote = notes[notes.length - 1];
    const endGap = duration - (lastNote.startTime + lastNote.duration);
    if (endGap > minGap * 2) {
      enhanced.push({
        channel: channelId,
        midiNote: lastNote.midiNote,
        startTime: lastNote.startTime + lastNote.duration + 0.1,
        duration: 0.3,
        velocity: Math.round(lastNote.velocity * 0.3),
      });
    }
    
    return enhanced.sort((a, b) => a.startTime - b.startTime);
  }
  
  /**
   * Calculate channel utilization (0-1 for each channel).
   */
  private calculateUtilization(
    byChannel: Map<ChannelId, ChannelNote[]>,
    duration: number
  ): Record<ChannelId, number> {
    const utilization: Record<string, number> = {};
    
    for (const [channelId, notes] of byChannel) {
      const totalNoteTime = notes.reduce((sum, n) => sum + n.duration, 0);
      utilization[channelId] = Math.min(1, totalNoteTime / duration);
    }
    
    return utilization as Record<ChannelId, number>;
  }
}
