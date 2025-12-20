import type { RoleAssignment, Role, SynthLayer, NoteEvent, ChordEvent } from '../types';

export type SynthModel = 'pre8bit' | 'nes_gb' | 'snes';

/**
 * TestModelSynthesisEngine
 * -----------------------
 * Used ONLY by /models to compare different synthesis models.
 *
 * IMPORTANT:
 * - This is intentionally isolated from the main `SynthesisEngine`.
 * - Do not import this into the main app.
 */
export class TestModelSynthesisEngine {
  private audioContext: AudioContext;
  private model: SynthModel;

  private masterGain: GainNode;
  private postGain: GainNode;

  private layers: Map<Role, SynthLayer> = new Map();
  private roleAssignments: Map<Role, RoleAssignment> = new Map();

  private isPlaying = false;
  private schedulerIntervalId: number | null = null;
  private startTime = 0;
  private nextEventIndex = new Map<Role, number>();

  private activeVoiceCount = 0;
  private maxVoices: number;

  // Simplified scheduling (fine for the lab page)
  private lookaheadTime = 0.12;
  private scheduleInterval = 25;
  private fadeTime = 0.05;

  constructor(audioContext: AudioContext, model: SynthModel) {
    this.audioContext = audioContext;
    this.model = model;

    this.masterGain = audioContext.createGain();
    this.postGain = audioContext.createGain();
    this.postGain.connect(audioContext.destination);

    this.masterGain.gain.value = 0.3;
    this.postGain.gain.value = 1.0;

    // Voice count: SNES = 8 voices. Pre-8bit = ~2. NES/GB = “few”, but keep 8 for fun.
    this.maxVoices = model === 'pre8bit' ? 2 : model === 'snes' ? 8 : 8;

    this.configureMasterChain();
  }

  setVolume(volume: number): void {
    this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
  }

  setupLayers(assignments: RoleAssignment[]): void {
    this.cleanupLayers();
    this.activeVoiceCount = 0;

    const filtered = this.filterAssignments(assignments);

    let earliestTime = Infinity;
    for (const assignment of filtered) {
      if (assignment.events.length > 0) earliestTime = Math.min(earliestTime, assignment.events[0].time);
      if (assignment.chords.length > 0) earliestTime = Math.min(earliestTime, assignment.chords[0].time);
    }

    if (earliestTime !== Infinity && earliestTime > 0) {
      for (const assignment of filtered) {
        for (const e of assignment.events) e.time -= earliestTime;
        for (const c of assignment.chords) c.time -= earliestTime;
      }
    }

    for (const assignment of filtered) {
      const layer = this.createSynthLayer(assignment.role);
      this.layers.set(assignment.role, layer);
      this.roleAssignments.set(assignment.role, assignment);
      this.nextEventIndex.set(assignment.role, 0);
    }
  }

  start(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.startTime = this.audioContext.currentTime;

    for (const role of this.roleAssignments.keys()) {
      this.nextEventIndex.set(role, 0);
    }

    this.schedulerIntervalId = window.setInterval(() => this.scheduleEvents(), this.scheduleInterval);
  }

  stop(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;

    if (this.schedulerIntervalId) {
      clearInterval(this.schedulerIntervalId);
      this.schedulerIntervalId = null;
    }

    this.fadeOutAllLayers();
  }

