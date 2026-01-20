/**
 * Game Boy Noise Channel
 * 
 * Implements the noise channel with:
 * - LFSR-based pseudo-random noise generation
 * - 7-bit mode (tonal, metallic) and 15-bit mode (fuller noise)
 * - GB-accurate frequency calculation
 * - Envelope control
 */

import { generateNoiseBuffer, type LFSRMode } from '../synthesis/LFSR';
import { calculateNoiseFrequency, midiToNoiseParams } from '../synthesis/FrequencyCalc';

export interface NoiseNoteResult {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  stopTime: number;
}

// Cache for noise buffers to avoid regenerating
interface NoiseBufferCache {
  buffer: AudioBuffer;
  frequency: number;
  mode: LFSRMode;
  duration: number;
}

export class NoiseChannel {
  private audioContext: AudioContext;
  private mode: LFSRMode;
  private outputNode: GainNode;
  
  // Cache recently used noise buffers
  private bufferCache: NoiseBufferCache[] = [];
  private maxCacheSize = 8;
  
  constructor(
    audioContext: AudioContext,
    outputNode: GainNode,
    mode: LFSRMode = '15bit'
  ) {
    this.audioContext = audioContext;
    this.outputNode = outputNode;
    this.mode = mode;
  }
  
  /**
   * Set the LFSR mode.
   * '7bit' = more tonal, metallic sound (good for snares)
   * '15bit' = fuller noise (good for hihats, white noise effects)
   */
  setMode(mode: LFSRMode): void {
    this.mode = mode;
  }
  
  /**
   * Get current mode.
   */
  getMode(): LFSRMode {
    return this.mode;
  }
  
  /**
   * Get or create a noise buffer with the given parameters.
   */
  private getNoiseBuffer(
    frequency: number,
    duration: number,
    mode: LFSRMode
  ): AudioBuffer {
    // Check cache first
    const cached = this.bufferCache.find(
      c => c.frequency === frequency && 
           c.mode === mode && 
           c.duration >= duration
    );
    
    if (cached) {
      return cached.buffer;
    }
    
    // Generate new buffer
    const buffer = generateNoiseBuffer(
      this.audioContext,
      duration + 0.1, // Extra time for envelope tail
      frequency,
      mode
    );
    
    // Add to cache
    this.bufferCache.push({ buffer, frequency, mode, duration });
    
    // Trim cache if too large
    while (this.bufferCache.length > this.maxCacheSize) {
      this.bufferCache.shift();
    }
    
    return buffer;
  }
  
