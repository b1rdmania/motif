import * as Tone from 'tone';
import type { NoteEvent } from '../types';

/**
 * MIDI player using Tone.js with high-quality synthesis
 */
export class ToneJSMIDIPlayer {
  private sampler: Tone.Sampler | null = null;
  private isPlaying = false;
  private events: NoteEvent[] = [];
  private scheduledEvents: number[] = [];
  private startTime = 0;
  private autoStopTimeout: number | null = null;

  constructor() {
    // Will initialize sampler on first load
  }

  async load(events: NoteEvent[]): Promise<void> {
    this.events = [...events].sort((a, b) => a.time - b.time);

    // Initialize Tone.js sampler with piano samples if not already loaded
    if (!this.sampler) {
      console.log('Loading Tone.js piano sampler...');

      // Use Tone.js built-in piano samples
      this.sampler = new Tone.Sampler({
        urls: {
          A0: "A0.mp3",
          C1: "C1.mp3",
          "D#1": "Ds1.mp3",
          "F#1": "Fs1.mp3",
          A1: "A1.mp3",
          C2: "C2.mp3",
          "D#2": "Ds2.mp3",
          "F#2": "Fs2.mp3",
          A2: "A2.mp3",
          C3: "C3.mp3",
          "D#3": "Ds3.mp3",
          "F#3": "Fs3.mp3",
          A3: "A3.mp3",
          C4: "C4.mp3",
          "D#4": "Ds4.mp3",
          "F#4": "Fs4.mp3",
          A4: "A4.mp3",
          C5: "C5.mp3",
          "D#5": "Ds5.mp3",
          "F#5": "Fs5.mp3",
          A5: "A5.mp3",
          C6: "C6.mp3",
          "D#6": "Ds6.mp3",
          "F#6": "Fs6.mp3",
          A6: "A6.mp3",
          C7: "C7.mp3",
          "D#7": "Ds7.mp3",
          "F#7": "Fs7.mp3",
          A7: "A7.mp3",
          C8: "C8.mp3"
        },
        release: 1,
        baseUrl: "https://tonejs.github.io/audio/salamander/"
      }).toDestination();

      await Tone.loaded();
      console.log('Tone.js sampler loaded');
    }

    console.log(`Loaded ${this.events.length} MIDI events for Tone.js playback`);
  }

  async play(): Promise<void> {
    if (this.isPlaying) return;
    if (this.events.length === 0) {
      throw new Error('No MIDI events loaded');
    }
    if (!this.sampler) {
      throw new Error('Sampler not loaded');
    }

    // Start Tone.js audio context
    await Tone.start();

    this.isPlaying = true;
    this.startTime = Tone.now();
    this.scheduledEvents = [];

    // Schedule all events (skip drum channel)
    let drumNotesSkipped = 0;
    for (const event of this.events) {
      // Skip drum channel (channel 9 in 0-indexed, or channel 10 in MIDI spec)
      if (event.channel === 9) {
        drumNotesSkipped++;
        continue;
      }

      const noteName = this.midiNoteToName(event.pitch);
      const when = this.startTime + event.time;
      const velocity = event.velocity / 127;

      // Schedule note with Tone.js
      const eventId = this.sampler.triggerAttackRelease(
        noteName,
        event.duration,
        when,
        velocity
      );

      this.scheduledEvents.push(eventId as any);
    }

    if (drumNotesSkipped > 0) {
      console.log(`Tone.js: Skipped ${drumNotesSkipped} drum notes (channel 10)`);
    }
    console.log('Tone.js MIDI playback started');

    // Auto-stop when done
    const lastEvent = this.events[this.events.length - 1];
    const totalDuration = lastEvent.time + lastEvent.duration;
    this.autoStopTimeout = window.setTimeout(() => {
      if (this.isPlaying) {
        this.stop();
      }
    }, (totalDuration + 1) * 1000);
  }

  stop(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;

    // Clear auto-stop timeout
    if (this.autoStopTimeout !== null) {
      clearTimeout(this.autoStopTimeout);
      this.autoStopTimeout = null;
    }

    // Release all notes
    if (this.sampler) {
      this.sampler.releaseAll();
    }

    // Clear scheduled events
    this.scheduledEvents = [];

    console.log('Tone.js MIDI playback stopped');
  }

  private midiNoteToName(midiNote: number): string {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midiNote / 12) - 1;
    const noteIndex = midiNote % 12;
    return noteNames[noteIndex] + octave;
  }

  getProgress(): number {
    if (this.events.length === 0 || !this.isPlaying) return 0;

    const currentTime = Tone.now() - this.startTime;
    const totalDuration = Math.max(...this.events.map(e => e.time + e.duration));

    return Math.max(0, Math.min(1, currentTime / totalDuration));
  }

  getDuration(): number {
    if (this.events.length === 0) return 0;
    return Math.max(...this.events.map(e => e.time + e.duration));
  }

  setVolume(volume: number): void {
    if (this.sampler) {
      this.sampler.volume.value = Tone.gainToDb(Math.max(0.01, Math.min(1, volume)));
    }
  }
}
