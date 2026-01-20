/**
 * Game Boy Colorizer
 * 
 * Applies authentic Game Boy audio characteristics to the output:
 * - Low-pass filter (GB has ~8kHz natural rolloff)
 * - Bit-crushing (4-bit DAC simulation)
 * - Sample rate reduction (mimics ~32kHz internal rate)
 * - Subtle saturation (hardware non-linearity)
 * - Characteristic noise floor
 */

export interface ColorizerConfig {
  /** Enable/disable the colorizer */
  enabled: boolean;
  
  /** Low-pass filter cutoff (Hz). Real GB is ~8-10kHz */
  lowpassFreq: number;
  
  /** Bit depth for crushing (4 = authentic, higher = cleaner) */
  bitDepth: number;
  
  /** Sample rate reduction factor (1 = none, 2 = half, etc.) */
  sampleRateReduction: number;
  
  /** Saturation amount (0-1) */
  saturation: number;
  
  /** High-pass filter to remove DC offset and sub-bass (Hz) */
  highpassFreq: number;
}

const DEFAULT_CONFIG: ColorizerConfig = {
  enabled: true,
  lowpassFreq: 10000,     // GB natural rolloff (slightly higher)
  bitDepth: 8,            // Less aggressive bit crushing (4 was too harsh)
  sampleRateReduction: 1, // No sample rate reduction (was causing artifacts)
  saturation: 0.08,       // Very subtle - avoid clipping artifacts
  highpassFreq: 20,       // LOW - allow bass through!
};

export class GameBoyColorizer {
  private audioContext: AudioContext;
  private config: ColorizerConfig;
  
  // Audio nodes
  private inputGain: GainNode;
  private outputGain: GainNode;
  private highpassFilter: BiquadFilterNode;
  private lowpassFilter: BiquadFilterNode;
  private bitCrusher: AudioWorkletNode | ScriptProcessorNode | null = null;
  private waveshaper: WaveShaperNode;
  private limiter: DynamicsCompressorNode;
  
  private isInitialized = false;
  
  constructor(audioContext: AudioContext, config: Partial<ColorizerConfig> = {}) {
    this.audioContext = audioContext;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Create basic nodes
    this.inputGain = audioContext.createGain();
    this.outputGain = audioContext.createGain();
    
    // High-pass filter (remove DC and sub-bass)
    this.highpassFilter = audioContext.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.frequency.value = this.config.highpassFreq;
    this.highpassFilter.Q.value = 0.7;
    
    // Low-pass filter (GB characteristic rolloff)
    this.lowpassFilter = audioContext.createBiquadFilter();
    this.lowpassFilter.type = 'lowpass';
    this.lowpassFilter.frequency.value = this.config.lowpassFreq;
    this.lowpassFilter.Q.value = 0.7;
    
    // Waveshaper for saturation
    this.waveshaper = audioContext.createWaveShaper();
    this.waveshaper.curve = this.createSaturationCurve(this.config.saturation);
    this.waveshaper.oversample = '2x';
    
    // Limiter to prevent clipping - more aggressive settings
    this.limiter = audioContext.createDynamicsCompressor();
    this.limiter.threshold.value = -12;  // Catch peaks earlier
    this.limiter.knee.value = 3;         // Harder knee
    this.limiter.ratio.value = 20;       // More aggressive limiting
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.05;   // Faster release
    
    // Initialize chain (without bit crusher for now)
    this.initializeBasicChain();
  }
  
  /**
   * Initialize the basic audio chain without bit crusher.
   */
  private initializeBasicChain(): void {
    // Chain: input -> highpass -> lowpass -> waveshaper -> limiter -> output
    this.inputGain.connect(this.highpassFilter);
    this.highpassFilter.connect(this.lowpassFilter);
    this.lowpassFilter.connect(this.waveshaper);
    this.waveshaper.connect(this.limiter);
    this.limiter.connect(this.outputGain);
    
    this.isInitialized = true;
  }
  