  /**
   * Play noise with raw frequency control.
   * 
   * @param duration - Duration in seconds
   * @param frequency - LFSR clock frequency in Hz
   * @param velocity - Velocity (0-127)
   * @param startTime - When to start
   */
  playNoise(
    duration: number,
    frequency: number,
    velocity: number = 100,
    startTime?: number
  ): NoiseNoteResult {
    const now = startTime ?? this.audioContext.currentTime;
    
    // Get or generate noise buffer
    const buffer = this.getNoiseBuffer(frequency, duration, this.mode);
    
    // Create source
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = false;
    
    // Create gain for envelope
    const gain = this.audioContext.createGain();
    
    // Calculate gain from velocity
    const maxGain = (velocity / 127) * 0.7; // Noise is loud, keep headroom
    
    // Noise envelope: instant attack, decay to sustain, release
    const attackTime = 0.001;  // Nearly instant
    const decayTime = 0.05;    // Quick decay
    const sustainLevel = maxGain * 0.6;
    const releaseTime = 0.03;
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(maxGain, now + attackTime);
    gain.gain.linearRampToValueAtTime(sustainLevel, now + attackTime + decayTime);
    
    const releaseStart = now + Math.max(attackTime + decayTime, duration - releaseTime);
    gain.gain.setValueAtTime(sustainLevel, releaseStart);
    
    const stopTime = now + duration + releaseTime;
    gain.gain.linearRampToValueAtTime(0.001, stopTime);
    
    // Connect
    source.connect(gain);
    gain.connect(this.outputNode);
    
    // Play
    source.start(now);
    source.stop(stopTime + 0.01);
    
    // Auto-cleanup
    source.onended = () => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        // Already disconnected
      }
    };
    
    return { source, gainNode: gain, stopTime };
  }
  
  /**
   * Play noise mapped from a MIDI note.
   * Lower notes = lower frequency noise (boomy)
   * Higher notes = higher frequency noise (hissy)
   * 
   * @param midiNote - MIDI note (affects noise frequency)
   * @param duration - Duration in seconds
   * @param velocity - Velocity (0-127)
   * @param startTime - When to start
   */
  playNote(
    midiNote: number,
    duration: number,
    velocity: number = 100,
    startTime?: number
  ): NoiseNoteResult {
    const { divisorCode, clockShift } = midiToNoiseParams(midiNote);
    const frequency = calculateNoiseFrequency(divisorCode, clockShift);
    
    return this.playNoise(duration, frequency, velocity, startTime);
  }
  
  /**
   * Play a kick drum sound.
   * Short, low-frequency noise burst.
   */
  playKick(velocity: number = 100, startTime?: number): NoiseNoteResult {
    const now = startTime ?? this.audioContext.currentTime;
    
    // Low frequency, short duration, 7-bit for more punch
    const buffer = this.getNoiseBuffer(500, 0.15, '7bit');
    
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    
    const gain = this.audioContext.createGain();
    const maxGain = (velocity / 127) * 0.9;
    
    // Kick envelope: instant attack, fast decay
    gain.gain.setValueAtTime(maxGain, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    
    source.connect(gain);
    gain.connect(this.outputNode);
    
    source.start(now);
    source.stop(now + 0.15);
    
    source.onended = () => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch {}
    };
    
    return { source, gainNode: gain, stopTime: now + 0.15 };
  }
  
  /**
   * Play a snare drum sound.
   * Mid-frequency noise with some sustain.
   */
  playSnare(velocity: number = 100, startTime?: number): NoiseNoteResult {
    const now = startTime ?? this.audioContext.currentTime;
    
    // Mid frequency, 7-bit for metallic character
    const buffer = this.getNoiseBuffer(2000, 0.2, '7bit');
    
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    
    const gain = this.audioContext.createGain();
    const maxGain = (velocity / 127) * 0.8;
    
    // Snare envelope: fast attack, medium decay
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(maxGain, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    
    source.connect(gain);
    gain.connect(this.outputNode);
    
    source.start(now);
    source.stop(now + 0.2);
    
    source.onended = () => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch {}
    };
    
    return { source, gainNode: gain, stopTime: now + 0.2 };
  }
  
  /**
   * Play a hihat sound.
   * High-frequency noise, very short.
   */
  playHihat(
    velocity: number = 100, 
    open: boolean = false,
    startTime?: number
  ): NoiseNoteResult {
    const now = startTime ?? this.audioContext.currentTime;
    
    // High frequency, 15-bit for fuller sound
    const duration = open ? 0.3 : 0.08;
    const buffer = this.getNoiseBuffer(8000, duration, '15bit');
    
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    
    const gain = this.audioContext.createGain();
    const maxGain = (velocity / 127) * 0.5; // Hihats are quieter
    
    // Hihat envelope: instant attack, quick decay
    gain.gain.setValueAtTime(maxGain, now);
    
    if (open) {
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    } else {
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
    }
    
    source.connect(gain);
    gain.connect(this.outputNode);
    
    source.start(now);
    source.stop(now + duration);
    
    source.onended = () => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch {}
    };
    
    return { source, gainNode: gain, stopTime: now + duration };
  }
  
  /**
   * Clear the buffer cache.
   */
  clearCache(): void {
    this.bufferCache = [];
  }
}
