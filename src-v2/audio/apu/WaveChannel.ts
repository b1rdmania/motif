/**
 * Game Boy Wave Channel
 * 
 * Implements the wave channel with:
 * - 32-sample × 4-bit wavetable
 * - GB-accurate frequency calculation
 * - 4-level volume (mute, 100%, 50%, 25%)
 * - Preset waveforms (bass, pad, lead, etc.)
 * 
 * Uses OscillatorNode with PeriodicWave for accurate pitch control
 * (AudioBufferSourceNode playbackRate has issues at low frequencies).
 */

import { 
  WaveTable, 
  WAVE_PRESETS, 
  VOLUME_MULTIPLIERS,
  createPeriodicWaveFromTable,
  type WavePreset, 
  type WaveVolume 
} from '../synthesis/WaveTable';
import { calculateWaveFrequency } from '../synthesis/FrequencyCalc';

export interface WaveNoteResult {
  oscillator: OscillatorNode;
  gainNode: GainNode;
  stopTime: number;
}

export class WaveChannel {
  private audioContext: AudioContext;
  private waveTable: WaveTable;
  private periodicWave: PeriodicWave | null = null;
  private volume: WaveVolume = 1; // Default to 100%
  private outputNode: GainNode;
  private currentPreset: WavePreset;
  
  constructor(
    audioContext: AudioContext,
    outputNode: GainNode,
    preset: WavePreset = 'bass'
  ) {
    this.audioContext = audioContext;
    this.outputNode = outputNode;
    this.currentPreset = preset;
    
    // Initialize wavetable with preset
    this.waveTable = new WaveTable();
    this.loadPreset(preset);
  }
  
  /**
   * Load a preset waveform.
   */
  loadPreset(preset: WavePreset): void {
    this.currentPreset = preset;
    const waveform = WAVE_PRESETS[preset]();
    this.waveTable.loadFromBytes(Array.from(waveform));
    
    // Create PeriodicWave from the wavetable
    this.periodicWave = createPeriodicWaveFromTable(
      this.waveTable.getSamples(),
      this.audioContext
    );
  }
  
  /**
   * Load custom waveform data (32 samples, 0-15 each).
   */
  loadCustomWaveform(samples: number[]): void {
    this.waveTable.loadFromBytes(samples);
    this.periodicWave = createPeriodicWaveFromTable(
      this.waveTable.getSamples(),
      this.audioContext
    );
  }
  
  /**
   * Set volume level (GB style: 0=mute, 1=100%, 2=50%, 3=25%).
   */
  setVolume(volume: WaveVolume): void {
    this.volume = volume;
  }
  
  /**
   * Get current volume level.
   */
  getVolume(): WaveVolume {
    return this.volume;
  }
  
  /**
   * Get current preset name.
   */
  getPreset(): WavePreset {
    return this.currentPreset;
  }
  
  /**
   * Play a note on this channel.
   * 
   * @param midiNote - MIDI note number
   * @param duration - Note duration in seconds
   * @param velocity - Note velocity (0-127)
   * @param startTime - When to start (audioContext.currentTime based)
   */
  playNote(
    midiNote: number,
    duration: number,
    velocity: number = 100,
    startTime?: number
  ): WaveNoteResult {
    const now = startTime ?? this.audioContext.currentTime;
    
    // Ensure we have a PeriodicWave
    if (!this.periodicWave) {
      this.periodicWave = createPeriodicWaveFromTable(
        this.waveTable.getSamples(),
        this.audioContext
      );
    }
    
    // Create oscillator with the wavetable's PeriodicWave
    const oscillator = this.audioContext.createOscillator();
    oscillator.setPeriodicWave(this.periodicWave);
    
    // Calculate GB frequency and set directly (no playback rate needed!)
    const frequency = calculateWaveFrequency(midiNote);
    oscillator.frequency.setValueAtTime(frequency, now);
    
    // Create gain node for volume control
    const gain = this.audioContext.createGain();
    
    // Calculate final gain from velocity and GB volume level
    const velocityGain = (velocity / 127) * 0.8;
    const volumeMultiplier = VOLUME_MULTIPLIERS[this.volume];
    const finalGain = velocityGain * volumeMultiplier;
    
    // Simple envelope for wave channel
    const attackTime = 0.002;  // Very fast attack
    const releaseTime = 0.01;  // Quick release
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(finalGain, now + attackTime);
    
    const releaseStart = now + Math.max(attackTime, duration - releaseTime);
    gain.gain.setValueAtTime(finalGain, releaseStart);
    
    const stopTime = now + duration + releaseTime;
    gain.gain.linearRampToValueAtTime(0.001, stopTime);
    
    // Connect nodes
    oscillator.connect(gain);
    gain.connect(this.outputNode);
    
    // Schedule playback
    oscillator.start(now);
    oscillator.stop(stopTime + 0.01);
    
    // Auto-cleanup
    oscillator.onended = () => {
      try {
        oscillator.disconnect();
        gain.disconnect();
      } catch {
        // Already disconnected
      }
    };
    
    return { oscillator, gainNode: gain, stopTime };
  }
  
  /**
   * Play a note with a specific preset (doesn't change default).
   */
  playNoteWithPreset(
    midiNote: number,
    duration: number,
    velocity: number,
    preset: WavePreset,
    startTime?: number
  ): WaveNoteResult {
    const now = startTime ?? this.audioContext.currentTime;
    
    // Create temporary PeriodicWave for this preset
    const waveform = WAVE_PRESETS[preset]();
    const tempWave = createPeriodicWaveFromTable(waveform, this.audioContext);
    
    // Create oscillator with the preset's PeriodicWave
    const oscillator = this.audioContext.createOscillator();
    oscillator.setPeriodicWave(tempWave);
    
    const frequency = calculateWaveFrequency(midiNote);
    oscillator.frequency.setValueAtTime(frequency, now);
    
    const gain = this.audioContext.createGain();
    const velocityGain = (velocity / 127) * 0.8;
    const volumeMultiplier = VOLUME_MULTIPLIERS[this.volume];
    const finalGain = velocityGain * volumeMultiplier;
    
    const attackTime = 0.002;
    const releaseTime = 0.01;
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(finalGain, now + attackTime);
    
    const releaseStart = now + Math.max(attackTime, duration - releaseTime);
    gain.gain.setValueAtTime(finalGain, releaseStart);
    
    const stopTime = now + duration + releaseTime;
    gain.gain.linearRampToValueAtTime(0.001, stopTime);
    
    oscillator.connect(gain);
    gain.connect(this.outputNode);
    
    oscillator.start(now);
    oscillator.stop(stopTime + 0.01);
    
    oscillator.onended = () => {
      try {
        oscillator.disconnect();
        gain.disconnect();
      } catch {
        // Already disconnected
      }
    };
    
    return { oscillator, gainNode: gain, stopTime };
  }
  
  /**
   * Get the raw wavetable samples for visualization.
   */
  getWaveformSamples(): Uint8Array {
    return this.waveTable.getSamples();
  }
}
