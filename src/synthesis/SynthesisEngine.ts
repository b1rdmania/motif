import type { RoleAssignment, MotifConfig, SynthLayer, Role, NoteEvent, ChordEvent, SynthModel } from '../types';

export class SynthesisEngine {
  private audioContext: AudioContext;
  private config: MotifConfig;
  private masterGain: GainNode;
  private postGain: GainNode;
  private model: SynthModel;
  private layers: Map<Role, SynthLayer> = new Map();
  private roleAssignments: Map<Role, RoleAssignment> = new Map();
  private isPlaying = false;
  private schedulerIntervalId: number | null = null;
  private startTime = 0;
  private nextEventIndex = new Map<Role, number>();
  private activeVoiceCount = 0;
  private maxVoices: number;
  private effectCleanup: (() => void) | null = null;

  constructor(audioContext: AudioContext, config: MotifConfig, model: SynthModel = 'nes_gb') {
    this.audioContext = audioContext;
    this.config = config;
    this.masterGain = audioContext.createGain();
    this.postGain = audioContext.createGain();
    this.postGain.connect(audioContext.destination);

    this.model = model;
    this.maxVoices = this.getMaxVoicesForModel(model, config.maxOscillators);

    // Default overall level
    this.masterGain.gain.value = 0.3;
    this.postGain.gain.value = 1.0;

    // Route + optional effects
    this.effectCleanup = this.configureMasterChain(model);
  }

