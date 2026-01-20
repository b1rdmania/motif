/**
 * Game Boy Player
 * 
 * Main entry point for the v2 synthesis engine.
 * Orchestrates MIDI parsing, track analysis, channel mapping,
 * arpeggiator, and APU scheduling.
 */

import { Midi } from '@tonejs/midi';
import { GameBoyAPU } from '../audio/apu/APU';
import { ChannelMapper } from '../audio/midi/ChannelMapper';
import { Arpeggiator } from '../audio/midi/Arpeggiator';
import { GameBoyArranger, type ArrangerConfig } from '../audio/arranger/GameBoyArranger';
import type { MIDITrack, MIDINote } from '../audio/midi/TrackAnalyzer';
import type { 
  ChannelNote, 
  ChannelAssignment, 
  PlaybackInfo,
  ArpNote,
  V2Config
} from '../types';

export interface GameBoyPlayerConfig extends Partial<V2Config> {
  /** Whether to auto-resume audio context on play */
  autoResume: boolean;
  
  /** Default BPM if not detected from MIDI */
  defaultBPM: number;
  
  /** Enable the arranger for fuller sound */
  enableArranger: boolean;
  
  /** Arranger configuration */
  arrangerConfig: Partial<ArrangerConfig>;
}

const DEFAULT_PLAYER_CONFIG: GameBoyPlayerConfig = {
  autoResume: true,
  defaultBPM: 120,
  masterVolume: 0.7,
  enableArranger: true, // ON by default for fuller sound
  arrangerConfig: {},
};

export class GameBoyPlayer {
  private apu: GameBoyAPU;
  private mapper: ChannelMapper;
  private arpeggiator: Arpeggiator;
  private arranger: GameBoyArranger;
  private config: GameBoyPlayerConfig;
  
  private isPlaying: boolean = false;
  private currentPlaybackInfo: PlaybackInfo | null = null;
  private playbackStartTime: number = 0;
  
  constructor(config: Partial<GameBoyPlayerConfig> = {}) {
    this.config = { ...DEFAULT_PLAYER_CONFIG, ...config };
    this.apu = new GameBoyAPU(undefined, this.config);
    this.mapper = new ChannelMapper();
    this.arpeggiator = new Arpeggiator({ bpm: this.config.defaultBPM });
    this.arranger = new GameBoyArranger(this.config.arrangerConfig);
  }
  
  /**
   * Get the APU instance for direct channel control.
   */
  getAPU(): GameBoyAPU {
    return this.apu;
  }
  
  /**
   * Parse and play a MIDI file.
   * 
   * @param midiData - MIDI file as ArrayBuffer
   * @returns Playback information
   */
  async playMIDI(midiData: ArrayBuffer): Promise<PlaybackInfo> {
    // Resume audio context if needed
    if (this.config.autoResume) {
      await this.apu.resume();
    }
    
    // Stop any current playback
    if (this.isPlaying) {
      this.stop();
    }
    
    // Parse MIDI file
    const midi = new Midi(midiData);
    const bpm = midi.header.tempos[0]?.bpm || this.config.defaultBPM;
    
    // Update arpeggiator and arranger BPM
    this.arpeggiator.setBPM(bpm);
    this.arranger.setBPM(bpm);
    
    // Convert to our track format
    const tracks = this.convertMIDITracks(midi);
    
    // Analyze and map tracks to channels
    const assignments = this.mapper.mapTracks(tracks);
    
    // Convert to scheduled notes
    let gbNotes = this.convertToGBNotes(tracks, assignments);
    
    // Apply arranger for fuller sound (if enabled)
    let arrangerStats = null;
    if (this.config.enableArranger) {
      const result = this.arranger.arrange(gbNotes, assignments, midi.duration);
      gbNotes = result.notes;
      arrangerStats = result.stats;
      console.log(`Arranger: Added ${result.stats.addedNotes} notes (${result.stats.originalNotes} → ${gbNotes.length})`);
    }
    
    // Get current time for scheduling
    const startTime = this.apu.getCurrentTime() + 0.1; // Small lookahead
    this.playbackStartTime = startTime;
    
    // Schedule all notes
    for (const note of gbNotes) {
      this.apu.scheduleNote({
        ...note,
        startTime: startTime + note.startTime,
      });
    }
    
    this.isPlaying = true;
    
    // Create playback info
    this.currentPlaybackInfo = {
      duration: midi.duration,
      assignments,
      noteCount: gbNotes.length,
    };
    
    console.log(`Playing MIDI: ${gbNotes.length} notes, ${assignments.length} channels, ${midi.duration.toFixed(1)}s duration`);
    
    // Schedule auto-stop
    const stopDelay = (midi.duration + 1) * 1000;
    setTimeout(() => {
      if (this.isPlaying && this.playbackStartTime === startTime) {
        this.isPlaying = false;
      }
    }, stopDelay);
    
    return this.currentPlaybackInfo;
  }
  
