import type { RoleAssignment, MotifConfig, SynthLayer, Role } from '../types';

export class SynthesisEngine {
  private audioContext: AudioContext;
  private config: MotifConfig;
  private masterGain: GainNode;
  private layers: Map<Role, SynthLayer> = new Map();
  private isPlaying = false;
  private schedulerIntervalId: number | null = null;
  private currentTime = 0;
  private startTime = 0;

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
    
    for (const assignment of assignments) {
      const layer = this.createSynthLayer(assignment.role);
      this.layers.set(assignment.role, layer);
    }
  }

  start(): void {
    if (this.isPlaying) return;
    
    this.isPlaying = true;
    this.startTime = this.audioContext.currentTime;
    this.currentTime = 0;
    
    // Start continuous layers (drone, texture)
    this.startContinuousLayers();
    
    // Start scheduler for rhythmic layers
    this.schedulerIntervalId = window.setInterval(() => {
      this.scheduleEvents();
    }, this.config.scheduleInterval);
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
    }
  }

  private startContinuousLayers(): void {
    const droneLayer = this.layers.get('drone');
    if (droneLayer) {
      this.startDrone(droneLayer);
    }
    
    const textureLayer = this.layers.get('texture');
    if (textureLayer) {
      this.startTexture(textureLayer);
    }
  }

  private startDrone(layer: SynthLayer): void {
    const osc1 = this.audioContext.createOscillator();
    const osc2 = this.audioContext.createOscillator();
    
    osc1.frequency.value = 110; // A2
    osc2.frequency.value = 110.5; // Slight detune
    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    
    osc1.connect(layer.filterNode);
    osc2.connect(layer.filterNode);
    
    osc1.start();
    osc2.start();
    
    layer.oscillators.push(osc1, osc2);
  }

  private startTexture(layer: SynthLayer): void {
    // Create evolving texture with multiple oscillators
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        if (!this.isPlaying) return;
        this.addTextureOscillator(layer);
      }, i * 2000);
    }
  }

  private addTextureOscillator(layer: SynthLayer): void {
    const osc = this.audioContext.createOscillator();
    const envelope = this.audioContext.createGain();
    
    osc.frequency.value = 220 + Math.random() * 880; // Random frequency
    osc.type = 'triangle';
    
    osc.connect(envelope);
    envelope.connect(layer.filterNode);
    
    // Slow attack and decay
    envelope.gain.setValueAtTime(0, this.audioContext.currentTime);
    envelope.gain.linearRampToValueAtTime(0.1, this.audioContext.currentTime + 4);
    envelope.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 8);
    
    osc.start();
    osc.stop(this.audioContext.currentTime + 8);
    
    layer.oscillators.push(osc);
  }

  private scheduleEvents(): void {
    if (!this.isPlaying) return;
    
    const currentTime = this.audioContext.currentTime;
    const scheduleUntil = currentTime + this.config.lookaheadTime;
    
    // Schedule bass hits
    this.scheduleBassHits(scheduleUntil);
    
    // Schedule ostinato patterns
    this.scheduleOstinato(scheduleUntil);
    
    this.currentTime = (currentTime - this.startTime) % 32; // Loop every 32 seconds
  }

  private scheduleBassHits(scheduleUntil: number): void {
    const bassLayer = this.layers.get('bass');
    if (!bassLayer) return;
    
    const beatInterval = 60 / 120; // 120 BPM
    const nextBeat = Math.ceil(this.currentTime / beatInterval) * beatInterval;
    const scheduleTime = this.startTime + nextBeat;
    
    if (scheduleTime <= scheduleUntil && nextBeat % 1 < 0.1) { // On downbeat
      this.triggerBassHit(bassLayer, scheduleTime);
    }
  }

  private triggerBassHit(layer: SynthLayer, when: number): void {
    const osc = this.audioContext.createOscillator();
    const envelope = this.audioContext.createGain();
    
    osc.frequency.value = 55; // A1
    osc.type = 'square';
    
    osc.connect(envelope);
    envelope.connect(layer.filterNode);
    
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(0.8, when + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.001, when + 0.5);
    
    osc.start(when);
    osc.stop(when + 0.5);
  }

  private scheduleOstinato(scheduleUntil: number): void {
    // Simple ostinato pattern - implementation would be more sophisticated
    const ostinatoLayer = this.layers.get('ostinato');
    if (!ostinatoLayer) return;
    
    // Implementation for rhythmic patterns would go here
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