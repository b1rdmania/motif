import type { RoleAssignment, MotifConfig, SynthLayer, Role, NoteEvent, ChordEvent } from '../types';

export class SynthesisEngine {
  private audioContext: AudioContext;
  private config: MotifConfig;
  private masterGain: GainNode;
  private layers: Map<Role, SynthLayer> = new Map();
  private roleAssignments: Map<Role, RoleAssignment> = new Map();
  private isPlaying = false;
  private schedulerIntervalId: number | null = null;
  private startTime = 0;
  private nextEventIndex = new Map<Role, number>();

  constructor(audioContext: AudioContext, config: MotifConfig) {
    this.audioContext = audioContext;
    this.config = config;
    this.masterGain = audioContext.createGain();
    this.masterGain.connect(audioContext.destination);
    this.masterGain.gain.value = 0.3;
  }

  setupLayers(assignments: RoleAssignment[]): void {
    // Clean up existing layers
    this.cleanupLayers();
    
    // Store role assignments and create layers
    for (const assignment of assignments) {
      const layer = this.createSynthLayer(assignment.role);
      this.layers.set(assignment.role, layer);
      this.roleAssignments.set(assignment.role, assignment);
      this.nextEventIndex.set(assignment.role, 0);
    }
    
    console.log('Setup layers for roles:', Array.from(this.roleAssignments.keys()));
  }

  start(): void {
    if (this.isPlaying) return;
    
    this.isPlaying = true;
    this.startTime = this.audioContext.currentTime;
    
    // Reset event indices
    for (const role of this.roleAssignments.keys()) {
      this.nextEventIndex.set(role, 0);
    }
    
    // Start scheduler to play actual MIDI events
    this.schedulerIntervalId = window.setInterval(() => {
      this.scheduleEvents();
    }, this.config.scheduleInterval);
    
    console.log('Started synthesis with', this.roleAssignments.size, 'roles');
  }

  stop(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;

    if (this.schedulerIntervalId) {
      clearInterval(this.schedulerIntervalId);
      this.schedulerIntervalId = null;
    }

    // Fade out all layers
    this.fadeOutAllLayers();
  }

  setVolume(volume: number): void {
    this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
  }

  private createSynthLayer(role: Role): SynthLayer {
    const gainNode = this.audioContext.createGain();
    const filterNode = this.audioContext.createBiquadFilter();
    
    filterNode.connect(gainNode);
    gainNode.connect(this.masterGain);
    
    // Configure based on role
    this.configureLayerForRole(gainNode, filterNode, role);
    
    return {
      role,
      oscillators: [],
      gainNode,
      filterNode
    };
  }

  private configureLayerForRole(gain: GainNode, filter: BiquadFilterNode, role: Role): void {
    switch (role) {
      case 'bass':
        gain.gain.value = 0.4;
        filter.type = 'lowpass';
        filter.frequency.value = 200;
        break;
      case 'drone':
        gain.gain.value = 0.2;
        filter.type = 'bandpass';
        filter.frequency.value = 400;
        break;
      case 'ostinato':
        gain.gain.value = 0.3;
        filter.type = 'highpass';
        filter.frequency.value = 300;
        break;
      case 'texture':
        gain.gain.value = 0.1;
        filter.type = 'bandpass';
        filter.frequency.value = 800;
        break;
      case 'accents':
        gain.gain.value = 0.5;
        filter.type = 'peaking';
        filter.frequency.value = 1000;
        break;
      case 'melody':
        // Passthrough mode - balanced sound for all notes
        gain.gain.value = 0.35;
        filter.type = 'lowpass';
        filter.frequency.value = 4000; // Brighter sound for full range
        break;
    }
  }