  /**
   * Convert tonejs/midi tracks to our format.
   */
  private convertMIDITracks(midi: InstanceType<typeof Midi>): MIDITrack[] {
    return midi.tracks.map((track, index) => ({
      channel: track.channel,
      name: track.name,
      notes: track.notes.map(note => ({
        midi: note.midi,
        time: note.time,
        duration: note.duration,
        velocity: Math.round(note.velocity * 127),
      })),
    }));
  }
  
  /**
   * Convert MIDI notes to GB channel notes using assignments.
   */
  private convertToGBNotes(
    tracks: MIDITrack[],
    assignments: ChannelAssignment[]
  ): ChannelNote[] {
    const gbNotes: ChannelNote[] = [];
    
    for (const assignment of assignments) {
      const track = tracks[assignment.trackIndex];
      if (!track || track.notes.length === 0) continue;
      
      // Apply channel-specific settings
      this.applyChannelSettings(assignment);
      
      // Get notes from track
      let notes: ArpNote[] = track.notes.map(n => ({
        midiNote: n.midi,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
      }));
      
      // Apply arpeggiator if needed
      if (assignment.shouldArpeggiate) {
        notes = this.arpeggiator.arpeggiate(notes);
      }
      
      // Convert to ChannelNote format
      for (const note of notes) {
        gbNotes.push({
          channel: assignment.channelId,
          midiNote: note.midiNote,
          startTime: note.time,
          duration: note.duration,
          velocity: note.velocity,
        });
      }
    }
    
    // Sort by start time for efficient scheduling
    return gbNotes.sort((a, b) => a.startTime - b.startTime);
  }
  
  /**
   * Apply channel-specific settings from assignment.
   */
  private applyChannelSettings(assignment: ChannelAssignment): void {
    const { channelId, dutyCycle, wavePreset, noiseMode } = assignment;
    
    if (channelId.startsWith('p') && dutyCycle !== undefined) {
      this.apu.setPulseDuty(channelId as any, dutyCycle);
    }
    
    if (channelId.startsWith('w') && wavePreset) {
      this.apu.setWavePreset(channelId as any, wavePreset);
    }
    
    if (channelId.startsWith('n') && noiseMode) {
      this.apu.setNoiseMode(channelId as any, noiseMode);
    }
  }
  
  /**
   * Stop playback.
   */
  stop(): void {
    this.isPlaying = false;
    this.apu.reset();
    console.log('Playback stopped');
  }
  
  /**
   * Check if currently playing.
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }
  
  /**
   * Get current playback info.
   */
  getPlaybackInfo(): PlaybackInfo | null {
    return this.currentPlaybackInfo;
  }
  
  /**
   * Get elapsed playback time in seconds.
   */
  getElapsedTime(): number {
    if (!this.isPlaying) return 0;
    return this.apu.getCurrentTime() - this.playbackStartTime;
  }
  
  /**
   * Set master volume.
   */
  setVolume(volume: number): void {
    this.apu.setMasterVolume(volume);
  }
  
  /**
   * Get master volume.
   */
  getVolume(): number {
    return this.apu.getMasterVolume();
  }
  
  /**
   * Resume audio context (required after user interaction in most browsers).
   */
  async resume(): Promise<void> {
    await this.apu.resume();
  }
  
  /**
   * Enable or disable the arranger.
   */
  setArrangerEnabled(enabled: boolean): void {
    this.config.enableArranger = enabled;
    console.log(`Arranger ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Check if arranger is enabled.
   */
  isArrangerEnabled(): boolean {
    return this.config.enableArranger ?? true;
  }
  
  /**
   * Get the arranger instance for configuration.
   */
  getArranger(): GameBoyArranger {
    return this.arranger;
  }
  
  /**
   * Parse MIDI without playing (for analysis/preview).
   */
  analyzeMIDI(midiData: ArrayBuffer): {
    duration: number;
    trackCount: number;
    noteCount: number;
    bpm: number;
    assignments: ChannelAssignment[];
  } {
    const midi = new Midi(midiData);
    const tracks = this.convertMIDITracks(midi);
    const assignments = this.mapper.mapTracks(tracks);
    
    return {
      duration: midi.duration,
      trackCount: midi.tracks.length,
      noteCount: midi.tracks.reduce((sum, t) => sum + t.notes.length, 0),
      bpm: midi.header.tempos[0]?.bpm || this.config.defaultBPM,
      assignments,
    };
  }
  
  /**
   * Get detailed track analysis.
   */
  getTrackAnalysis(midiData: ArrayBuffer) {
    const midi = new Midi(midiData);
    const tracks = this.convertMIDITracks(midi);
    return this.mapper.analyzeTracks(tracks);
  }
}
