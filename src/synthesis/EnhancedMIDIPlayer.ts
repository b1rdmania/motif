import type { NoteEvent } from '../types';

interface ScheduledNote {
  oscillators: OscillatorNode[];
  gainNode: GainNode;
  time: number;
}

/**
 * Enhanced MIDI player using rich multi-oscillator synthesis
 * Similar sound quality to the SynthesisEngine but for direct MIDI playback
 */
export class EnhancedMIDIPlayer {
  private audioContext: AudioContext;
  private isPlaying = false;
  private schedulerIntervalId: number | null = null;
  private startTime = 0;
  private events: NoteEvent[] = [];
  private currentEventIndex = 0;
  private scheduledNotes: ScheduledNote[] = [];
  private masterGain: GainNode;
  private masterFilter: BiquadFilterNode;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;

    // Create master filter for warmth
    this.masterFilter = audioContext.createBiquadFilter();
    this.masterFilter.type = 'lowpass';
    this.masterFilter.frequency.value = 3000;
    this.masterFilter.Q.value = 1;

    this.masterGain = audioContext.createGain();
    this.masterGain.gain.value = 0.6; // Good default volume

    this.masterFilter.connect(this.masterGain);
    this.masterGain.connect(audioContext.destination);
  }

  load(events: NoteEvent[]): void {
    this.events = [...events].sort((a, b) => a.time - b.time);
    this.currentEventIndex = 0;
    console.log(`Loaded ${this.events.length} MIDI events for enhanced playback`);
  }

  async play(): Promise<void> {
    if (this.isPlaying) return;
    if (this.events.length === 0) {
      throw new Error('No MIDI events loaded');
    }

    // Ensure AudioContext is resumed (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.isPlaying = true;
    this.startTime = this.audioContext.currentTime;
    this.currentEventIndex = 0;
    this.scheduledNotes = [];

    // Schedule events with lookahead
    this.schedulerIntervalId = window.setInterval(() => {
      this.scheduleEvents();
    }, 25); // 25ms lookahead scheduling

    console.log('Enhanced MIDI playback started');
  }

  stop(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;

    if (this.schedulerIntervalId) {
      clearInterval(this.schedulerIntervalId);
      this.schedulerIntervalId = null;
    }

    // Stop all scheduled notes
    for (const scheduledNote of this.scheduledNotes) {
      try {
        for (const osc of scheduledNote.oscillators) {
          osc.stop();
          osc.disconnect();
        }
        scheduledNote.gainNode.disconnect();
      } catch (e) {
        // Note might already be stopped
      }
    }
    this.scheduledNotes = [];

    // Fade out master gain
    this.masterGain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.1);

    // Reset volume after fade
    setTimeout(() => {
      if (!this.isPlaying) {
        this.masterGain.gain.value = 0.6;
      }
    }, 150);

    console.log('Enhanced MIDI playback stopped');
  }

  private scheduleEvents(): void {
    if (!this.isPlaying) return;

    const currentTime = this.audioContext.currentTime;
    const lookahead = 0.1; // 100ms lookahead
    const scheduleUntil = currentTime + lookahead;

    while (this.currentEventIndex < this.events.length) {
      const event = this.events[this.currentEventIndex];
      const eventTime = this.startTime + event.time;

      // Stop if we're past the lookahead window
      if (eventTime > scheduleUntil) break;

      // Schedule if the event hasn't been played yet
      if (eventTime >= currentTime - 0.01) { // Small tolerance for timing
        this.scheduleNote(event, eventTime);
      }

      this.currentEventIndex++;
    }

    // Stop when all events are done
    if (this.currentEventIndex >= this.events.length) {
      const lastEvent = this.events[this.events.length - 1];
      const lastEventEnd = this.startTime + lastEvent.time + lastEvent.duration;

      if (currentTime > lastEventEnd + 1.0) { // 1 second grace period
        this.stop();
      }
    }
  }

  private scheduleNote(event: NoteEvent, when: number): void {
    try {
      const gainNode = this.audioContext.createGain();
      const filter = this.audioContext.createBiquadFilter();

      // Create multiple detuned oscillators for richness (similar to unison)
      const oscillators: OscillatorNode[] = [];
      const numVoices = 3; // 3 oscillators per note for thickness
      const detune = 10; // Slight detuning for richness

      for (let i = 0; i < numVoices; i++) {
        const oscillator = this.audioContext.createOscillator();
        const frequency = this.midiToFrequency(event.pitch);
        oscillator.frequency.value = frequency;

        // Detune each voice slightly
        if (i === 0) oscillator.detune.value = -detune;
        else if (i === 1) oscillator.detune.value = 0;
        else oscillator.detune.value = detune;

        // Mix of oscillator types for rich harmonic content
        // Use different waveforms based on pitch range for more interesting timbre
        if (event.pitch < 48) {
          // Low notes: square for bass presence
          oscillator.type = 'square';
        } else if (event.pitch < 72) {
          // Mid notes: sawtooth for brightness
          oscillator.type = 'sawtooth';
        } else {
          // High notes: triangle for smoothness
          oscillator.type = 'triangle';
        }

        oscillator.connect(filter);
        oscillators.push(oscillator);
      }

      // Dynamic filter based on velocity and pitch
      filter.type = 'lowpass';
      const velocity = event.velocity / 127;
      // Higher velocity = brighter sound
      filter.frequency.value = 800 + (velocity * 2000);
      filter.Q.value = 2;

      // Connect to gain
      filter.connect(gainNode);
      gainNode.connect(this.masterFilter);

      // Rich ADSR envelope
      const gainValue = (velocity * 0.25) / numVoices; // Scale down for multiple voices
      const attackTime = Math.min(0.02, event.duration * 0.1);
      const decayTime = Math.min(0.05, event.duration * 0.2);
      const sustainLevel = gainValue * 0.7;
      const releaseTime = Math.min(0.1, event.duration * 0.3);

      // ADSR envelope
      gainNode.gain.setValueAtTime(0, when);
      gainNode.gain.linearRampToValueAtTime(gainValue, when + attackTime); // Attack
      gainNode.gain.linearRampToValueAtTime(sustainLevel, when + attackTime + decayTime); // Decay
      gainNode.gain.linearRampToValueAtTime(sustainLevel, when + event.duration - releaseTime); // Sustain
      gainNode.gain.exponentialRampToValueAtTime(0.001, when + event.duration); // Release

      // Start all oscillators
      for (const osc of oscillators) {
        osc.start(when);
        osc.stop(when + event.duration);
      }

      // Track scheduled note
      const scheduledNote: ScheduledNote = {
        oscillators,
        gainNode,
        time: when
      };
      this.scheduledNotes.push(scheduledNote);

      // Clean up old scheduled notes
      const cutoffTime = when - 5.0; // Keep 5 seconds of history
      this.scheduledNotes = this.scheduledNotes.filter(n => n.time > cutoffTime);

      // Clean up after note ends
      setTimeout(() => {
        try {
          for (const osc of oscillators) {
            osc.disconnect();
          }
          filter.disconnect();
          gainNode.disconnect();
        } catch (e) {
          // Already disconnected
        }
      }, (event.duration + 0.1) * 1000);

    } catch (error) {
      console.warn('Failed to schedule note:', error);
    }
  }

  private midiToFrequency(midiNote: number): number {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  getProgress(): number {
    if (this.events.length === 0) return 0;

    const currentTime = this.audioContext.currentTime - this.startTime;
    const totalDuration = Math.max(...this.events.map(e => e.time + e.duration));

    return Math.max(0, Math.min(1, currentTime / totalDuration));
  }

  getDuration(): number {
    if (this.events.length === 0) return 0;
    return Math.max(...this.events.map(e => e.time + e.duration));
  }

  setVolume(volume: number): void {
    this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
  }
}
