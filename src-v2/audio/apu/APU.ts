/**
 * Game Boy APU (Audio Processing Unit) Coordinator
 * 
 * This is the main audio engine for v2, coordinating 8 channels:
 * - 4 Pulse channels (p1-p4) with duty cycle control
 * - 2 Wave channels (w1-w2) with custom wavetables
 * - 2 Noise channels (n1-n2) with LFSR noise
 * 
 * This "Super Game Boy" configuration allows handling complex MIDIs
 * while maintaining authentic GB sound character.
 */

import { PulseChannel } from './PulseChannel';
import { WaveChannel } from './WaveChannel';
import { NoiseChannel } from './NoiseChannel';
import { GameBoyColorizer, type ColorizerConfig } from '../effects/GameBoyColorizer';
import { 
  DEFAULT_V2_CONFIG,
  type ChannelId, 
  type ChannelNote, 
  type ChannelState,
  type PulseChannelId,
  type WaveChannelId,
  type NoiseChannelId,
  type V2Config,
} from '../../types';
import type { DutyIndex } from '../synthesis/DutyCycle';
import type { WavePreset } from '../synthesis/WaveTable';
import type { LFSRMode } from '../synthesis/LFSR';

/**
 * Channel configuration for the 8-channel setup
 */
const CHANNEL_CONFIG = {
  pulse: [
    { id: 'p1' as const, hasSweep: true,  defaultDuty: 2 as DutyIndex },
    { id: 'p2' as const, hasSweep: true,  defaultDuty: 2 as DutyIndex },
    { id: 'p3' as const, hasSweep: false, defaultDuty: 1 as DutyIndex },
    { id: 'p4' as const, hasSweep: false, defaultDuty: 1 as DutyIndex },
  ],
  wave: [
    { id: 'w1' as const, preset: 'bass' as WavePreset },
    { id: 'w2' as const, preset: 'pad' as WavePreset },
  ],
  noise: [
    { id: 'n1' as const, mode: '7bit' as LFSRMode },
    { id: 'n2' as const, mode: '15bit' as LFSRMode },
  ],
};

export class GameBoyAPU {
  private audioContext: AudioContext;
  private config: V2Config;
  
  // Master output chain
  private masterGain: GainNode;
  private colorizer: GameBoyColorizer;
  
  // Individual channel instances
  private pulseChannels: Map<PulseChannelId, PulseChannel> = new Map();
  private waveChannels: Map<WaveChannelId, WaveChannel> = new Map();
  private noiseChannels: Map<NoiseChannelId, NoiseChannel> = new Map();
  
  // Per-channel gain nodes for mixing
  private channelGains: Map<ChannelId, GainNode> = new Map();
  
  // Channel state tracking
  private channelStates: Map<ChannelId, ChannelState> = new Map();
  
  // Note scheduling stats (no limit - Web Audio handles scheduling)
  private scheduledNoteCount = 0;
  
  // Track active audio nodes for stop functionality
  private activeNodes: Set<OscillatorNode | AudioBufferSourceNode> = new Set();
  
  constructor(audioContext?: AudioContext, config?: Partial<V2Config>) {
    this.audioContext = audioContext || new AudioContext();
    this.config = { ...DEFAULT_V2_CONFIG, ...config };
    
    // Create colorizer with DMG preset for authentic sound
    this.colorizer = new GameBoyColorizer(
      this.audioContext, 
      GameBoyColorizer.createPreset('dmg')
    );
    
    // Create master gain
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = this.config.masterVolume;
    
    // Wire: master -> colorizer -> destination
    this.masterGain.connect(this.colorizer.getInput());
    this.colorizer.getOutput().connect(this.audioContext.destination);
    
    // Initialize all channels
    this.initializeChannels();
  }
  
  /**
   * Initialize all 8 channels with their gain nodes.
   * 
   * Gain staging: Keep total under 1.0 to avoid clipping
   * With 8 channels potentially active: each should be ~0.1-0.15
   */
  private initializeChannels(): void {
    // Create pulse channels (4 × 0.12 = 0.48 max)
    for (const config of CHANNEL_CONFIG.pulse) {
      const gain = this.createChannelGain(config.id, 0.12);
      const channel = new PulseChannel(this.audioContext, gain, config.hasSweep);
      channel.setDutyCycle(config.defaultDuty);
      this.pulseChannels.set(config.id, channel);
      this.initChannelState(config.id);
    }
    
    // Create wave channels - slightly higher for bass presence (2 × 0.18 = 0.36 max)
    for (const config of CHANNEL_CONFIG.wave) {
      const gain = this.createChannelGain(config.id, 0.18);
      const channel = new WaveChannel(this.audioContext, gain, config.preset);
      this.waveChannels.set(config.id, channel);
      this.initChannelState(config.id);
    }
    
    // Create noise channels (2 × 0.08 = 0.16 max)
    for (const config of CHANNEL_CONFIG.noise) {
      const gain = this.createChannelGain(config.id, 0.08);
      const channel = new NoiseChannel(this.audioContext, gain, config.mode);
      this.noiseChannels.set(config.id, channel);
      this.initChannelState(config.id);
    }
  }
  // Total max: 0.48 + 0.36 + 0.16 = 1.0
  
