/**
 * Channel Mapper
 * 
 * Intelligently assigns MIDI tracks to the 8 GB channels based on
 * track analysis results. Prioritizes the most important tracks
 * and assigns them to the most appropriate channel types.
 */

import { TrackAnalyzer, type MIDITrack } from './TrackAnalyzer';
import type { 
  ChannelAssignment, 
  TrackAnalysis, 
  ChannelId,
  PulseChannelId,
  WaveChannelId,
  NoiseChannelId,
  TrackRole
} from '../../types';
import type { DutyIndex } from '../synthesis/DutyCycle';
import type { WavePreset } from '../synthesis/WaveTable';
import type { LFSRMode } from '../synthesis/LFSR';

/**
 * Channel mapping configuration
 */
export interface ChannelMapperConfig {
  /** Maximum tracks to assign (limits complexity) */
  maxTracks: number;
  
  /** Whether to arpeggiate harmony tracks */
  arpeggiateHarmony: boolean;
  
  /** Default duty cycle for lead channels */
  leadDuty: DutyIndex;
  
  /** Default duty cycle for harmony channels */
  harmonyDuty: DutyIndex;
}

const DEFAULT_CONFIG: ChannelMapperConfig = {
  maxTracks: 8,     // Full 8 GB channels
  arpeggiateHarmony: true,  // Re-enabled for classic GB sound
  leadDuty: 2,      // 50% for full sound
  harmonyDuty: 1,   // 25% for thinner, less intrusive sound
};

/**
 * Available channel pools by type
 */
const CHANNEL_POOLS = {
  pulse: ['p1', 'p2', 'p3', 'p4'] as PulseChannelId[],
  wave: ['w1', 'w2'] as WaveChannelId[],
  noise: ['n1', 'n2'] as NoiseChannelId[],
};

export class ChannelMapper {
  private analyzer: TrackAnalyzer;
  private config: ChannelMapperConfig;
  