  private configureMasterChain(): void {
    try { this.masterGain.disconnect(); } catch {}

    // Always connect master -> post, but for SNES we insert a stable “color” chain
    // (bandlimit + gentle saturation + limiter) before post.
    if (this.model !== 'snes') {
      const dry = this.audioContext.createGain();
      dry.gain.value = 1.0;
      this.masterGain.connect(dry);
      dry.connect(this.postGain);
      return;
    }

    // Create a single color chain (stable, avoids per-note ScriptProcessor crackle).
    const colorIn = this.audioContext.createGain();
    const hp = this.audioContext.createBiquadFilter();
    const lp = this.audioContext.createBiquadFilter();
    const shaper = this.audioContext.createWaveShaper();
    const limiter = this.audioContext.createDynamicsCompressor();

    // Band-limit similar to “sample playback through DSP”
    hp.type = 'highpass';
    hp.frequency.value = 45;
    hp.Q.value = 0.7;

    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    lp.Q.value = 0.7;

    // Gentle saturation curve (keeps things from sounding like pure oscillators)
    // Type cast avoids TS lib generic mismatch (runtime is correct).
    shaper.curve = this.makeSoftClipCurve(0.75) as any;
    shaper.oversample = '2x';

    // Limiter to stop “mess” / clipping during dense passages
    limiter.threshold.value = -14;
    limiter.knee.value = 18;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;

    // Wire: master -> colorIn -> hp -> lp -> shaper -> limiter -> post
    this.masterGain.connect(colorIn);
    colorIn.connect(hp);
    hp.connect(lp);
    lp.connect(shaper);
    shaper.connect(limiter);
    limiter.connect(this.postGain);

    // SNES-ish echo (single instance): feedback delay + lowpass in loop
    const wet = this.audioContext.createGain();
    const delay = this.audioContext.createDelay(1.0);
    const feedback = this.audioContext.createGain();
    const fbFilter = this.audioContext.createBiquadFilter();

    wet.gain.value = 0.22;
    delay.delayTime.value = 0.165;
    feedback.gain.value = 0.28;
    fbFilter.type = 'lowpass';
    fbFilter.frequency.value = 2200;
    fbFilter.Q.value = 0.7;

    // Tap echo from color chain output (post-filter) into delay, then back to post.
    lp.connect(delay);
    delay.connect(wet);
    wet.connect(this.postGain);

    delay.connect(fbFilter);
    fbFilter.connect(feedback);
    feedback.connect(delay);

  }

  private filterAssignments(assignments: RoleAssignment[]): RoleAssignment[] {
    if (this.model !== 'pre8bit') return assignments;
    const keep: Role[] = ['melody', 'bass'];
    const kept = assignments.filter(a => keep.includes(a.role));
    if (kept.length > 0) return kept.slice(0, 2);
    return assignments.slice(0, 1);
  }

  private createSynthLayer(role: Role): SynthLayer {
    const gainNode = this.audioContext.createGain();
    const filterNode = this.audioContext.createBiquadFilter();

    if (this.model === 'snes') {
      filterNode.type = 'lowpass';
      filterNode.frequency.value = 2600;
      filterNode.Q.value = 0.9;
    } else {
      filterNode.type = 'lowpass';
      filterNode.frequency.value = 5200;
      filterNode.Q.value = 0.8;
    }

    filterNode.connect(gainNode);
    gainNode.connect(this.masterGain);

    this.configureLayerForRole(gainNode, filterNode, role);

    return { role, oscillators: [], gainNode, filterNode };
  }

  private configureLayerForRole(gain: GainNode, filter: BiquadFilterNode, role: Role): void {
    switch (role) {
      case 'bass':
        gain.gain.value = this.model === 'pre8bit' ? 0.55 : 0.4;
        filter.type = 'lowpass';
        filter.frequency.value = this.model === 'snes' ? 260 : 220;
        break;
      case 'drone':
        gain.gain.value = this.model === 'pre8bit' ? 0.0 : 0.2;
        filter.type = 'bandpass';
        filter.frequency.value = this.model === 'snes' ? 520 : 400;
        break;
      case 'ostinato':
        gain.gain.value = this.model === 'pre8bit' ? 0.25 : 0.3;
        filter.type = 'highpass';
        filter.frequency.value = this.model === 'snes' ? 220 : 300;
        break;
      case 'texture':
        gain.gain.value = this.model === 'pre8bit' ? 0.0 : 0.1;
        filter.type = 'bandpass';
        filter.frequency.value = this.model === 'snes' ? 900 : 800;
        break;
      case 'accents':
        gain.gain.value = this.model === 'pre8bit' ? 0.35 : 0.5;
        filter.type = 'peaking';
        filter.frequency.value = this.model === 'snes' ? 1200 : 1000;
        break;
      case 'melody':
        gain.gain.value = this.model === 'pre8bit' ? 0.42 : 0.35;
        filter.type = 'lowpass';
        filter.frequency.value = this.model === 'snes' ? 3200 : 4200;
        break;
    }
  }