  /**
   * Create a gain node for a channel and connect to master.
   */
  private createChannelGain(id: ChannelId, defaultGain: number): GainNode {
    const gain = this.audioContext.createGain();
    gain.gain.value = defaultGain;
    gain.connect(this.masterGain);
    this.channelGains.set(id, gain);
    return gain;
  }
  
  /**
   * Initialize channel state tracking.
   */
  private initChannelState(id: ChannelId): void {
    this.channelStates.set(id, {
      id,
      isBusy: false,
      busyUntil: 0,
      currentGain: this.channelGains.get(id)?.gain.value || 0,
    });
  }
  
  /**
   * Get the AudioContext.
   */
  getAudioContext(): AudioContext {
    return this.audioContext;
  }
  
  /**
   * Resume audio context if suspended.
   */
  async resume(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }
  
  /**
   * Schedule a note on a specific channel.
   * 
   * Web Audio handles scheduling of future notes efficiently, so we don't
   * limit the number of scheduled notes. The browser will automatically
   * manage memory for nodes that have finished playing.
   */
  scheduleNote(note: ChannelNote): void {
    const { channel, midiNote, startTime, duration, velocity } = note;
    
    if (channel.startsWith('p')) {
      this.schedulePulseNote(channel as PulseChannelId, midiNote, duration, velocity, startTime);
    } else if (channel.startsWith('w')) {
      this.scheduleWaveNote(channel as WaveChannelId, midiNote, duration, velocity, startTime);
    } else if (channel.startsWith('n')) {
      this.scheduleNoiseNote(channel as NoiseChannelId, midiNote, duration, velocity, startTime);
    }
    
    // Update channel state
    this.updateChannelBusy(channel, startTime + duration);
    this.scheduledNoteCount++;
  }
  
  /**
   * Schedule a pulse channel note.
   */
  private schedulePulseNote(
    channelId: PulseChannelId,
    midiNote: number,
    duration: number,
    velocity: number,
    startTime: number
  ): void {
    const channel = this.pulseChannels.get(channelId);
    if (!channel) return;
    
    const result = channel.playNote(midiNote, duration, velocity, startTime);
    this.trackNode(result.oscillator, result.stopTime);
  }
  
  /**
   * Schedule a wave channel note.
   */
  private scheduleWaveNote(
    channelId: WaveChannelId,
    midiNote: number,
    duration: number,
    velocity: number,
    startTime: number
  ): void {
    const channel = this.waveChannels.get(channelId);
    if (!channel) return;
    
    const result = channel.playNote(midiNote, duration, velocity, startTime);
    this.trackNode(result.oscillator, result.stopTime);
  }
  
  /**
   * Schedule a noise channel note.
   */
  private scheduleNoiseNote(
    channelId: NoiseChannelId,
    midiNote: number,
    duration: number,
    velocity: number,
    startTime: number
  ): void {
    const channel = this.noiseChannels.get(channelId);
    if (!channel) return;
    
    const result = channel.playNote(midiNote, duration, velocity, startTime);
    this.trackNode(result.source, result.stopTime);
  }
  
  /**
   * Track an audio node for stop functionality.
   */
  private trackNode(node: OscillatorNode | AudioBufferSourceNode, stopTime: number): void {
    this.activeNodes.add(node);
    
    // Auto-remove when the node ends naturally
    const cleanup = () => {
      this.activeNodes.delete(node);
    };
    node.onended = cleanup;
  }
  
  /**
   * Update channel busy state.
   */
  private updateChannelBusy(channelId: ChannelId, busyUntil: number): void {
    const state = this.channelStates.get(channelId);
    if (state) {
      state.isBusy = true;
      state.busyUntil = Math.max(state.busyUntil, busyUntil);
    }
  }
  
  /**
   * Check if a channel is free at a given time.
   */
  isChannelFree(channelId: ChannelId, atTime?: number): boolean {
    const time = atTime ?? this.audioContext.currentTime;
    const state = this.channelStates.get(channelId);
    if (!state) return false;
    return time >= state.busyUntil;
  }
  