  constructor(config: Partial<ChannelMapperConfig> = {}) {
    this.analyzer = new TrackAnalyzer();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Update configuration.
   */
  setConfig(config: Partial<ChannelMapperConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Map MIDI tracks to GB channels.
   * Returns an array of channel assignments.
   */
  mapTracks(tracks: MIDITrack[]): ChannelAssignment[] {
    // Analyze all tracks
    const analyses = this.analyzer.analyzeTracks(tracks);
    
    // Filter out empty tracks
    const nonEmptyAnalyses = analyses.filter(a => a.noteCount > 0);
    
    // Track used channels
    const usedChannels = new Set<ChannelId>();
    
    // Assign channels in priority order
    const assignments: ChannelAssignment[] = [];
    
    for (const analysis of nonEmptyAnalyses) {
      if (assignments.length >= this.config.maxTracks) break;
      
      const assignment = this.assignChannel(analysis, usedChannels);
      if (assignment) {
        assignments.push(assignment);
        usedChannels.add(assignment.channelId);
      }
    }
    
    return assignments;
  }
  
  /**
   * Assign a single track to a channel.
   */
  private assignChannel(
    analysis: TrackAnalysis,
    usedChannels: Set<ChannelId>
  ): ChannelAssignment | null {
    const { role, hasChords } = analysis;
    
    // Route to appropriate channel type based on role
    switch (role) {
      case 'drums':
        return this.assignDrums(analysis, usedChannels);
      
      case 'bass':
        return this.assignBass(analysis, usedChannels);
      
      case 'lead':
        return this.assignLead(analysis, usedChannels);
      
      case 'harmony':
        return this.assignHarmony(analysis, usedChannels, hasChords);
      
      case 'pad':
        return this.assignPad(analysis, usedChannels);
      
      case 'fx':
        return this.assignFX(analysis, usedChannels);
      
      default:
        // Fallback to any available pulse channel
        return this.assignToAnyPulse(analysis, usedChannels);
    }
  }
  
  /**
   * Assign drums to noise channels.
   */
  private assignDrums(
    analysis: TrackAnalysis,
    usedChannels: Set<ChannelId>
  ): ChannelAssignment | null {
    // Try noise channels first
    const channel = this.findFreeChannel(CHANNEL_POOLS.noise, usedChannels);
    
    if (!channel) return null;
    
    // Use 7-bit for kick/snare, 15-bit for hihats
    // Default to 7-bit as it's punchier
    const noiseMode: LFSRMode = '7bit';
    
    return {
      trackIndex: analysis.trackIndex,
      channelId: channel,
      shouldArpeggiate: false,
      noiseMode,
    };
  }
  
  /**
   * Assign bass to wave channel.
   */
  private assignBass(
    analysis: TrackAnalysis,
    usedChannels: Set<ChannelId>
  ): ChannelAssignment | null {
    // Prefer w1 for bass
    if (!usedChannels.has('w1')) {
      return {
        trackIndex: analysis.trackIndex,
        channelId: 'w1',
        shouldArpeggiate: false,
        wavePreset: 'bass' as WavePreset,
      };
    }
    
    // Fall back to w2
    if (!usedChannels.has('w2')) {
      return {
        trackIndex: analysis.trackIndex,
        channelId: 'w2',
        shouldArpeggiate: false,
        wavePreset: 'bass' as WavePreset,
      };
    }
    
    // No wave channels available, try pulse with low duty
    const pulseChannel = this.findFreeChannel(CHANNEL_POOLS.pulse, usedChannels);
    if (pulseChannel) {
      return {
        trackIndex: analysis.trackIndex,
        channelId: pulseChannel,
        shouldArpeggiate: false,
        dutyCycle: 2 as DutyIndex, // 50% for fuller bass
      };
    }
    
    return null;
  }
  
  /**
   * Assign lead melody to pulse channels.
   */
  private assignLead(
    analysis: TrackAnalysis,
    usedChannels: Set<ChannelId>
  ): ChannelAssignment | null {
    // Prefer p1 or p2 (sweep-capable) for lead
    for (const channelId of ['p1', 'p2'] as PulseChannelId[]) {
      if (!usedChannels.has(channelId)) {
        return {
          trackIndex: analysis.trackIndex,
          channelId,
          shouldArpeggiate: false,
          dutyCycle: this.config.leadDuty,
        };
      }
    }
    
    // Fall back to p3/p4
    const channel = this.findFreeChannel(['p3', 'p4'] as PulseChannelId[], usedChannels);
    if (channel) {
      return {
        trackIndex: analysis.trackIndex,
        channelId: channel,
        shouldArpeggiate: false,
        dutyCycle: this.config.leadDuty,
      };
    }
    
    return null;
  }
  
  /**
   * Assign harmony to pulse channels (with optional arpeggio).
   */
  private assignHarmony(
    analysis: TrackAnalysis,
    usedChannels: Set<ChannelId>,
    hasChords: boolean
  ): ChannelAssignment | null {
    // Use p3/p4 for harmony (thinner sound, no sweep)
    const channel = this.findFreeChannel(['p3', 'p4', 'p1', 'p2'] as PulseChannelId[], usedChannels);
    
    if (!channel) return null;
    
    return {
      trackIndex: analysis.trackIndex,
      channelId: channel,
      shouldArpeggiate: this.config.arpeggiateHarmony && hasChords,
      dutyCycle: this.config.harmonyDuty,
    };
  }
  
  /**
   * Assign pad to wave channel.
   */
  private assignPad(
    analysis: TrackAnalysis,
    usedChannels: Set<ChannelId>
  ): ChannelAssignment | null {
    // Prefer w2 for pads
    if (!usedChannels.has('w2')) {
      return {
        trackIndex: analysis.trackIndex,
        channelId: 'w2',
        shouldArpeggiate: false,
        wavePreset: 'pad' as WavePreset,
      };
    }
    
    // Fall back to w1
    if (!usedChannels.has('w1')) {
      return {
        trackIndex: analysis.trackIndex,
        channelId: 'w1',
        shouldArpeggiate: false,
        wavePreset: 'pad' as WavePreset,
      };
    }
    
    // Fall back to pulse
    const pulseChannel = this.findFreeChannel(CHANNEL_POOLS.pulse, usedChannels);
    if (pulseChannel) {
      return {
        trackIndex: analysis.trackIndex,
        channelId: pulseChannel,
        shouldArpeggiate: false,
        dutyCycle: 2 as DutyIndex,
      };
    }
    
    return null;
  }
  
  /**
   * Assign FX/incidental to any available pulse channel.
   */
  private assignFX(
    analysis: TrackAnalysis,
    usedChannels: Set<ChannelId>
  ): ChannelAssignment | null {
    // FX goes to any available pulse channel
    const channel = this.findFreeChannel(CHANNEL_POOLS.pulse, usedChannels);
    
    if (!channel) return null;
    
    return {
      trackIndex: analysis.trackIndex,
      channelId: channel,
      shouldArpeggiate: false,
      dutyCycle: 0 as DutyIndex, // 12.5% for thin, effects-like sound
    };
  }
  
  /**
   * Assign to any available pulse channel.
   */
  private assignToAnyPulse(
    analysis: TrackAnalysis,
    usedChannels: Set<ChannelId>
  ): ChannelAssignment | null {
    const channel = this.findFreeChannel(CHANNEL_POOLS.pulse, usedChannels);
    
    if (!channel) return null;
    
    return {
      trackIndex: analysis.trackIndex,
      channelId: channel,
      shouldArpeggiate: false,
      dutyCycle: 2 as DutyIndex,
    };
  }
  
  /**
   * Find the first free channel from a pool.
   */
  private findFreeChannel<T extends ChannelId>(
    pool: T[],
    usedChannels: Set<ChannelId>
  ): T | null {
    for (const channel of pool) {
      if (!usedChannels.has(channel)) {
        return channel;
      }
    }
    return null;
  }
  
  /**
   * Get the analyzer for external use.
   */
  getAnalyzer(): TrackAnalyzer {
    return this.analyzer;
  }
  
  /**
   * Analyze tracks without mapping (useful for UI display).
   */
  analyzeTracks(tracks: MIDITrack[]): TrackAnalysis[] {
    return this.analyzer.analyzeTracks(tracks);
  }
}
