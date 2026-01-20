/**
 * Sound Test for Wario Synth v2
 * 
 * Tests all individual sound generators to verify they work
 * and sound authentically Game Boy-like.
 */

import { PulseChannel } from '../apu/PulseChannel';
import { WaveChannel } from '../apu/WaveChannel';
import { NoiseChannel } from '../apu/NoiseChannel';
import { verifyLFSR } from '../synthesis/LFSR';
import { getFrequencyDeviation } from '../synthesis/FrequencyCalc';
import type { DutyIndex } from '../synthesis/DutyCycle';

export interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

/**
 * Run all verification tests (non-audio).
 */
export function runVerificationTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test LFSR implementation
  const lfsrOk = verifyLFSR();
  results.push({
    name: 'LFSR Sequence',
    passed: lfsrOk,
    message: lfsrOk ? 'LFSR matches expected GB sequence' : 'LFSR sequence mismatch!'
  });
  
  // Test frequency deviation (should be non-zero but small)
  const devA4 = getFrequencyDeviation(69); // A4
  const devOk = Math.abs(devA4) > 0.01 && Math.abs(devA4) < 10;
  results.push({
    name: 'Frequency Deviation',
    passed: devOk,
    message: `A4 deviation: ${devA4.toFixed(2)} cents (expected small non-zero value)`
  });
  
  return results;
}

/**
 * Create test channels for audio testing.
 */
export function createTestChannels(audioContext: AudioContext) {
  // Create master gain
  const masterGain = audioContext.createGain();
  masterGain.gain.value = 0.5;
  masterGain.connect(audioContext.destination);
  
  // Create individual channel gains
  const pulseGain = audioContext.createGain();
  pulseGain.gain.value = 0.4;
  pulseGain.connect(masterGain);
  
  const waveGain = audioContext.createGain();
  waveGain.gain.value = 0.5;
  waveGain.connect(masterGain);
  
  const noiseGain = audioContext.createGain();
  noiseGain.gain.value = 0.4;
  noiseGain.connect(masterGain);
  
  return {
    pulse: new PulseChannel(audioContext, pulseGain, true),
    wave: new WaveChannel(audioContext, waveGain, 'bass'),
    noise: new NoiseChannel(audioContext, noiseGain, '15bit'),
    masterGain
  };
}

/**
 * Test all 4 duty cycles on the pulse channel.
 */
export async function testDutyCycles(
  pulse: PulseChannel,
  audioContext: AudioContext
): Promise<void> {
  console.log('Testing duty cycles...');
  
  const duties: DutyIndex[] = [0, 1, 2, 3];
  const dutyNames = ['12.5%', '25%', '50%', '75%'];
  
  for (let i = 0; i < duties.length; i++) {
    console.log(`  Playing duty cycle ${dutyNames[i]}`);
    pulse.setDutyCycle(duties[i]);
    
    // Play a short melody
    const notes = [60, 64, 67, 72]; // C major arpeggio
    const now = audioContext.currentTime;
    
    notes.forEach((note, idx) => {
      pulse.playNote(note, 0.15, 100, now + idx * 0.2);
    });
    
    // Wait for notes to finish
    await sleep(1000);
  }
  
  console.log('Duty cycle test complete!');
}

/**
 * Test the wave channel with different presets.
 */
export async function testWaveChannel(
  wave: WaveChannel,
  audioContext: AudioContext
): Promise<void> {
  console.log('Testing wave channel...');
  
  const presets = ['bass', 'pad', 'lead', 'triangle', 'sawtooth'] as const;
  
  for (const preset of presets) {
    console.log(`  Playing preset: ${preset}`);
    wave.loadPreset(preset);
    
    // Play a bass line
    const notes = [36, 36, 43, 41]; // Low C, C, G, F
    const now = audioContext.currentTime;
    
    notes.forEach((note, idx) => {
      wave.playNote(note, 0.4, 100, now + idx * 0.5);
    });
    
    await sleep(2200);
  }
  
  console.log('Wave channel test complete!');
}

