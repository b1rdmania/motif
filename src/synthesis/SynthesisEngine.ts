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

  /**
   * Connect the master output to an additional node (e.g. recorder tap).
   * This does not change the default destination routing.
   */
  connectOutput(node: AudioNode): void {
    this.masterGain.connect(node);
  }

  /**
   * Disconnect a previously connected output tap.
   */
  disconnectOutput(node: AudioNode): void {
    try {
      this.masterGain.disconnect(node);
    } catch {
      // ignore (node might not be connected)
    }
  }

  setupLayers(assignments: RoleAssignment[]): void {
    // Clean up existing layers
    this.cleanupLayers();

    // Find the earliest event time across all assignments
    let earliestTime = Infinity;
    for (const assignment of assignments) {
      if (assignment.events.length > 0) {
        earliestTime = Math.min(earliestTime, assignment.events[0].time);
      }
      if (assignment.chords.length > 0) {
        earliestTime = Math.min(earliestTime, assignment.chords[0].time);
      }
    }

    // If we found events, normalize times to start at 0
    if (earliestTime !== Infinity && earliestTime > 0) {
      console.log('Normalizing event times, earliest was:', earliestTime);
      for (const assignment of assignments) {
        // Normalize note events
        for (const event of assignment.events) {
          event.time -= earliestTime;
        }
        // Normalize chord events
        for (const chord of assignment.chords) {
          chord.time -= earliestTime;
        }
      }
    }

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

    // Restore layer gains (they may have been faded to 0 on stop)
    for (const [role, layer] of this.layers) {
      layer.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
      this.restoreLayerGain(layer.gainNode, role);
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

  seek(progress: number): void {
    if (!this.isPlaying) return;

    // Calculate the new start time based on progress
    const duration = this.getDuration();
    const targetTime = progress * duration;

    // Adjust startTime to effectively seek to the target position
    this.startTime = this.audioContext.currentTime - targetTime;

    // Reset event indices to the appropriate position
    for (const [role, assignment] of this.roleAssignments) {
      const events = assignment.events;
      if (events.length > 0) {
        // Find the first event after the target time
        let index = 0;
        while (index < events.length && events[index].time < targetTime) {
          index++;
        }
        this.nextEventIndex.set(role, index);
      }
    }
  }

  getProgress(): number {
    if (!this.isPlaying) return 0;

    const duration = this.getDuration();
    if (duration === 0) return 0;

    const currentTime = this.audioContext.currentTime - this.startTime;
    return Math.max(0, Math.min(1, currentTime / duration));
  }

  getCurrentTime(): number {
    if (!this.isPlaying) return 0;
    return Math.max(0, this.audioContext.currentTime - this.startTime);
  }

  getDuration(): number {
    let maxDuration = 0;

    for (const assignment of this.roleAssignments.values()) {
      if (assignment.events.length > 0) {
        const lastEvent = assignment.events[assignment.events.length - 1];
        const eventEnd = lastEvent.time + lastEvent.duration;
        maxDuration = Math.max(maxDuration, eventEnd);
      }

      if (assignment.chords.length > 0) {
        const lastChord = assignment.chords[assignment.chords.length - 1];
        const chordEnd = lastChord.time + lastChord.duration;
        maxDuration = Math.max(maxDuration, chordEnd);
      }
    }

    return maxDuration;
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

  private getLayerGainForRole(role: Role): number {
    switch (role) {
      case 'bass': return 0.4;
      case 'drone': return 0.2;
      case 'ostinato': return 0.3;
      case 'texture': return 0.1;
      case 'accents': return 0.5;
      case 'melody': return 0.35;
      default: return 0.3;
    }
  }

  private restoreLayerGain(gain: GainNode, role: Role): void {
    gain.gain.setValueAtTime(this.getLayerGainForRole(role), this.audioContext.currentTime);
  }

  private configureLayerForRole(gain: GainNode, filter: BiquadFilterNode, role: Role): void {
    gain.gain.value = this.getLayerGainForRole(role);

    switch (role) {
      case 'bass':
        filter.type = 'lowpass';
        filter.frequency.value = 200;
        break;
      case 'drone':
        filter.type = 'bandpass';
        filter.frequency.value = 400;
        break;
      case 'ostinato':
        filter.type = 'highpass';
        filter.frequency.value = 300;
        break;
      case 'texture':
        filter.type = 'bandpass';
        filter.frequency.value = 800;
        break;
      case 'accents':
        filter.type = 'peaking';
        filter.frequency.value = 1000;
        break;
      case 'melody':
        filter.type = 'lowpass';
        filter.frequency.value = 4000;
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
      // Cancel any scheduled ramps and fade to 0
      layer.gainNode.gain.cancelScheduledValues(when);
      layer.gainNode.gain.setValueAtTime(layer.gainNode.gain.value, when);
      layer.gainNode.gain.linearRampToValueAtTime(0, when + fadeTime);
    }

    // Don't cleanup layers - keep them connected for resume
    // Layers are only cleaned up when setupLayers is called with new data
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

  /**
   * Render audio offline (faster than real-time) to an AudioBuffer.
   * This is a static method that creates its own offline context and scheduling.
   */
  static async renderOffline(
    assignments: RoleAssignment[],
    _config: MotifConfig,
    sampleRate = 44100
  ): Promise<AudioBuffer> {
    // Calculate duration from assignments
    let maxDuration = 0;
    for (const assignment of assignments) {
      for (const event of assignment.events) {
        const eventEnd = event.time + event.duration;
        maxDuration = Math.max(maxDuration, eventEnd);
      }
      for (const chord of assignment.chords) {
        const chordEnd = chord.time + chord.duration;
        maxDuration = Math.max(maxDuration, chordEnd);
      }
    }

    // Add a little padding for release envelopes
    const totalDuration = maxDuration + 0.5;
    const totalSamples = Math.ceil(totalDuration * sampleRate);

    // Create offline context
    const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

    // Create master gain
    const masterGain = offlineCtx.createGain();
    masterGain.connect(offlineCtx.destination);
    masterGain.gain.value = 0.3;

    // Normalize times (same logic as setupLayers)
    let earliestTime = Infinity;
    for (const assignment of assignments) {
      if (assignment.events.length > 0) {
        earliestTime = Math.min(earliestTime, assignment.events[0].time);
      }
      if (assignment.chords.length > 0) {
        earliestTime = Math.min(earliestTime, assignment.chords[0].time);
      }
    }
    if (earliestTime !== Infinity && earliestTime > 0) {
      for (const assignment of assignments) {
        for (const event of assignment.events) {
          event.time -= earliestTime;
        }
        for (const chord of assignment.chords) {
          chord.time -= earliestTime;
        }
      }
    }

    // Schedule all events for each assignment
    for (const assignment of assignments) {
      const { role, events, chords } = assignment;

      // Create layer nodes for this role
      const { filterNode } = SynthesisEngine.createOfflineLayer(offlineCtx, masterGain, role);

      // For roles that support polyphony, prefer chords
      if ((role === 'drone' || role === 'texture') && chords.length > 0) {
        for (const chord of chords) {
          SynthesisEngine.scheduleOfflineChord(
            offlineCtx,
            filterNode,
            role,
            chord.pitches,
            Math.max(0.05, chord.duration),
            chord.velocity,
            chord.time
          );
        }
      } else {
        for (const event of events) {
          SynthesisEngine.scheduleOfflineNote(
            offlineCtx,
            filterNode,
            role,
            event.pitch,
            Math.max(0.05, event.duration),
            event.velocity,
            event.time
          );
        }
      }
    }

    // Render and return
    return offlineCtx.startRendering();
  }

  private static createOfflineLayer(
    ctx: OfflineAudioContext,
    masterGain: GainNode,
    role: Role
  ): { gainNode: GainNode; filterNode: BiquadFilterNode } {
    const gainNode = ctx.createGain();
    const filterNode = ctx.createBiquadFilter();

    filterNode.connect(gainNode);
    gainNode.connect(masterGain);

    // Set gain based on role
    switch (role) {
      case 'bass': gainNode.gain.value = 0.4; break;
      case 'drone': gainNode.gain.value = 0.2; break;
      case 'ostinato': gainNode.gain.value = 0.3; break;
      case 'texture': gainNode.gain.value = 0.1; break;
      case 'accents': gainNode.gain.value = 0.5; break;
      case 'melody': gainNode.gain.value = 0.35; break;
      default: gainNode.gain.value = 0.3;
    }

    // Configure filter based on role
    switch (role) {
      case 'bass':
        filterNode.type = 'lowpass';
        filterNode.frequency.value = 200;
        break;
      case 'drone':
        filterNode.type = 'bandpass';
        filterNode.frequency.value = 400;
        break;
      case 'ostinato':
        filterNode.type = 'highpass';
        filterNode.frequency.value = 300;
        break;
      case 'texture':
        filterNode.type = 'bandpass';
        filterNode.frequency.value = 800;
        break;
      case 'accents':
        filterNode.type = 'peaking';
        filterNode.frequency.value = 1000;
        break;
      case 'melody':
        filterNode.type = 'lowpass';
        filterNode.frequency.value = 4000;
        break;
    }

    return { gainNode, filterNode };
  }

  private static midiToFreq(midiNote: number): number {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  private static getOscillatorType(role: Role): OscillatorType {
    switch (role) {
      case 'bass': return 'square';
      case 'drone': return 'sawtooth';
      case 'ostinato': return 'triangle';
      case 'melody': return 'triangle';
      case 'texture': return 'sine';
      case 'accents': return 'sine';
      default: return 'sine';
    }
  }

  private static scheduleOfflineNote(
    ctx: OfflineAudioContext,
    filterNode: BiquadFilterNode,
    role: Role,
    pitch: number,
    duration: number,
    velocity: number,
    when: number
  ): void {
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();

    osc.frequency.value = SynthesisEngine.midiToFreq(pitch);
    osc.type = SynthesisEngine.getOscillatorType(role);

    osc.connect(envelope);
    envelope.connect(filterNode);

    const gainValue = velocity * 0.5;
    const attackTime = Math.max(0.005, Math.min(0.05, duration * 0.1));
    const releaseTime = Math.max(0.01, Math.min(0.1, duration * 0.3));

    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(gainValue, when + attackTime);
    envelope.gain.setValueAtTime(gainValue, when + Math.max(attackTime, duration - releaseTime));
    envelope.gain.exponentialRampToValueAtTime(0.001, when + duration + releaseTime);

    osc.start(when);
    osc.stop(when + duration + releaseTime + 0.01);
  }

  private static scheduleOfflineChord(
    ctx: OfflineAudioContext,
    filterNode: BiquadFilterNode,
    role: Role,
    pitches: number[],
    duration: number,
    velocity: number,
    when: number
  ): void {
    for (const pitch of pitches) {
      const osc = ctx.createOscillator();
      const envelope = ctx.createGain();

      osc.frequency.value = SynthesisEngine.midiToFreq(pitch);
      osc.type = SynthesisEngine.getOscillatorType(role);

      osc.connect(envelope);
      envelope.connect(filterNode);

      const gainValue = (velocity * 0.3) / Math.max(pitches.length * 0.5, 1);
      const attackTime = Math.max(0.005, Math.min(0.05, duration * 0.1));
      const releaseTime = Math.max(0.01, Math.min(0.1, duration * 0.3));

      envelope.gain.setValueAtTime(0, when);
      envelope.gain.linearRampToValueAtTime(gainValue, when + attackTime);
      envelope.gain.setValueAtTime(gainValue, when + Math.max(attackTime, duration - releaseTime));
      envelope.gain.exponentialRampToValueAtTime(0.001, when + duration + releaseTime);

      osc.start(when);
      osc.stop(when + duration + releaseTime + 0.01);
    }
  }
}