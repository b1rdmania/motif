/**
 * Linear Feedback Shift Register (LFSR) Noise Generator
 * 
 * The Game Boy's noise channel uses a 15-bit LFSR to generate
 * pseudo-random noise. It can also operate in 7-bit mode for
 * a more tonal, metallic sound.
 * 
 * This is what gives GB noise its characteristic "crunchy" quality
 * compared to smooth white noise.
 * 
 * Reference: https://gbdev.io/pandocs/Audio_details.html#noise-channel
 */

export type LFSRMode = '7bit' | '15bit';

/**
 * Initial LFSR seed value (all 1s for 15-bit register)
 */
const INITIAL_SEED = 0x7FFF;

/**
 * LFSR noise generator that matches Game Boy hardware behavior.
 */
export class LFSR {
  private lfsr: number;
  private mode: LFSRMode;
  
  constructor(mode: LFSRMode = '15bit') {
    this.mode = mode;
    this.lfsr = INITIAL_SEED;
  }
  
  /**
   * Clock the LFSR once and return the output bit.
   * 
   * Algorithm:
   * 1. XOR bits 0 and 1 to get new bit
   * 2. Output is current bit 0 (before shift)
   * 3. Shift register right by 1
   * 4. Put XOR result into bit 14
   * 5. If 7-bit mode, also put XOR result into bit 6
   * 
   * @returns 0 or 1
   */
  clock(): number {
    // Output is bit 0 before we modify anything
    const output = this.lfsr & 1;
    
    // XOR bits 0 and 1
    const bit0 = this.lfsr & 1;
    const bit1 = (this.lfsr >> 1) & 1;
    const xorResult = bit0 ^ bit1;
    
    // Shift right by 1
    this.lfsr >>= 1;
    
    // Set bit 14 to XOR result
    this.lfsr |= (xorResult << 14);
    
    // In 7-bit mode, also set bit 6
    if (this.mode === '7bit') {
      // Clear bit 6 first, then set if needed
      this.lfsr &= ~(1 << 6);
      this.lfsr |= (xorResult << 6);
    }
    
    return output;
  }
  
  /**
   * Reset LFSR to initial state.
   */
  reset(): void {
    this.lfsr = INITIAL_SEED;
  }
  
  /**
   * Set the LFSR mode.
   * 7-bit mode produces more tonal, metallic sounds.
   * 15-bit mode produces fuller noise.
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
   * Get current register value (for debugging/visualization).
   */
  getValue(): number {
    return this.lfsr;
  }
  
  /**
   * Generate a sequence of n output bits.
   * Useful for verification against known GB sequences.
   */
  generateSequence(length: number): number[] {
    const sequence: number[] = [];
    for (let i = 0; i < length; i++) {
      sequence.push(this.clock());
    }
    return sequence;
  }
}

/**
 * Known first 20 values of 15-bit LFSR starting from 0x7FFF (all 1s).
 * The first outputs are just the low bits shifting out.
 * Used for verification that our implementation matches GB hardware.
 */
export const LFSR_15BIT_EXPECTED = [
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 0, 0, 0, 0
];

/**
 * Verify that our LFSR implementation produces correct output.
 */
export function verifyLFSR(): boolean {
  const lfsr = new LFSR('15bit');
  const sequence = lfsr.generateSequence(20);
  
  for (let i = 0; i < LFSR_15BIT_EXPECTED.length; i++) {
    if (sequence[i] !== LFSR_15BIT_EXPECTED[i]) {
      console.error(`LFSR mismatch at index ${i}: got ${sequence[i]}, expected ${LFSR_15BIT_EXPECTED[i]}`);
      return false;
    }
  }
  
  return true;
}

/**
 * Generate an audio buffer filled with LFSR noise.
 * 
 * @param audioContext - Web Audio context
 * @param duration - Duration in seconds
 * @param frequency - Clock frequency of the LFSR
 * @param mode - LFSR mode (7bit or 15bit)
 * @returns AudioBuffer filled with noise
 */
export function generateNoiseBuffer(
  audioContext: BaseAudioContext,
  duration: number,
  frequency: number,
  mode: LFSRMode = '15bit'
): AudioBuffer {
  const sampleRate = audioContext.sampleRate;
  const bufferLength = Math.ceil(duration * sampleRate);
  const buffer = audioContext.createBuffer(1, bufferLength, sampleRate);
  const data = buffer.getChannelData(0);
  
  const lfsr = new LFSR(mode);
  
  // How many samples between LFSR clocks
  const samplesPerClock = sampleRate / frequency;
  
  let clockAccumulator = 0;
  let currentOutput = 0;
  
  for (let i = 0; i < bufferLength; i++) {
    // Clock LFSR when accumulator reaches threshold
    clockAccumulator += 1;
    if (clockAccumulator >= samplesPerClock) {
      currentOutput = lfsr.clock();
      clockAccumulator -= samplesPerClock;
    }
    
    // Convert 0/1 to -1/+1 for audio
    data[i] = currentOutput * 2 - 1;
  }
  
  return buffer;
}