  /**
   * Find a free pulse channel.
   */
  findFreePulseChannel(atTime?: number): PulseChannelId | null {
    const time = atTime ?? this.audioContext.currentTime;
    for (const id of ['p1', 'p2', 'p3', 'p4'] as PulseChannelId[]) {
      if (this.isChannelFree(id, time)) {
        return id;
      }
    }
    return null;
  }
  
  /**
   * Find a free wave channel.
   */
  findFreeWaveChannel(atTime?: number): WaveChannelId | null {
    const time = atTime ?? this.audioContext.currentTime;
    for (const id of ['w1', 'w2'] as WaveChannelId[]) {
      if (this.isChannelFree(id, time)) {
        return id;
      }
    }
    return null;
  }
  
  /**
   * Find a free noise channel.
   */
  findFreeNoiseChannel(atTime?: number): NoiseChannelId | null {
    const time = atTime ?? this.audioContext.currentTime;
    for (const id of ['n1', 'n2'] as NoiseChannelId[]) {
      if (this.isChannelFree(id, time)) {
        return id;
      }
    }
    return null;
  }
  
  /**
   * Set duty cycle for a pulse channel.
   */
  setPulseDuty(channelId: PulseChannelId, duty: DutyIndex): void {
    const channel = this.pulseChannels.get(channelId);
    if (channel) {
      channel.setDutyCycle(duty);
    }
  }
  
  /**
   * Set preset for a wave channel.
   */
  setWavePreset(channelId: WaveChannelId, preset: WavePreset): void {
    const channel = this.waveChannels.get(channelId);
    if (channel) {
      channel.loadPreset(preset);
    }
  }
  
  /**
   * Set mode for a noise channel.
   */
  setNoiseMode(channelId: NoiseChannelId, mode: LFSRMode): void {
    const channel = this.noiseChannels.get(channelId);
    if (channel) {
      channel.setMode(mode);
    }
  }
  
  /**
   * Set individual channel volume.
   */
  setChannelVolume(channelId: ChannelId, volume: number): void {
    const gain = this.channelGains.get(channelId);
    if (gain) {
      gain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }
  
  /**
   * Set master volume.
   */
  setMasterVolume(volume: number): void {
    this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    this.config.masterVolume = volume;
  }
  
  /**
   * Get master volume.
   */
  getMasterVolume(): number {
    return this.config.masterVolume;
  }
  
  /**
   * Get a pulse channel instance.
   */
  getPulseChannel(id: PulseChannelId): PulseChannel | undefined {
    return this.pulseChannels.get(id);
  }
  
  /**
   * Get a wave channel instance.
   */
  getWaveChannel(id: WaveChannelId): WaveChannel | undefined {
    return this.waveChannels.get(id);
  }
  
  /**
   * Get a noise channel instance.
   */
  getNoiseChannel(id: NoiseChannelId): NoiseChannel | undefined {
    return this.noiseChannels.get(id);
  }
  
  /**
   * Get all channel states.
   */
  getChannelStates(): Map<ChannelId, ChannelState> {
    return new Map(this.channelStates);
  }
  
  /**
   * Get current time from audio context.
   */
  getCurrentTime(): number {
    return this.audioContext.currentTime;
  }
  
  /**
   * Reset all channel states.
   */
  reset(): void {
    for (const id of this.channelStates.keys()) {
      this.initChannelState(id);
    }
    this.scheduledNoteCount = 0;
  }
  
  /**
   * Stop all currently playing and scheduled sounds immediately.
   */
  stopAll(): void {
    const now = this.audioContext.currentTime;
    
    // Stop all tracked nodes
    for (const node of this.activeNodes) {
      try {
        node.stop(now);
      } catch {
        // Node may have already stopped
      }
    }
    this.activeNodes.clear();
    
    // Reset channel states
    this.reset();
  }
  
  /**
   * Get scheduled note count.
   */
  getScheduledNoteCount(): number {
    return this.scheduledNoteCount;
  }
  
  // ===== COLORIZER CONTROLS =====
  
  /**
   * Get the colorizer instance.
   */
  getColorizer(): GameBoyColorizer {
    return this.colorizer;
  }
  
  /**
   * Set colorizer preset.
   */
  setColorizerPreset(preset: 'dmg' | 'gbc' | 'gba' | 'clean'): void {
    this.colorizer.setConfig(GameBoyColorizer.createPreset(preset));
  }
  
  /**
   * Enable/disable the colorizer.
   */
  setColorizerEnabled(enabled: boolean): void {
    this.colorizer.setEnabled(enabled);
  }
  
  /**
   * Initialize bit crusher (call after user interaction).
   */
  initializeBitCrusher(): void {
    this.colorizer.initializeBitCrusher();
  }
}

// Re-export default config for convenience
export { DEFAULT_V2_CONFIG } from '../../types';