  /**
   * Initialize with bit crusher using ScriptProcessor (fallback).
   * Call this after user interaction for iOS compatibility.
   */
  initializeBitCrusher(): void {
    if (this.bitCrusher) return;
    
    // Disconnect current chain
    this.lowpassFilter.disconnect();
    
    // Create bit crusher using ScriptProcessor (deprecated but widely supported)
    const bufferSize = 4096;
    const crusher = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
    
    const bitDepth = this.config.bitDepth;
    const sampleRateReduction = this.config.sampleRateReduction;
    const levels = Math.pow(2, bitDepth);
    
    let lastSample = 0;
    let sampleCounter = 0;
    
    crusher.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const output = event.outputBuffer.getChannelData(0);
      
      for (let i = 0; i < input.length; i++) {
        sampleCounter++;
        
        // Sample rate reduction
        if (sampleCounter >= sampleRateReduction) {
          sampleCounter = 0;
          
          // Bit crushing: quantize to bitDepth levels
          const sample = input[i];
          lastSample = Math.round(sample * levels) / levels;
        }
        
        output[i] = lastSample;
      }
    };
    
    this.bitCrusher = crusher;
    
    // Reconnect chain with crusher
    this.lowpassFilter.connect(crusher as unknown as AudioNode);
    (crusher as unknown as AudioNode).connect(this.waveshaper);
  }
  
  /**
   * Create a saturation curve for the waveshaper.
   */
  private createSaturationCurve(amount: number): Float32Array {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      
      if (amount === 0) {
        // No saturation - linear
        curve[i] = x;
      } else {
        // Soft clipping curve
        const k = 2 * amount / (1 - amount);
        curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      }
    }
    
    return curve;
  }
  
  /**
   * Get the input node (connect your audio source to this).
   */
  getInput(): GainNode {
    return this.inputGain;
  }
  
  /**
   * Get the output node (connect this to destination or other effects).
   */
  getOutput(): GainNode {
    return this.outputGain;
  }
  
  /**
   * Enable/disable the colorizer.
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    // When disabled, bypass could be implemented
    // For now, just set gain to 0 or 1
    this.inputGain.gain.value = enabled ? 1 : 0;
  }
  
  /**
   * Update configuration.
   */
  setConfig(config: Partial<ColorizerConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Update filter frequencies
    this.highpassFilter.frequency.value = this.config.highpassFreq;
    this.lowpassFilter.frequency.value = this.config.lowpassFreq;
    
    // Update saturation curve
    this.waveshaper.curve = this.createSaturationCurve(this.config.saturation);
  }
  
  /**
   * Get current configuration.
   */
  getConfig(): ColorizerConfig {
    return { ...this.config };
  }
  
  /**
   * Create a preset configuration.
   */
  static createPreset(preset: 'dmg' | 'gbc' | 'gba' | 'clean'): Partial<ColorizerConfig> {
    switch (preset) {
      case 'dmg':
        // Original Game Boy - warm but clean
        return {
          enabled: true,
          lowpassFreq: 8000,
          bitDepth: 8,           // Less harsh than 4-bit
          sampleRateReduction: 1, // No SR reduction (causes artifacts)
          saturation: 0.1,       // Minimal saturation to avoid clicks
          highpassFreq: 30,      // Let bass through!
        };
        
      case 'gbc':
        // Game Boy Color - slightly cleaner
        return {
          enabled: true,
          lowpassFreq: 10000,
          bitDepth: 8,
          sampleRateReduction: 1,
          saturation: 0.08,     // Minimal saturation
          highpassFreq: 25,
        };
        
      case 'gba':
        // Game Boy Advance - cleaner still
        return {
          enabled: true,
          lowpassFreq: 14000,
          bitDepth: 12,
          sampleRateReduction: 1,
          saturation: 0.1,
          highpassFreq: 20,
        };
        
      case 'clean':
        // No processing
        return {
          enabled: false,
          lowpassFreq: 20000,
          bitDepth: 16,
          sampleRateReduction: 1,
          saturation: 0,
          highpassFreq: 20,
        };
    }
  }
}