  private midiToFrequency(midiNote: number): number {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  private scheduleNote(role: Role, pitch: number, duration: number, velocity: number, when: number): void {
    const layer = this.layers.get(role);
    if (!layer) return;
    
    const osc = this.audioContext.createOscillator();
    const envelope = this.audioContext.createGain();
    
    // Convert MIDI pitch to frequency
    const frequency = this.midiToFrequency(pitch);
    osc.frequency.value = frequency;
    
    // Choose oscillator type based on role
    switch (role) {
      case 'bass':
        osc.type = 'square';
        break;
      case 'drone':
        osc.type = 'sawtooth';
        break;
      case 'ostinato':
        osc.type = 'triangle';
        break;
      case 'melody':
        osc.type = 'triangle';
        break;
      case 'texture':
      case 'accents':
        osc.type = 'sine';
        break;
    }
    
    osc.connect(envelope);
    envelope.connect(layer.filterNode);
    
    // Envelope based on velocity and duration with minimum times to prevent clicks
    const gainValue = velocity * 0.5; // Scale velocity
    const attackTime = Math.max(0.005, Math.min(0.05, duration * 0.1)); // Min 5ms attack
    const releaseTime = Math.max(0.01, Math.min(0.1, duration * 0.3)); // Min 10ms release

    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(gainValue, when + attackTime);
    envelope.gain.setValueAtTime(gainValue, when + Math.max(attackTime, duration - releaseTime));
    envelope.gain.exponentialRampToValueAtTime(0.001, when + duration + releaseTime);

    osc.start(when);
    osc.stop(when + duration + releaseTime + 0.01); // Stop after envelope completes
    
    // Clean up after note ends
    setTimeout(() => {
      try {
        osc.disconnect();
        envelope.disconnect();
      } catch (e) {
        // Already disconnected
      }
    }, (duration + releaseTime + 0.1) * 1000);
  }

  private scheduleEvents(): void {
    if (!this.isPlaying) return;
    
    const currentTime = this.audioContext.currentTime;
    const scheduleUntil = currentTime + this.config.lookaheadTime;
    
    // Schedule events for each role
    for (const [role, assignment] of this.roleAssignments) {
      this.scheduleRoleEvents(role, assignment, scheduleUntil);
    }
  }

  private scheduleRoleEvents(role: Role, assignment: RoleAssignment, scheduleUntil: number): void {
    const events = assignment.events;
    const chords = assignment.chords;
    
    if (!events.length && !chords.length) return;
    
    // For roles that support polyphony (drone, texture), prefer chords
    if ((role === 'drone' || role === 'texture') && chords.length > 0) {
      this.scheduleChordEvents(role, chords, scheduleUntil);
    } else {
      this.scheduleSingleEvents(role, events, scheduleUntil);
    }
  }

  private scheduleChordEvents(role: Role, chords: ChordEvent[], scheduleUntil: number): void {
    let chordIndex = this.nextEventIndex.get(role) || 0;
    
    while (chordIndex < chords.length) {
      const chord = chords[chordIndex];
      const eventTime = this.startTime + chord.time;
      
      // Stop if we're past the lookahead window
      if (eventTime > scheduleUntil) break;
      
      // Schedule if the chord hasn't been played yet
      if (eventTime >= this.audioContext.currentTime) {
        this.scheduleChord(
          role,
          chord.pitches,
          Math.max(0.05, chord.duration),
          chord.velocity,
          eventTime
        );
      }
      
      chordIndex++;
    }
    
    // Update the next event index
    this.nextEventIndex.set(role, chordIndex);
    
    // Loop if we've reached the end
    if (chordIndex >= chords.length) {
      this.nextEventIndex.set(role, 0);
      // Reset start time for looping
      if (Array.from(this.nextEventIndex.values()).every(idx => idx === 0)) {
        this.startTime = this.audioContext.currentTime;
      }
    }
  }

  private scheduleSingleEvents(role: Role, events: NoteEvent[], scheduleUntil: number): void {
    let eventIndex = this.nextEventIndex.get(role) || 0;
    
    while (eventIndex < events.length) {
      const event = events[eventIndex];
      const eventTime = this.startTime + event.time;
      
      // Stop if we're past the lookahead window
      if (eventTime > scheduleUntil) break;
      
      // Schedule if the event hasn't been played yet
      if (eventTime >= this.audioContext.currentTime) {
        this.scheduleNote(
          role,
          event.pitch,
          Math.max(0.05, event.duration), // Minimum duration
          event.velocity,
          eventTime
        );
      }
      
      eventIndex++;
    }
    
    // Update the next event index
    this.nextEventIndex.set(role, eventIndex);
    
    // Loop if we've reached the end
    if (eventIndex >= events.length) {
      this.nextEventIndex.set(role, 0);
      // Reset start time for looping
      if (Array.from(this.nextEventIndex.values()).every(idx => idx === 0)) {
        this.startTime = this.audioContext.currentTime;
      }
    }
  }





  private fadeOutAllLayers(): void {
    const fadeTime = this.config.fadeTime;
    const when = this.audioContext.currentTime;
    
    for (const layer of this.layers.values()) {
      layer.gainNode.gain.linearRampToValueAtTime(0, when + fadeTime);
    }
    
    setTimeout(() => {
      this.cleanupLayers();
    }, fadeTime * 1000 + 100);
  }

  private scheduleChord(role: Role, pitches: number[], duration: number, velocity: number, when: number): void {
    const layer = this.layers.get(role);
    if (!layer) return;
    
    // Create oscillator for each pitch in the chord
    for (const pitch of pitches) {
      const osc = this.audioContext.createOscillator();
      const envelope = this.audioContext.createGain();
      
      // Convert MIDI pitch to frequency
      const frequency = this.midiToFrequency(pitch);
      osc.frequency.value = frequency;
      
      // Choose oscillator type based on role
      switch (role) {
        case 'bass':
          osc.type = 'square';
          break;
        case 'drone':
          osc.type = 'sawtooth';
          break;
        case 'ostinato':
          osc.type = 'triangle';
          break;
        case 'texture':
          osc.type = 'sine';
          break;
        case 'melody':
          osc.type = 'triangle';
          break;
        case 'accents':
          osc.type = 'sine';
          break;
      }
      
      osc.connect(envelope);
      envelope.connect(layer.filterNode);
      
      // Envelope based on velocity and duration, scaled for chords with minimum times to prevent clicks
      const gainValue = (velocity * 0.3) / Math.max(pitches.length * 0.5, 1); // Scale down for chords
      const attackTime = Math.max(0.005, Math.min(0.05, duration * 0.1)); // Min 5ms attack
      const releaseTime = Math.max(0.01, Math.min(0.1, duration * 0.3)); // Min 10ms release

      envelope.gain.setValueAtTime(0, when);
      envelope.gain.linearRampToValueAtTime(gainValue, when + attackTime);
      envelope.gain.setValueAtTime(gainValue, when + Math.max(attackTime, duration - releaseTime));
      envelope.gain.exponentialRampToValueAtTime(0.001, when + duration + releaseTime);

      osc.start(when);
      osc.stop(when + duration + releaseTime + 0.01); // Stop after envelope completes

      // Clean up after note ends
      setTimeout(() => {
        try {
          osc.disconnect();
          envelope.disconnect();
        } catch (e) {
          // Already disconnected
        }
      }, (duration + releaseTime + 0.1) * 1000);
    }
  }

  private cleanupLayers(): void {
    for (const layer of this.layers.values()) {
      for (const osc of layer.oscillators) {
        try {
          osc.stop();
          osc.disconnect();
        } catch (e) {
          // Oscillator might already be stopped
        }
      }
      layer.gainNode.disconnect();
      layer.filterNode.disconnect();
    }
    this.layers.clear();
  }
}