/**
 * Test the noise channel with different modes.
 */
export async function testNoiseChannel(
  noise: NoiseChannel,
  audioContext: AudioContext
): Promise<void> {
  console.log('Testing noise channel...');
  
  // Test 15-bit mode (fuller noise)
  console.log('  Testing 15-bit mode (full noise)');
  noise.setMode('15bit');
  
  let now = audioContext.currentTime;
  noise.playHihat(80, false, now);
  noise.playHihat(60, false, now + 0.25);
  noise.playHihat(80, false, now + 0.5);
  noise.playHihat(60, true, now + 0.75);
  
  await sleep(1500);
  
  // Test 7-bit mode (metallic)
  console.log('  Testing 7-bit mode (metallic)');
  noise.setMode('7bit');
  
  now = audioContext.currentTime;
  noise.playKick(100, now);
  noise.playSnare(90, now + 0.5);
  noise.playKick(100, now + 1.0);
  noise.playSnare(90, now + 1.5);
  
  await sleep(2200);
  
  // Test different frequencies
  console.log('  Testing frequency range');
  now = audioContext.currentTime;
  
  for (let i = 0; i < 8; i++) {
    noise.playNote(36 + i * 6, 0.2, 80, now + i * 0.25);
  }
  
  await sleep(2500);
  
  console.log('Noise channel test complete!');
}

/**
 * Play a simple test melody using all channels.
 */
export async function testCombined(
  pulse: PulseChannel,
  wave: WaveChannel,
  noise: NoiseChannel,
  audioContext: AudioContext
): Promise<void> {
  console.log('Testing combined playback...');
  
  const bpm = 120;
  const beatDuration = 60 / bpm;
  const now = audioContext.currentTime;
  
  // Set up channels
  pulse.setDutyCycle(2); // 50%
  wave.loadPreset('bass');
  noise.setMode('7bit');
  
  // 4-bar phrase
  for (let bar = 0; bar < 4; bar++) {
    const barStart = now + bar * 4 * beatDuration;
    
    // Bass line (wave channel) - root notes
    const bassNotes = [36, 36, 43, 41]; // C, C, G, F
    wave.playNote(bassNotes[bar], beatDuration * 3.5, 90, barStart);
    
    // Melody (pulse channel)
    const melodyNotes = [
      [60, 64, 67],      // Bar 1: C E G
      [64, 67, 72],      // Bar 2: E G C
      [67, 71, 74],      // Bar 3: G B D
      [65, 69, 72],      // Bar 4: F A C
    ];
    
    melodyNotes[bar].forEach((note, i) => {
      pulse.playNote(note, beatDuration * 0.9, 80, barStart + i * beatDuration);
    });
    
    // Drums (noise channel)
    noise.playKick(100, barStart);
    noise.playHihat(60, false, barStart + beatDuration * 0.5);
    noise.playSnare(90, barStart + beatDuration);
    noise.playHihat(60, false, barStart + beatDuration * 1.5);
    noise.playKick(80, barStart + beatDuration * 2);
    noise.playHihat(60, false, barStart + beatDuration * 2.5);
    noise.playSnare(90, barStart + beatDuration * 3);
    noise.playHihat(60, true, barStart + beatDuration * 3.5);
  }
  
  // Wait for playback to complete
  await sleep(4 * 4 * beatDuration * 1000 + 500);
  
  console.log('Combined test complete!');
}

/**
 * Run all audio tests sequentially.
 */
export async function runAllAudioTests(audioContext: AudioContext): Promise<void> {
  const { pulse, wave, noise } = createTestChannels(audioContext);
  
  console.log('=== Wario Synth v2 Audio Tests ===\n');
  
  await testDutyCycles(pulse, audioContext);
  await sleep(500);
  
  await testWaveChannel(wave, audioContext);
  await sleep(500);
  
  await testNoiseChannel(noise, audioContext);
  await sleep(500);
  
  await testCombined(pulse, wave, noise, audioContext);
  
  console.log('\n=== All Audio Tests Complete ===');
}

/**
 * Helper: sleep for a given duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