  private midiToFrequency(midiNote: number): number {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  private scheduleEvents(): void {
    if (!this.isPlaying) return;
    const currentTime = this.audioContext.currentTime;
    const scheduleUntil = currentTime + this.lookaheadTime;

    for (const [role, assignment] of this.roleAssignments) {
      this.scheduleRoleEvents(role, assignment, scheduleUntil);
    }
  }

  private scheduleRoleEvents(role: Role, assignment: RoleAssignment, scheduleUntil: number): void {
    const events = assignment.events;
    const chords = assignment.chords;
    if (!events.length && !chords.length) return;

    if (this.model === 'pre8bit') {
      this.scheduleSingleEvents(role, events, scheduleUntil);
      return;
    }

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
      if (eventTime > scheduleUntil) break;

      if (eventTime >= this.audioContext.currentTime) {
        this.scheduleChord(role, chord.pitches, Math.max(0.05, chord.duration), chord.velocity, eventTime);
      }
      chordIndex++;
    }

    this.nextEventIndex.set(role, chordIndex);
    if (chordIndex >= chords.length) this.loopIfEnded(chords.length);
  }

  private scheduleSingleEvents(role: Role, events: NoteEvent[], scheduleUntil: number): void {
    let eventIndex = this.nextEventIndex.get(role) || 0;

    while (eventIndex < events.length) {
      const event = events[eventIndex];
      const eventTime = this.startTime + event.time;
      if (eventTime > scheduleUntil) break;

      if (eventTime >= this.audioContext.currentTime) {
        this.scheduleNote(role, event.pitch, Math.max(0.05, event.duration), event.velocity, eventTime);
      }
      eventIndex++;
    }

    this.nextEventIndex.set(role, eventIndex);
    if (eventIndex >= events.length) this.loopIfEnded(events.length);
  }

  private loopIfEnded(length: number): void {
    if (length <= 0) return;
    if (Array.from(this.nextEventIndex.values()).every(idx => idx === 0 || idx >= length)) {
      for (const role of this.nextEventIndex.keys()) this.nextEventIndex.set(role, 0);
      this.startTime = this.audioContext.currentTime;
    }
  }

  private scheduleNote(role: Role, pitch: number, duration: number, velocity: number, when: number): void {
    const layer = this.layers.get(role);
    if (!layer) return;

    if (this.model === 'pre8bit') {
      if (role !== 'bass' && role !== 'melody') return;
    }

    if (this.activeVoiceCount >= this.maxVoices) return;

    const osc = this.audioContext.createOscillator();
    const envelope = this.audioContext.createGain();
    osc.frequency.value = this.midiToFrequency(pitch);

    if (this.model === 'pre8bit') {
      osc.type = role === 'bass' ? 'triangle' : 'square';
    } else if (this.model === 'snes') {
      if (role === 'bass') osc.type = 'triangle';
      else if (role === 'melody') osc.type = 'sawtooth';
      else if (role === 'drone') osc.type = 'sawtooth';
      else if (role === 'ostinato') osc.type = 'triangle';
      else osc.type = 'sine';
      osc.detune.value = (Math.random() - 0.5) * 8;
    } else {
      if (role === 'bass') osc.type = 'square';
      else if (role === 'drone') osc.type = 'sawtooth';
      else if (role === 'ostinato') osc.type = 'triangle';
      else if (role === 'melody') osc.type = 'triangle';
      else osc.type = 'sine';
    }

    osc.connect(envelope);
    envelope.connect(layer.filterNode);

    const gainValue = velocity * 0.5;
    const attackBase = this.model === 'pre8bit' ? 0.003 : this.model === 'snes' ? 0.01 : 0.005;
    const releaseBase = this.model === 'pre8bit' ? 0.008 : this.model === 'snes' ? 0.14 : 0.01;
    const attackTime = Math.max(attackBase, Math.min(0.06, duration * 0.1));
    const releaseTime = Math.max(releaseBase, Math.min(this.model === 'snes' ? 0.22 : 0.12, duration * 0.3));

    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(gainValue, when + attackTime);
    envelope.gain.setValueAtTime(gainValue, when + Math.max(attackTime, duration - releaseTime));
    envelope.gain.exponentialRampToValueAtTime(0.001, when + duration + releaseTime);

    osc.start(when);
    osc.stop(when + duration + releaseTime + 0.01);
    this.activeVoiceCount++;

    setTimeout(() => {
      try {
        osc.disconnect();
        envelope.disconnect();
      } catch {}
      this.activeVoiceCount = Math.max(0, this.activeVoiceCount - 1);
    }, (duration + releaseTime + 0.1) * 1000);
  }

