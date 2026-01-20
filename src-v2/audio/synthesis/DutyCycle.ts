/**
 * Game Boy Duty Cycle Implementation
 * 
 * The GB pulse channels support 4 duty cycle patterns.
 * These exact duty ratios give the Game Boy its distinctive sound.
 */

/**
 * Duty cycle ratios for the 4 GB patterns
 * 12.5% - Very thin, buzzy, laser-like sound
 * 25%   - Classic chiptune sound, bright and punchy
 * 50%   - Full square wave
 * 75%   - Same as 25% but inverted
 */
export const DUTY_RATIOS = [0.125, 0.25, 0.5, 0.75] as const;

export type DutyIndex = 0 | 1 | 2 | 3;

/**
 * Creates a PeriodicWave for Web Audio from a duty cycle.
 * 
 * Uses proper Fourier series for pulse wave:
 * imag[n] = (2 / (π * n)) * sin(π * n * duty)
 * 
 * This is the mathematically correct way to synthesize pulse waves.
 */
export function createDutyWave(
  dutyIndex: DutyIndex,
  audioContext: BaseAudioContext
): PeriodicWave {
  const dutyRatio = DUTY_RATIOS[dutyIndex];
  
  // More harmonics = sharper edges (but more CPU)
  const numHarmonics = 64;
  
  const real = new Float32Array(numHarmonics);
  const imag = new Float32Array(numHarmonics);
  
  // DC offset = 0 for centered waveform
  real[0] = 0;
  imag[0] = 0;
  
  // Fourier series for pulse wave
  // https://en.wikipedia.org/wiki/Pulse_wave
  for (let n = 1; n < numHarmonics; n++) {
    // Pulse wave Fourier coefficient
    const coefficient = (2 / (Math.PI * n)) * Math.sin(Math.PI * n * dutyRatio);
    imag[n] = coefficient;
    real[n] = 0;
  }
  
  return audioContext.createPeriodicWave(real, imag, {
    disableNormalization: false
  });
}

/**
 * Pre-creates all 4 duty cycle waveforms for efficient reuse.
 */
export function createAllDutyWaves(
  audioContext: BaseAudioContext
): PeriodicWave[] {
  return [
    createDutyWave(0, audioContext),
    createDutyWave(1, audioContext),
    createDutyWave(2, audioContext),
    createDutyWave(3, audioContext),
  ];
}

/**
 * Returns a human-readable description of each duty cycle.
 */
export function getDutyDescription(dutyIndex: DutyIndex): string {
  const descriptions = [
    '12.5% - Thin, buzzy',
    '25% - Classic chiptune',
    '50% - Full square',
    '75% - Bright, punchy',
  ];
  return descriptions[dutyIndex];
}
