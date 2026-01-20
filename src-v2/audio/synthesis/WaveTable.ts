/**
 * Game Boy Wave Channel Wavetable
 * 
 * The GB wave channel uses a 32-sample wavetable with 4-bit resolution.
 * Each sample can be 0-15, giving the characteristic "digital staircase"
 * sound quality.
 * 
 * The low resolution creates audible quantization that's part of the
 * GB's unique character - smoother than pulse but still distinctly digital.
 * 
 * Reference: https://gbdev.io/pandocs/Audio_details.html#wave-channel
 */

/**
 * Number of samples in the wavetable
 */
export const WAVE_TABLE_SIZE = 32;

/**
 * Maximum sample value (4-bit = 0-15)
 */
export const MAX_SAMPLE_VALUE = 15;

/**
 * GB wave channel volume levels (bit-shift based)
 * 0 = mute, 1 = 100%, 2 = 50%, 3 = 25%
 */
export type WaveVolume = 0 | 1 | 2 | 3;

/**
 * Volume multipliers matching GB behavior
 * GB uses right-shift for volume: 0=mute, 1=>>0, 2=>>1, 3=>>2
 */
export const VOLUME_MULTIPLIERS: Record<WaveVolume, number> = {
  0: 0,
  1: 1.0,
  2: 0.5,
  3: 0.25,
};

/**
 * Wavetable class for the GB wave channel.
 */
export class WaveTable {
  private samples: Uint8Array;
  
  constructor() {
    this.samples = new Uint8Array(WAVE_TABLE_SIZE);
    // Initialize with silence
    this.samples.fill(8); // 8 = center value (no DC offset)
  }
  
  /**
   * Quantize a float value (0-1) to 4-bit (0-15).
   */
  private quantize(value: number): number {
    const clamped = Math.max(0, Math.min(1, value));
    return Math.floor(clamped * MAX_SAMPLE_VALUE);
  }
  
  /**
   * Load a waveform from a float array (0-1 range).
   * Values are quantized to 4-bit resolution.
   */
  loadFromFloats(waveform: number[]): void {
    for (let i = 0; i < WAVE_TABLE_SIZE; i++) {
      const value = i < waveform.length ? waveform[i] : 0.5;
      this.samples[i] = this.quantize(value);
    }
  }
  
  /**
   * Load raw 4-bit samples directly.
   */
  loadFromBytes(samples: number[]): void {
    for (let i = 0; i < WAVE_TABLE_SIZE; i++) {
      const value = i < samples.length ? samples[i] : 8;
      this.samples[i] = Math.max(0, Math.min(MAX_SAMPLE_VALUE, Math.floor(value)));
    }
  }
  
  /**
   * Get the raw sample array.
   */
  getSamples(): Uint8Array {
    return this.samples;
  }
  
  /**
   * Create a Web Audio buffer from this wavetable.
   * The buffer is one cycle of the waveform.
   */
  createBuffer(audioContext: BaseAudioContext): AudioBuffer {
    const buffer = audioContext.createBuffer(1, WAVE_TABLE_SIZE, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < WAVE_TABLE_SIZE; i++) {
      // Convert 0-15 to -1 to +1
      data[i] = (this.samples[i] / MAX_SAMPLE_VALUE) * 2 - 1;
    }
    
    return buffer;
  }
  
  /**
   * Create an extended buffer for better audio quality.
   * Repeats the waveform multiple times to avoid pitch artifacts.
   */
  createExtendedBuffer(
    audioContext: BaseAudioContext,
    repetitions: number = 256
  ): AudioBuffer {
    const totalSamples = WAVE_TABLE_SIZE * repetitions;
    const buffer = audioContext.createBuffer(1, totalSamples, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < totalSamples; i++) {
      const sampleIndex = i % WAVE_TABLE_SIZE;
      data[i] = (this.samples[sampleIndex] / MAX_SAMPLE_VALUE) * 2 - 1;
    }
    
    return buffer;
  }
}

/**
 * Generate a triangle wave with 4-bit quantization.
 * Classic GB bass sound.
 */
export function generateTriangleWave(): Uint8Array {
  const wave = new Uint8Array(WAVE_TABLE_SIZE);
  
  for (let i = 0; i < WAVE_TABLE_SIZE; i++) {
    // Triangle: ramp up for first half, down for second half
    const position = i / WAVE_TABLE_SIZE;
    let value: number;
    
    if (position < 0.5) {
      value = position * 2; // 0 to 1
    } else {
      value = 2 - position * 2; // 1 to 0
    }
    
    wave[i] = Math.floor(value * MAX_SAMPLE_VALUE);
  }
  
  return wave;
}

/**
 * Generate a sawtooth wave with 4-bit quantization.
 * Brighter, more aggressive sound.
 */
