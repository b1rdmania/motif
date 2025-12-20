import type { NoteEvent, MotifConfig, SynthModel } from '../types';
import { MIDIProcessor } from '../midi/MIDIProcessor';
import { MIDIParser } from '../midi/MIDIParser';
import { MIDIService } from '../services/MIDIService';
import { RoleMapper } from './RoleMapper';
import { SynthesisEngine } from '../synthesis/SynthesisEngine';
import { unlockAudio } from '../utils/audioUnlock';

export class MotifEngine {
  private audioContext: AudioContext | null = null;
  private config: MotifConfig;
  private midiProcessor: MIDIProcessor;
  private midiService: MIDIService;
  private roleMapper: RoleMapper;
  private synthesisEngine: SynthesisEngine | null = null;

  constructor() {
    this.config = {
      lookaheadTime: 0.1,
      scheduleInterval: 25,
      fadeTime: 0.05,
      maxOscillators: 8
    };
    
    this.midiProcessor = new MIDIProcessor();
    this.midiService = new MIDIService();
    this.roleMapper = new RoleMapper();
  }

  async generateFromMIDI(
    events: NoteEvent[],
    transformMode: 'passthrough' | 'procedural' = 'passthrough',
    model: SynthModel = 'nes_gb'
  ): Promise<void> {
    // Initialize audio context using shared unlock (iOS compatibility)
    if (!this.audioContext) {
      this.audioContext = await unlockAudio();
    }

    this.synthesisEngine = new SynthesisEngine(this.audioContext, this.config, model);

    if (transformMode === 'passthrough') {
      // Direct playback mode - play MIDI as-is without transformations
      // Create a single "melody" role assignment with all original events
      const passthroughAssignment = [{
        role: 'melody' as const,
        sourceTrack: 0,
        events: events,
        chords: [], // No chord processing
        confidence: 1.0,
        features: {
          medianPitch: 60,
          pitchRange: 48,
          noteDensity: 1.0,
          polyphonyRatio: 0.5,
          averageDuration: 0.5,
          repetitionScore: 0.5,
          isMonophonic: false,
          hasPhraseContinuity: true,
          register: 'mid' as const
        }
      }];

      this.synthesisEngine.setupLayers(passthroughAssignment);
      console.log('Motif: Passthrough mode - playing original MIDI patterns');
    } else {
      // Procedural mode - transform the MIDI with role mapping
      const features = this.midiProcessor.extractFeatures(events);
      const roleAssignments = this.roleMapper.assignRoles(features, events);
      this.synthesisEngine.setupLayers(roleAssignments);
      console.log('Motif: Procedural mode - transforming MIDI with role mapping');
    }
  }

  async generateFromSong(songName: string): Promise<void> {
    let events: NoteEvent[];
    
    // Try to find real MIDI first
    try {
      console.log(`Searching for MIDI: ${songName}`);
      const searchResults = await this.midiService.search(songName);
      
      if (searchResults.length > 0) {
        // Try to fetch the best result
        const bestResult = searchResults[0];
        console.log(`Attempting to fetch: ${bestResult.title} (${bestResult.confidence})`);
        
        const midiBuffer = await this.midiService.fetchMIDI(bestResult.midiUrl);
        
        if (midiBuffer) {
          // Parse real MIDI
          events = MIDIParser.parseMIDI(midiBuffer);
          console.log(`Successfully parsed MIDI with ${events.length} events`);
        } else {
          throw new Error('Failed to fetch MIDI');
        }
      } else {
        throw new Error('No MIDI results found');
      }
    } catch (error) {
      console.warn(`MIDI search/fetch failed: ${error}. Falling back to synthetic.`);
      events = this.generateSyntheticMIDI(songName);
    }

    // Process events into structure
    const features = this.midiProcessor.extractFeatures(events);
    const roleAssignments = this.roleMapper.assignRoles(features, events);

    // Initialize audio context using shared unlock (iOS compatibility)
    if (!this.audioContext) {
      this.audioContext = await unlockAudio();
    }

    this.synthesisEngine = new SynthesisEngine(this.audioContext, this.config, 'nes_gb');
    this.synthesisEngine.setupLayers(roleAssignments);
  }

  async play(): Promise<void> {
    if (!this.audioContext || !this.synthesisEngine) {
      throw new Error('No audio generated yet');
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.synthesisEngine.start();
  }

  stop(): void {
    if (this.synthesisEngine) {
      this.synthesisEngine.stop();
    }
  }

  setVolume(volume: number): void {
    if (this.synthesisEngine) {
      this.synthesisEngine.setVolume(volume);
    }
  }

  seek(progress: number): void {
    if (this.synthesisEngine) {
      this.synthesisEngine.seek(progress);
    }
  }

  getProgress(): number {
    if (this.synthesisEngine) {
      return this.synthesisEngine.getProgress();
    }
    return 0;
  }

  getCurrentTime(): number {
    if (this.synthesisEngine) {
      return this.synthesisEngine.getCurrentTime();
    }
    return 0;
  }

  getDuration(): number {
    if (this.synthesisEngine) {
      return this.synthesisEngine.getDuration();
    }
    return 0;
  }

  private generateSyntheticMIDI(songName: string): NoteEvent[] {
    // Generate procedural MIDI based on song name hash
    const hash = this.simpleHash(songName);
    const events: NoteEvent[] = [];
    
    // Create a simple 4/4 pattern with bass, harmony, and texture
    const duration = 32; // 32 seconds
    const beatsPerSecond = (120 + (hash % 60)) / 60; // Tempo 120-180 BPM
    
    // Bass pattern (track 0)
    for (let beat = 0; beat < duration * beatsPerSecond; beat += 1) {
      if (beat % 4 === 0) { // On beat
        events.push({
          time: beat / beatsPerSecond,
          duration: 0.5,
          pitch: 36 + (hash % 12), // C2 + random root
          velocity: 0.7 + (hash % 3) * 0.1,
          track: 0
        });
      }
    }
    
    // Harmonic drone (track 1)
    events.push({
      time: 0,
      duration: duration,
      pitch: 48 + ((hash * 3) % 12), // C3 + harmonic interval
      velocity: 0.3,
      track: 1
    });
    
    // Textural elements (track 2)
    for (let i = 0; i < 20; i++) {
      events.push({
        time: (hash * i) % duration,
        duration: 0.2 + ((hash * i) % 10) * 0.1,
        pitch: 60 + ((hash * i) % 24), // C4 + 2 octaves
        velocity: 0.2 + ((hash * i) % 5) * 0.1,
        track: 2
      });
    }
    
    return events.sort((a, b) => a.time - b.time);
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}