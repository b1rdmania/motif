/**
 * Game Boy Frequency Calculations
 * 
 * The GB uses specific frequency formulas based on 11-bit period registers.
 * This creates slightly "off" tuning compared to standard A440 tuning,
 * which is part of the characteristic GB sound.
 * 
 * Reference: https://gbdev.io/pandocs/Audio_details.html
 */

/**
 * GB CPU clock rate used for audio timing
 */
const GB_CLOCK = 4194304; // 4.194304 MHz

/**
 * Pulse channel base frequency divider
 * Formula: freq = 131072 / (2048 - period)
 */
const PULSE_FREQ_BASE = 131072;

/**
 * Wave channel base frequency divider  
 * Formula: freq = 65536 / (2048 - period)
 * (Half the pulse frequency, so wave plays one octave lower for same period)
 */
const WAVE_FREQ_BASE = 65536;

/**
 * Maximum period register value (11-bit)
 */
const MAX_PERIOD = 2047;

/**
 * Noise channel divisor lookup table
 * Used with divisor code (r) in noise frequency calculation
 */
const NOISE_DIVISORS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const;

/**
 * Convert MIDI note number to standard frequency (A4 = 440Hz)
 */
export function midiToStandardFrequency(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

/**
 * Convert standard frequency to GB pulse period register value.
 * Returns clamped 11-bit value (0-2047).
 */
export function frequencyToPulsePeriod(frequency: number): number {
  // freq = 131072 / (2048 - period)
  // period = 2048 - (131072 / freq)
  const period = Math.round(2048 - (PULSE_FREQ_BASE / frequency));
  return Math.max(0, Math.min(MAX_PERIOD, period));
}

/**
 * Convert GB pulse period register to actual output frequency.
 */
export function pulsePeriodToFrequency(period: number): number {
  if (period >= 2048) return 0;
  return PULSE_FREQ_BASE / (2048 - period);
}

/**
 * Calculate the actual GB frequency for a pulse channel from MIDI note.
 * 
 * This goes: MIDI → standard freq → period register → GB freq
 * The register quantization creates the characteristic slight detuning.
 */
export function calculatePulseFrequency(midiNote: number): number {
  const standardFreq = midiToStandardFrequency(midiNote);
  const period = frequencyToPulsePeriod(standardFreq);
  return pulsePeriodToFrequency(period);
}

/**
 * Convert standard frequency to GB wave period register value.
 */
export function frequencyToWavePeriod(frequency: number): number {
  // freq = 65536 / (2048 - period)
  // period = 2048 - (65536 / freq)
  const period = Math.round(2048 - (WAVE_FREQ_BASE / frequency));
  return Math.max(0, Math.min(MAX_PERIOD, period));
}

/**
 * Convert GB wave period register to actual output frequency.
 */
export function wavePeriodToFrequency(period: number): number {
  if (period >= 2048) return 0;
  return WAVE_FREQ_BASE / (2048 - period);
}

/**
 * Calculate the actual GB frequency for a wave channel from MIDI note.
 */
export function calculateWaveFrequency(midiNote: number): number {
  const standardFreq = midiToStandardFrequency(midiNote);
  const period = frequencyToWavePeriod(standardFreq);
  return wavePeriodToFrequency(period);
}

/**
 * Calculate noise channel frequency.
 * 
 * @param divisorCode - Divisor code (0-7), selects from NOISE_DIVISORS
 * @param clockShift - Clock shift (0-14), higher = lower frequency
 * @returns Frequency in Hz
 * 
 * Formula: freq = 524288 / divisor / 2^(shift+1)
 */
export function calculateNoiseFrequency(
  divisorCode: number,
  clockShift: number
): number {
  const divisor = NOISE_DIVISORS[divisorCode % 8];
  const shift = Math.max(0, Math.min(14, clockShift));
  return 524288 / divisor / Math.pow(2, shift + 1);
}

/**
 * Map a MIDI note to noise parameters.
 * Lower notes = lower noise frequency (more "boomy")
 * Higher notes = higher noise frequency (more "hissy")
 * 
 * This is an approximation since noise isn't truly pitched.
 */
export function midiToNoiseParams(midiNote: number): {
  divisorCode: number;
  clockShift: number;
} {
  // Map MIDI notes 24-96 to noise parameters
  // Lower notes get higher shift (lower freq)
  // Higher notes get lower shift (higher freq)
  
  const normalized = Math.max(0, Math.min(72, midiNote - 24));
  
  // Map to shift (0-14): high notes = low shift, low notes = high shift
  const clockShift = Math.floor(14 - (normalized / 72) * 14);
  
  // Divisor code affects timbre - use middle values for most natural sound
  const divisorCode = Math.floor((normalized % 8));
  
  return { divisorCode, clockShift };
}

/**
 * Calculate the frequency deviation from standard tuning.
 * Useful for testing/verification.
 * 
 * @returns Deviation in cents (100 cents = 1 semitone)
 */
export function getFrequencyDeviation(midiNote: number): number {
  const standard = midiToStandardFrequency(midiNote);
  const gbFreq = calculatePulseFrequency(midiNote);
  
  // Cents = 1200 * log2(f2/f1)
  return 1200 * Math.log2(gbFreq / standard);
}
