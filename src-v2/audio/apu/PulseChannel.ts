/**
 * Game Boy Pulse Channel
 * 
 * Implements a single pulse channel with:
 * - 4 selectable duty cycles
 * - GB-accurate frequency calculation
 * - Simple envelope (fast attack, configurable release)
 * - Optional sweep capability (for p1/p2)
 */

import { createAllDutyWaves, type DutyIndex } from '../synthesis/DutyCycle';
import { calculatePulseFrequency } from '../synthesis/FrequencyCalc';

export interface PulseNoteResult {
  oscillator: OscillatorNode;
  gainNode: GainNode;
  stopTime: number;
}

export class PulseChannel {
  private audioContext: AudioContext;
  private dutyWaves: PeriodicWave[];
  private currentDuty: DutyIndex = 2; // Default to 50%
  private hasSweep: boolean;
  private outputNode: GainNode;
  
  constructor(
    audioContext: AudioContext,
    outputNode: GainNode,
    hasSweep: boolean = false
  ) {
    this.audioContext = audioContext;
    this.outputNode = outputNode;
    this.hasSweep = hasSweep;
    
    // Pre-create all duty cycle waveforms
    this.dutyWaves = createAllDutyWaves(audioContext);
  }
  
  /**
   * Set the duty cycle for subsequent notes.
   */
  setDutyCycle(duty: DutyIndex): void {
    this.currentDuty = duty;
  }
  
  /**
   * Get current duty cycle.
   */
  getDutyCycle(): DutyIndex {
    return this.currentDuty;
  }
  
  /**
   * Play a note on this channel.
   * 
   * @param midiNote - MIDI note number (0-127)
   * @param duration - Note duration in seconds
   * @param velocity - Note velocity (0-127)
   * @param startTime - When to start (audioContext.currentTime based)
   * @returns Objects for manual cleanup if needed
   */
  playNote(
    midiNote: number,
    duration: number,
    velocity: number = 100,
    startTime?: number
  ): PulseNoteResult {
    const now = startTime ?? this.audioContext.currentTime;
    
    // Create oscillator with current duty cycle
    const osc = this.audioContext.createOscillator();
    osc.setPeriodicWave(this.dutyWaves[this.currentDuty]);
    
    // Use GB frequency formula (slightly detuned from standard)
    const frequency = calculatePulseFrequency(midiNote);
    osc.frequency.setValueAtTime(frequency, now);
    
    // Create gain node for envelope
    const gain = this.audioContext.createGain();
    
    // Calculate gain from velocity (0-127 → 0-1)
    const maxGain = (velocity / 127) * 0.8; // Leave headroom
    
    // GB-style envelope: fast attack, sustain, quick release
    const attackTime = 0.005;  // 5ms attack
    const releaseTime = 0.02;  // 20ms release
    
    // Envelope automation
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(maxGain, now + attackTime);
    
    // Hold at max until release
    const releaseStart = now + Math.max(attackTime, duration - releaseTime);
    gain.gain.setValueAtTime(maxGain, releaseStart);
    
    // Release to near-zero (avoid exponentialRamp to 0)
    const stopTime = now + duration + releaseTime;
    gain.gain.linearRampToValueAtTime(0.001, stopTime);
    
    // Connect nodes
    osc.connect(gain);
    gain.connect(this.outputNode);
    
    // Schedule playback
    osc.start(now);
    osc.stop(stopTime + 0.01); // Small buffer after release
    
    // Auto-cleanup when oscillator ends
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // Already disconnected
      }
    };
    
    return { oscillator: osc, gainNode: gain, stopTime };
  }
  
  /**
   * Play a note with a specific duty cycle (doesn't change default).
   */
  playNoteWithDuty(
    midiNote: number,
    duration: number,
    velocity: number,
    duty: DutyIndex,
    startTime?: number
  ): PulseNoteResult {
    const now = startTime ?? this.audioContext.currentTime;
    
    const osc = this.audioContext.createOscillator();
    osc.setPeriodicWave(this.dutyWaves[duty]);
    
    const frequency = calculatePulseFrequency(midiNote);
    osc.frequency.setValueAtTime(frequency, now);
    
    const gain = this.audioContext.createGain();
    const maxGain = (velocity / 127) * 0.8;
    
    const attackTime = 0.005;
    const releaseTime = 0.02;
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(maxGain, now + attackTime);
    
    const releaseStart = now + Math.max(attackTime, duration - releaseTime);
    gain.gain.setValueAtTime(maxGain, releaseStart);
    
    const stopTime = now + duration + releaseTime;
    gain.gain.linearRampToValueAtTime(0.001, stopTime);
    
    osc.connect(gain);
    gain.connect(this.outputNode);
    
    osc.start(now);
    osc.stop(stopTime + 0.01);
    
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // Already disconnected
      }
    };
    
    return { oscillator: osc, gainNode: gain, stopTime };
  }
  
  /**
   * Check if this channel has sweep capability.
   */
  canSweep(): boolean {
    return this.hasSweep;
  }
  
  /**
   * Play a note with pitch sweep (if sweep enabled).
   * Sweep goes from startNote to endNote over the duration.
   */
  playNoteWithSweep(
    startNote: number,
    endNote: number,
    duration: number,
    velocity: number = 100,
    startTime?: number
  ): PulseNoteResult | null {
    if (!this.hasSweep) {
      console.warn('PulseChannel: Sweep not available on this channel');
      return null;
    }
    
    const now = startTime ?? this.audioContext.currentTime;
    
    const osc = this.audioContext.createOscillator();
    osc.setPeriodicWave(this.dutyWaves[this.currentDuty]);
    
    const startFreq = calculatePulseFrequency(startNote);
    const endFreq = calculatePulseFrequency(endNote);
    
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.linearRampToValueAtTime(endFreq, now + duration);
    
    const gain = this.audioContext.createGain();
    const maxGain = (velocity / 127) * 0.8;
    
    const attackTime = 0.005;
    const releaseTime = 0.02;
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(maxGain, now + attackTime);
    
    const releaseStart = now + Math.max(attackTime, duration - releaseTime);
    gain.gain.setValueAtTime(maxGain, releaseStart);
    
    const stopTime = now + duration + releaseTime;
    gain.gain.linearRampToValueAtTime(0.001, stopTime);
    
    osc.connect(gain);
    gain.connect(this.outputNode);
    
    osc.start(now);
    osc.stop(stopTime + 0.01);
    
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // Already disconnected
      }
    };
    
    return { oscillator: osc, gainNode: gain, stopTime };
  }
}