  private scheduleChord(role: Role, pitches: number[], duration: number, velocity: number, when: number): void {
    const layer = this.layers.get(role);
    if (!layer) return;
    if (this.activeVoiceCount >= this.maxVoices) return;

    const chordPitches = this.model === 'snes' ? pitches.slice(0, 4) : pitches.slice(0, 3);
    for (const pitch of chordPitches) {
      if (this.activeVoiceCount >= this.maxVoices) break;

      const osc = this.audioContext.createOscillator();
      const envelope = this.audioContext.createGain();
      osc.frequency.value = this.midiToFrequency(pitch);

      if (this.model === 'snes') {
        osc.type = role === 'bass' ? 'triangle' : role === 'melody' ? 'sawtooth' : 'sine';
        osc.detune.value = (Math.random() - 0.5) * 8;
      } else {
        osc.type = role === 'bass' ? 'square' : role === 'drone' ? 'sawtooth' : 'triangle';
      }

      osc.connect(envelope);
      envelope.connect(layer.filterNode);

      const gainValue = (velocity * 0.3) / Math.max(chordPitches.length * 0.5, 1);
      const attackBase = this.model === 'snes' ? 0.01 : 0.005;
      const releaseBase = this.model === 'snes' ? 0.16 : 0.01;
      const attackTime = Math.max(attackBase, Math.min(0.06, duration * 0.1));
      const releaseTime = Math.max(releaseBase, Math.min(this.model === 'snes' ? 0.24 : 0.12, duration * 0.3));

      envelope.gain.setValueAtTime(0, when);
      envelope.gain.linearRampToValueAtTime(gainValue, when + attackTime);
      envelope.gain.setValueAtTime(gainValue, when + Math.max(attackTime, duration - releaseTime));
      envelope.gain.exponentialRampToValueAtTime(0.001, when + duration + releaseTime);

      osc.start(when);
      osc.stop(when + duration + releaseTime + 0.01);
      this.activeVoiceCount++;

      setTimeout(() => {
        try {
          osc.disconnect();
          envelope.disconnect();
        } catch {}
        this.activeVoiceCount = Math.max(0, this.activeVoiceCount - 1);
      }, (duration + releaseTime + 0.1) * 1000);
    }
  }

  private makeSoftClipCurve(amount: number): Float32Array {
    // amount: 0..1 (higher = more distortion)
    const k = 1 + amount * 30;
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve as unknown as Float32Array;
  }

  private fadeOutAllLayers(): void {
    const when = this.audioContext.currentTime;
    for (const layer of this.layers.values()) {
      layer.gainNode.gain.linearRampToValueAtTime(0, when + this.fadeTime);
    }
    setTimeout(() => this.cleanupLayers(), this.fadeTime * 1000 + 100);
  }

  private cleanupLayers(): void {
    for (const layer of this.layers.values()) {
      for (const osc of layer.oscillators) {
        try {
          osc.stop();
          osc.disconnect();
        } catch {}
      }
      try { layer.gainNode.disconnect(); } catch {}
      try { layer.filterNode.disconnect(); } catch {}
    }
    this.layers.clear();
    this.roleAssignments.clear();
    this.nextEventIndex.clear();
  }
}

