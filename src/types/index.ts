export interface NoteEvent {
  time: number;
  duration: number;
  pitch: number;
  velocity: number;
  track: number;
  channel?: number; // MIDI channel (0-15, where 9 is drums)
}

export interface ChordEvent {
  time: number;
  duration: number;
  pitches: number[];
  velocity: number;
  track: number;
}

export interface TrackFeatures {
  medianPitch: number;
  pitchRange: number;
  noteDensity: number;
  polyphonyRatio: number;
  averageDuration: number;
  repetitionScore: number;
  isMonophonic: boolean;
  hasPhraseContinuity: boolean;
  register: 'low' | 'mid' | 'high';
}

export interface StructuralFeatures {
  tempo: number;
  totalDuration: number;
  noteDensity: number[];
  registerDistribution: { low: number; mid: number; high: number };
  trackRoles: Map<number, Role>;
  trackFeatures: Map<number, TrackFeatures>;
}

export type Role = 'bass' | 'drone' | 'ostinato' | 'texture' | 'accents' | 'melody';

export interface RoleAssignment {
  role: Role;
  sourceTrack: number;
  events: NoteEvent[];
  chords: ChordEvent[];
  confidence: number;
  features: TrackFeatures;
}

export interface SynthLayer {
  role: Role;
  oscillators: OscillatorNode[];
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
}

export interface MotifConfig {
  lookaheadTime: number;
  scheduleInterval: number;
  fadeTime: number;
  maxOscillators: number;
}