  setupLayers(assignments: RoleAssignment[]): void {
    // Clean up existing layers
    this.cleanupLayers();

    // Reset voice budgeting per setup (important when switching models)
    this.activeVoiceCount = 0;

    // Apply model role filtering
    const filteredAssignments = this.filterAssignmentsForModel(assignments);

    // Find the earliest event time across all assignments
    let earliestTime = Infinity;
    for (const assignment of filteredAssignments) {
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
      for (const assignment of filteredAssignments) {
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
    for (const assignment of filteredAssignments) {
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

  private configureLayerForRole(gain: GainNode, filter: BiquadFilterNode, role: Role): void {
    // Default per-model filter shaping (keeps presets recognizable)
    if (this.model === 'pre8bit') {
      // Very bright, very simple
      filter.type = 'lowpass';
      filter.frequency.value = 6000;
      filter.Q.value = 0.8;
    } else if (this.model === 'snes_ish') {
      // Warmer, a little more body
      filter.type = 'lowpass';
      filter.frequency.value = 2400;
      filter.Q.value = 0.9;
    }

    switch (role) {
      case 'bass':
        gain.gain.value = this.model === 'pre8bit' ? 0.5 : 0.4;
        if (this.model !== 'pre8bit') {
          filter.type = 'lowpass';
          filter.frequency.value = this.model === 'snes_ish' ? 260 : 200;
        } else {
          filter.frequency.value = 350;
        }
        break;
      case 'drone':
        gain.gain.value = this.model === 'pre8bit' ? 0.0 : 0.2;
        if (this.model !== 'pre8bit') {
          filter.type = 'bandpass';
          filter.frequency.value = this.model === 'snes_ish' ? 520 : 400;
        }
        break;
      case 'ostinato':
        gain.gain.value = this.model === 'pre8bit' ? 0.25 : 0.3;
        if (this.model !== 'pre8bit') {
          filter.type = 'highpass';
          filter.frequency.value = this.model === 'snes_ish' ? 220 : 300;
        }
        break;
      case 'texture':
        gain.gain.value = this.model === 'pre8bit' ? 0.0 : 0.1;
        if (this.model !== 'pre8bit') {
          filter.type = 'bandpass';
          filter.frequency.value = this.model === 'snes_ish' ? 900 : 800;
        }
        break;
      case 'accents':
        gain.gain.value = this.model === 'pre8bit' ? 0.35 : 0.5;
        if (this.model !== 'pre8bit') {
          filter.type = 'peaking';
          filter.frequency.value = this.model === 'snes_ish' ? 1200 : 1000;
        }
        break;
      case 'melody':
        // Passthrough mode - balanced sound for all notes
        gain.gain.value = this.model === 'pre8bit' ? 0.4 : 0.35;
        filter.type = 'lowpass';
        filter.frequency.value = this.model === 'snes_ish' ? 3200 : 4000; // Brighter for chip, warmer for SNES-ish
        break;
    }
  }

  private midiToFrequency(midiNote: number): number {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  private scheduleNote(role: Role, pitch: number, duration: number, velocity: number, when: number): void {
    const layer = this.layers.get(role);
    if (!layer) return;

    // Model gating: pre8bit runs intentionally sparse
    if (this.model === 'pre8bit') {
      if (role !== 'bass' && role !== 'melody') return;
    }

    if (this.activeVoiceCount >= this.maxVoices) return;
    
    const osc = this.audioContext.createOscillator();
    const envelope = this.audioContext.createGain();
    
    // Convert MIDI pitch to frequency
    const frequency = this.midiToFrequency(pitch);
    osc.frequency.value = frequency;
    
    // Choose oscillator type based on model + role
    if (this.model === 'pre8bit') {
      osc.type = role === 'bass' ? 'triangle' : 'square';
    } else if (this.model === 'snes_ish') {
      // Warmer “sample-ish” feel: richer waveforms + filtering + echo on master
      if (role === 'bass') osc.type = 'triangle';
      else if (role === 'drone') osc.type = 'sawtooth';
      else if (role === 'ostinato') osc.type = 'triangle';
      else if (role === 'melody') osc.type = 'sawtooth';
      else osc.type = 'sine';

      // Subtle detune (feels less “pure chip”)
      osc.detune.value = (Math.random() - 0.5) * 8; // ±4 cents
    } else {
      // nes_gb (current default)
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
    }
    
    osc.connect(envelope);
    envelope.connect(layer.filterNode);
    
    // Envelope tuned per model (still with minimum times to prevent clicks)
    const gainValue = velocity * 0.5; // Scale velocity
    const attackBase = this.model === 'pre8bit' ? 0.003 : this.model === 'snes_ish' ? 0.01 : 0.005;
    const releaseBase = this.model === 'pre8bit' ? 0.008 : this.model === 'snes_ish' ? 0.14 : 0.01;
    const attackTime = Math.max(attackBase, Math.min(0.06, duration * 0.1));
    const releaseTime = Math.max(releaseBase, Math.min(this.model === 'snes_ish' ? 0.22 : 0.12, duration * 0.3));

    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(gainValue, when + attackTime);
    envelope.gain.setValueAtTime(gainValue, when + Math.max(attackTime, duration - releaseTime));
    envelope.gain.exponentialRampToValueAtTime(0.001, when + duration + releaseTime);

    osc.start(when);
    osc.stop(when + duration + releaseTime + 0.01); // Stop after envelope completes

    this.activeVoiceCount++;
    
    // Clean up after note ends
    setTimeout(() => {
      try {
        osc.disconnect();
        envelope.disconnect();
      } catch (e) {
        // Already disconnected
      }
      this.activeVoiceCount = Math.max(0, this.activeVoiceCount - 1);
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
    
    // pre8bit is intentionally simple: no chord scheduling
    if (this.model === 'pre8bit') {
      this.scheduleSingleEvents(role, events, scheduleUntil);
      return;
    }

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

    if (this.activeVoiceCount >= this.maxVoices) return;
    
    // Create oscillator for each pitch in the chord (unless constrained)
    const chordPitches = this.model === 'snes_ish' ? pitches.slice(0, 4) : pitches.slice(0, 3);
    for (const pitch of chordPitches) {
      if (this.activeVoiceCount >= this.maxVoices) break;
      const osc = this.audioContext.createOscillator();
      const envelope = this.audioContext.createGain();
      
      // Convert MIDI pitch to frequency
      const frequency = this.midiToFrequency(pitch);
      osc.frequency.value = frequency;
      
      // Choose oscillator type based on model + role (same as note path)
      if (this.model === 'snes_ish') {
        if (role === 'bass') osc.type = 'triangle';
        else if (role === 'drone') osc.type = 'sawtooth';
        else if (role === 'ostinato') osc.type = 'triangle';
        else if (role === 'melody') osc.type = 'sawtooth';
        else osc.type = 'sine';
        osc.detune.value = (Math.random() - 0.5) * 8;
      } else {
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
      }
      
      osc.connect(envelope);
      envelope.connect(layer.filterNode);
      
      // Envelope based on velocity and duration, scaled for chords with minimum times to prevent clicks
      const gainValue = (velocity * 0.3) / Math.max(chordPitches.length * 0.5, 1); // Scale down for chords
      const attackBase = this.model === 'snes_ish' ? 0.01 : 0.005;
      const releaseBase = this.model === 'snes_ish' ? 0.16 : 0.01;
      const attackTime = Math.max(attackBase, Math.min(0.06, duration * 0.1));
      const releaseTime = Math.max(releaseBase, Math.min(this.model === 'snes_ish' ? 0.24 : 0.12, duration * 0.3));

      envelope.gain.setValueAtTime(0, when);
      envelope.gain.linearRampToValueAtTime(gainValue, when + attackTime);
      envelope.gain.setValueAtTime(gainValue, when + Math.max(attackTime, duration - releaseTime));
      envelope.gain.exponentialRampToValueAtTime(0.001, when + duration + releaseTime);

      osc.start(when);
      osc.stop(when + duration + releaseTime + 0.01); // Stop after envelope completes

      this.activeVoiceCount++;

      // Clean up after note ends
      setTimeout(() => {
        try {
          osc.disconnect();
          envelope.disconnect();
        } catch (e) {
          // Already disconnected
        }
        this.activeVoiceCount = Math.max(0, this.activeVoiceCount - 1);
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

  private getMaxVoicesForModel(model: SynthModel, defaultMax: number): number {
    if (model === 'pre8bit') return Math.min(2, defaultMax);
    if (model === 'snes_ish') return Math.max(12, defaultMax);
    return defaultMax;
  }

  private filterAssignmentsForModel(assignments: RoleAssignment[]): RoleAssignment[] {
    if (this.model === 'pre8bit') {
      // Keep it intentionally simple and sparse.
      const keep: Role[] = ['melody', 'bass'];
      const kept = assignments.filter(a => keep.includes(a.role));
      // If role mapper didn’t produce those roles, fall back to first available assignment.
      if (kept.length > 0) return kept.slice(0, 2);
      return assignments.slice(0, 1);
    }
    return assignments;
  }

  private configureMasterChain(model: SynthModel): () => void {
    // Disconnect any previous chain
    try { this.masterGain.disconnect(); } catch {}
    if (this.effectCleanup) {
      try { this.effectCleanup(); } catch {}
    }

    // Default: dry only
    if (model !== 'snes_ish') {
      this.masterGain.connect(this.postGain);
      return () => {
        try { this.masterGain.disconnect(); } catch {}
      };
    }

    // SNES-ish: add a simple echo/reverb-like feedback delay with filtering.
    const dry = this.audioContext.createGain();
    const wet = this.audioContext.createGain();
    const delay = this.audioContext.createDelay(1.0);
    const feedback = this.audioContext.createGain();
    const fbFilter = this.audioContext.createBiquadFilter();

    dry.gain.value = 0.85;
    wet.gain.value = 0.28;
    delay.delayTime.value = 0.165; // ~165ms echo
    feedback.gain.value = 0.32;
    fbFilter.type = 'lowpass';
    fbFilter.frequency.value = 1800;
    fbFilter.Q.value = 0.7;

    // master -> dry -> post
    this.masterGain.connect(dry);
    dry.connect(this.postGain);

    // master -> delay -> wet -> post
    this.masterGain.connect(delay);
    delay.connect(wet);
    wet.connect(this.postGain);

    // feedback loop: delay -> filter -> feedback -> delay
    delay.connect(fbFilter);
    fbFilter.connect(feedback);
    feedback.connect(delay);

    return () => {
      try { this.masterGain.disconnect(); } catch {}
      try { dry.disconnect(); } catch {}
      try { wet.disconnect(); } catch {}
      try { delay.disconnect(); } catch {}
      try { feedback.disconnect(); } catch {}
      try { fbFilter.disconnect(); } catch {}
    };
  }
}