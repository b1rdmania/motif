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
  enableArranger: false, // OFF by default - too many overlapping notes causes clipping
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
  
  // Progressive scheduling state
  private pendingNotes: ChannelNote[] = [];
  private scheduleIndex: number = 0;
  // Cache of the last arranged song so pause/resume/seek can restart from an
  // offset without re-parsing and (importantly) re-randomising the arrangement.
  private loadedNotes: ChannelNote[] = [];
  private loadedDuration: number = 0;
  private loadedAssignments: ChannelAssignment[] = [];
  private schedulerInterval: ReturnType<typeof setInterval> | null = null;
  private readonly SCHEDULE_AHEAD_TIME = 2.0; // Schedule 2 seconds ahead
  private readonly SCHEDULER_INTERVAL_MS = 250; // Check every 250ms
  
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
  async playMIDI(midiData: ArrayBuffer, startOffset: number = 0): Promise<PlaybackInfo> {
    // Resume audio context if needed
    if (this.config.autoResume) {
      await this.apu.resume();
    }
    
    // Stop any current playback
    if (this.isPlaying) {
      this.stop();
    }
    
    const info = this.prepare(midiData);
    this.startFromOffset(startOffset);
    return info;
  }

  /**
   * Parse, map and arrange a MIDI into GB channel notes and cache the result,
   * WITHOUT starting playback. Lets the WAV export render without a sound.
   */
  prepareMIDI(midiData: ArrayBuffer): PlaybackInfo {
    return this.prepare(midiData);
  }

  private prepare(midiData: ArrayBuffer): PlaybackInfo {
    const midi = new Midi(midiData);
    const bpm = midi.header.tempos[0]?.bpm || this.config.defaultBPM;
    this.arpeggiator.setBPM(bpm);
    this.arranger.setBPM(bpm);

    const tracks = this.convertMIDITracks(midi);
    const assignments = this.mapper.mapTracks(tracks);
    let gbNotes = this.convertToGBNotes(tracks, assignments);

    if (this.config.enableArranger) {
      const result = this.arranger.arrange(gbNotes, assignments, midi.duration);
      gbNotes = result.notes;
    }

    // Cache the arranged song so pause/resume/seek/export reuse the same notes.
    this.loadedNotes = gbNotes;
    this.loadedDuration = midi.duration;
    this.loadedAssignments = assignments;
    const info = {
      duration: midi.duration,
      assignments,
      noteCount: gbNotes.length,
    };
    this.currentPlaybackInfo = info;
    return info;
  }

  /**
   * (Re)start playback of the currently loaded song from a time offset in
   * seconds. This is the primitive that pause/resume and seeking are built on.
   */
  playFrom(offsetSec: number): void {
    if (this.loadedNotes.length === 0) return;
    this.startFromOffset(Math.max(0, offsetSec));
  }

  /**
   * Render the currently loaded song to an AudioBuffer offline (faster than
   * real time). Used to export a WAV. Returns null if nothing is loaded.
   */
  async renderToBuffer(sampleRate: number = 22050, maxSeconds: number = 30): Promise<AudioBuffer | null> {
    if (this.loadedNotes.length === 0) return null;

    // The authentic APU (per-note LFSR noise buffers etc.) is heavy to render
    // offline, so bound the work to a short clip from the start of the song and
    // a chiptune-appropriate sample rate. Otherwise a 5-minute song can take
    // tens of seconds in-browser.
    const clipSeconds = Math.min(this.loadedDuration, maxSeconds);
    const totalDuration = clipSeconds + 0.5; // small release tail
    let notes = this.loadedNotes.filter(n => n.startTime < clipSeconds);

    const MAX_NOTES = 1500;
    if (notes.length > MAX_NOTES) {
      const step = notes.length / MAX_NOTES;
      notes = Array.from({ length: MAX_NOTES }, (_, i) => notes[Math.round(i * step)]);
    }

    const offline = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate);
    const offlineApu = new GameBoyAPU(offline as unknown as AudioContext, this.config);

    // Re-apply the per-channel settings this arrangement used.
    for (const a of this.loadedAssignments) {
      if (a.channelId.startsWith('p') && a.dutyCycle !== undefined) {
        offlineApu.setPulseDuty(a.channelId as any, a.dutyCycle);
      } else if (a.channelId.startsWith('w') && a.wavePreset) {
        offlineApu.setWavePreset(a.channelId as any, a.wavePreset);
      } else if (a.channelId.startsWith('n') && a.noiseMode) {
        offlineApu.setNoiseMode(a.channelId as any, a.noiseMode);
      }
    }

    for (const note of notes) {
      offlineApu.scheduleNote(note);
    }

    return offline.startRendering();
  }

  private startFromOffset(offsetSec: number): void {
    this.stopScheduler();
    this.apu.stopAll();

    this.pendingNotes = this.loadedNotes;
    // Skip notes that start before the offset (pendingNotes is sorted by time).
    let idx = 0;
    while (idx < this.pendingNotes.length && this.pendingNotes[idx].startTime < offsetSec) {
      idx++;
    }
    this.scheduleIndex = idx;

    // Shift the timeline origin back by the offset so getElapsedTime() reports
    // the song position and notes schedule at the right absolute times.
    const startTime = this.apu.getCurrentTime() + 0.1 - offsetSec;
    this.playbackStartTime = startTime;
    this.isPlaying = true;

    this.scheduleNextBatch();
    this.startScheduler();

    // Auto-stop after the remaining duration.
    const stopDelay = (this.loadedDuration - offsetSec + 1) * 1000;
    setTimeout(() => {
      if (this.isPlaying && this.playbackStartTime === startTime) {
        this.isPlaying = false;
      }
    }, Math.max(0, stopDelay));
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
   * Schedule notes progressively - only schedule notes within the lookahead window.
   */
  private scheduleNextBatch(): void {
    if (!this.isPlaying && this.scheduleIndex > 0) return;
    
    const currentTime = this.apu.getCurrentTime();
    const elapsedTime = currentTime - this.playbackStartTime;
    const scheduleUntil = elapsedTime + this.SCHEDULE_AHEAD_TIME;
    
    let scheduledCount = 0;
    
    while (this.scheduleIndex < this.pendingNotes.length) {
      const note = this.pendingNotes[this.scheduleIndex];
      
      // If note is beyond our scheduling window, stop
      if (note.startTime > scheduleUntil) {
        break;
      }
      
      // Schedule the note
      this.apu.scheduleNote({
        ...note,
        startTime: this.playbackStartTime + note.startTime,
      });
      
      this.scheduleIndex++;
      scheduledCount++;
    }
    
    if (scheduledCount > 0) {
      console.log(`Scheduled ${scheduledCount} notes (${this.scheduleIndex}/${this.pendingNotes.length})`);
    }
  }
  
  /**
   * Start the progressive scheduler.
   */
  private startScheduler(): void {
    this.stopScheduler();
    
    this.schedulerInterval = setInterval(() => {
      if (!this.isPlaying) {
        this.stopScheduler();
        return;
      }
      
      this.scheduleNextBatch();
      
      // Check if all notes have been scheduled
      if (this.scheduleIndex >= this.pendingNotes.length) {
        this.stopScheduler();
      }
    }, this.SCHEDULER_INTERVAL_MS);
  }
  
  /**
   * Stop the progressive scheduler.
   */
  private stopScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }
  
  /**
   * Stop playback.
   */
  stop(): void {
    this.isPlaying = false;
    this.stopScheduler();
    this.pendingNotes = [];
    this.scheduleIndex = 0;
    this.apu.stopAll();
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