export function generateSawtoothWave(): Uint8Array {
  const wave = new Uint8Array(WAVE_TABLE_SIZE);
  
  for (let i = 0; i < WAVE_TABLE_SIZE; i++) {
    wave[i] = Math.floor((i / (WAVE_TABLE_SIZE - 1)) * MAX_SAMPLE_VALUE);
  }
  
  return wave;
}

/**
 * Generate a sine-ish wave with 4-bit quantization.
 * Rounder, softer sound for pads.
 */
export function generateSineWave(): Uint8Array {
  const wave = new Uint8Array(WAVE_TABLE_SIZE);
  
  for (let i = 0; i < WAVE_TABLE_SIZE; i++) {
    const angle = (i / WAVE_TABLE_SIZE) * Math.PI * 2;
    const sine = (Math.sin(angle) + 1) / 2; // Normalize to 0-1
    wave[i] = Math.floor(sine * MAX_SAMPLE_VALUE);
  }
  
  return wave;
}

/**
 * Generate a square wave with 4-bit resolution.
 * Sharp, bright sound.
 */
export function generateSquareWave(): Uint8Array {
  const wave = new Uint8Array(WAVE_TABLE_SIZE);
  
  for (let i = 0; i < WAVE_TABLE_SIZE; i++) {
    wave[i] = i < WAVE_TABLE_SIZE / 2 ? MAX_SAMPLE_VALUE : 0;
  }
  
  return wave;
}

/**
 * Generate a bass-optimized waveform.
 * Combination of triangle with slight harmonics.
 */
export function generateBassWave(): Uint8Array {
  const wave = new Uint8Array(WAVE_TABLE_SIZE);
  
  for (let i = 0; i < WAVE_TABLE_SIZE; i++) {
    const position = i / WAVE_TABLE_SIZE;
    const angle = position * Math.PI * 2;
    
    // Fundamental + slight 2nd harmonic for warmth
    const value = (Math.sin(angle) * 0.8 + Math.sin(angle * 2) * 0.2 + 1) / 2;
    wave[i] = Math.floor(value * MAX_SAMPLE_VALUE);
  }
  
  return wave;
}

/**
 * Generate a pad-optimized waveform.
 * Softer, rounder character.
 */
export function generatePadWave(): Uint8Array {
  // Use sine wave for pads - smoothest option
  return generateSineWave();
}

/**
 * Generate a lead-optimized waveform.
 * Brighter with more harmonics.
 */
export function generateLeadWave(): Uint8Array {
  const wave = new Uint8Array(WAVE_TABLE_SIZE);
  
  for (let i = 0; i < WAVE_TABLE_SIZE; i++) {
    const position = i / WAVE_TABLE_SIZE;
    const angle = position * Math.PI * 2;
    
    // Mix of saw and triangle characteristics
    const saw = position;
    const tri = position < 0.5 ? position * 2 : 2 - position * 2;
    const value = saw * 0.6 + tri * 0.4;
    
    wave[i] = Math.floor(value * MAX_SAMPLE_VALUE);
  }
  
  return wave;
}

/**
 * Preset wavetables for easy access.
 */
export const WAVE_PRESETS = {
  triangle: generateTriangleWave,
  sawtooth: generateSawtoothWave,
  sine: generateSineWave,
  square: generateSquareWave,
  bass: generateBassWave,
  pad: generatePadWave,
  lead: generateLeadWave,
} as const;

export type WavePreset = keyof typeof WAVE_PRESETS;

/**
 * Create a PeriodicWave from a wavetable for use with OscillatorNode.
 * This is more accurate than using AudioBufferSourceNode with playback rate.
 */
export function createPeriodicWaveFromTable(
  samples: Uint8Array | number[],
  audioContext: BaseAudioContext
): PeriodicWave {
  const n = samples.length;
  
  // Convert samples to normalized audio values (-1 to +1)
  const normalized: number[] = [];
  for (let i = 0; i < n; i++) {
    const sample = typeof samples[i] === 'number' ? samples[i] : 0;
    normalized.push((sample / MAX_SAMPLE_VALUE) * 2 - 1);
  }
  
  // Number of harmonics - more harmonics = more accurate representation
  const numHarmonics = 64;
  
  // Calculate Fourier coefficients
  const real = new Float32Array(numHarmonics);
  const imag = new Float32Array(numHarmonics);
  
  // DC offset (real[0]) should be 0 for centered waveform
  real[0] = 0;
  imag[0] = 0;
  
  // Calculate each harmonic using DFT
  for (let k = 1; k < numHarmonics; k++) {
    let realSum = 0;
    let imagSum = 0;
    
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * k * i) / n;
      realSum += normalized[i] * Math.cos(angle);
      imagSum -= normalized[i] * Math.sin(angle);
    }
    
    // Scale by 2/n for proper amplitude
    real[k] = (2 * realSum) / n;
    imag[k] = (2 * imagSum) / n;
  }
  
  return audioContext.createPeriodicWave(real, imag, {
    disableNormalization: false
  });
}
