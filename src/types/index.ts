export interface NoteEvent {
  time: number;
  duration: number;
  pitch: number;
  velocity: number;
  track: number;
}

export interface StructuralFeatures {
  tempo: number;
  totalDuration: number;
  noteDensity: number[];
  registerDistribution: { low: number; mid: number; high: number };
  trackRoles: Map<number, Role>;
}

export type Role = 'bass' | 'drone' | 'ostinato' | 'texture' | 'accents';

export interface RoleAssignment {
  role: Role;
  sourceTrack: number;
  events: NoteEvent[];
  confidence: number;
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