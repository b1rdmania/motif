import type { NoteEvent, StructuralFeatures, MotifConfig } from '../types';
import { MIDIProcessor } from '../midi/MIDIProcessor';
import { MIDIParser } from '../midi/MIDIParser';
import { MIDIService } from '../services/MIDIService';
import { RoleMapper } from './RoleMapper';
import { SynthesisEngine } from '../synthesis/SynthesisEngine';

export class MotifEngine {
  private audioContext: AudioContext | null = null;
  private config: MotifConfig;
  private midiProcessor: MIDIProcessor;
  private midiService: MIDIService;
  private roleMapper: RoleMapper;
  private synthesisEngine: SynthesisEngine | null = null;
  private currentFeatures: StructuralFeatures | null = null;

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

  async generateFromMIDI(events: NoteEvent[]): Promise<void> {
    // Process events directly (bypass search/fetch)
    const features = this.midiProcessor.extractFeatures(events);
    const roleAssignments = this.roleMapper.assignRoles(features, events);
    
    this.currentFeatures = features;
    
    // Initialize audio context and synthesis engine
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    
    this.synthesisEngine = new SynthesisEngine(this.audioContext, this.config);
    this.synthesisEngine.setupLayers(roleAssignments);
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
    
    this.currentFeatures = features;
    
    // Initialize audio context and synthesis engine
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    
    this.synthesisEngine = new SynthesisEngine(this.audioContext, this.config);
    this.synthesisEngine.setupLayers(roleAssignments);
  }

  async play(): Promise<void> {
    if (!this.audioContext || !this.synthesisEngine || !this.currentFeatures) {
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