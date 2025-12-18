import type { NoteEvent } from '../types';

interface ScheduledNote {
  oscillator: OscillatorNode;
  gainNode: GainNode;
  time: number;
}

/**
 * Simple MIDI player using Web Audio oscillators
 * Plays MIDI events directly without soundfont loading
 */
export class SimpleMIDIPlayer {
  private audioContext: AudioContext;
  private isPlaying = false;
  private schedulerIntervalId: number | null = null;
  private startTime = 0;
  private events: NoteEvent[] = [];
  private currentEventIndex = 0;
  private scheduledNotes: ScheduledNote[] = [];
  private masterGain: GainNode;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
    this.masterGain = audioContext.createGain();
    this.masterGain.connect(audioContext.destination);
    this.masterGain.gain.value = 0.3; // Moderate volume
  }

  load(events: NoteEvent[]): void {
    this.events = [...events].sort((a, b) => a.time - b.time);
    this.currentEventIndex = 0;
    console.log(`Loaded ${this.events.length} MIDI events for simple playback`);
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

    console.log('Simple MIDI playback started');
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
        scheduledNote.oscillator.stop();
        scheduledNote.oscillator.disconnect();
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
        this.masterGain.gain.value = 0.3;
      }
    }, 150);

    console.log('Simple MIDI playback stopped');
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
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      const filter = this.audioContext.createBiquadFilter();

      // Convert MIDI note to frequency
      const frequency = this.midiToFrequency(event.pitch);
      oscillator.frequency.value = frequency;

      // Use triangle wave for a pleasant sound
      oscillator.type = 'triangle';

      // Add a gentle lowpass filter for warmth
      filter.type = 'lowpass';
      filter.frequency.value = 2000;
      filter.Q.value = 1;

      // Connect audio graph
      oscillator.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.masterGain);

      // Envelope based on velocity and duration
      const velocity = event.velocity / 127; // Normalize to 0-1
      const gainValue = velocity * 0.5; // Scale for pleasant volume
      const attackTime = Math.min(0.01, event.duration * 0.1);
      const releaseTime = Math.min(0.05, event.duration * 0.3);

      // ADSR envelope
      gainNode.gain.setValueAtTime(0, when);
      gainNode.gain.linearRampToValueAtTime(gainValue, when + attackTime);
      gainNode.gain.linearRampToValueAtTime(gainValue * 0.7, when + event.duration - releaseTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, when + event.duration);

      oscillator.start(when);
      oscillator.stop(when + event.duration);

      // Track scheduled note
      const scheduledNote: ScheduledNote = {
        oscillator,
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
          oscillator.disconnect();
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
