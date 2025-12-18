import Soundfont from 'soundfont-player';
import type { NoteEvent } from '../types';

interface ScheduledNote {
  noteOff: () => void;
  time: number;
}

export class SoundfontMIDIPlayer {
  private audioContext: AudioContext;
  private instrument: any = null;
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
    this.masterGain.gain.value = 1.0; // Full volume
  }

  async load(events: NoteEvent[]): Promise<void> {
    const sorted = [...events].sort((a, b) => a.time - b.time);

    // Normalize times to start at 0 (skip leading silence)
    const minTime = sorted.length > 0 ? sorted[0].time : 0;
    this.events = sorted.map(e => ({ ...e, time: e.time - minTime }));
    this.currentEventIndex = 0;
    
    // Load the acoustic grand piano instrument (most versatile for MIDI playback)
    if (!this.instrument) {
      console.log('Loading acoustic grand piano soundfont...');
      try {
        this.instrument = await Soundfont.instrument(this.audioContext, 'acoustic_grand_piano');
        console.log('Soundfont loaded successfully');
      } catch (error) {
        console.error('Failed to load soundfont:', error);
        throw new Error('Could not load piano soundfont - check internet connection');
      }
    }
    
    console.log(`Loaded ${this.events.length} MIDI events for soundfont playback`);
  }

  async play(): Promise<void> {
    if (this.isPlaying) return;
    if (this.events.length === 0) {
      throw new Error('No MIDI events loaded');
    }
    if (!this.instrument) {
      throw new Error('Soundfont not loaded');
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

    console.log('Soundfont MIDI playback started');
  }

  stop(): void {
    console.log('SoundfontMIDIPlayer.stop() called, isPlaying:', this.isPlaying);
    if (!this.isPlaying) {
      console.log('Already stopped, returning');
      return;
    }

    this.isPlaying = false;

    if (this.schedulerIntervalId) {
      clearInterval(this.schedulerIntervalId);
      this.schedulerIntervalId = null;
    }

    // Stop all scheduled notes immediately
    const now = this.audioContext.currentTime;
    for (const scheduledNote of this.scheduledNotes) {
      try {
        scheduledNote.noteOff();
      } catch (e) {
        // Note might already be stopped
      }
    }
    this.scheduledNotes = [];

    // Fade out master gain quickly
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(0, now + 0.05);

    // Reset volume after fade
    setTimeout(() => {
      if (!this.isPlaying) {
        this.masterGain.gain.value = 1.0;
      }
    }, 100);

    console.log('Soundfont MIDI playback stopped');
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
    if (!this.instrument) return;

    // Skip drum channel (channel 9 in 0-indexed, or channel 10 in MIDI spec)
    if (event.channel === 9) {
      return;
    }

    try {
      // Convert MIDI note number to note name (for soundfont-player)
      const noteName = this.midiNoteToName(event.pitch);
      const duration = event.duration;
      const velocity = event.velocity / 127; // Normalize to 0-1

      // Play note with soundfont
      const noteOff = this.instrument.play(noteName, when, {
        duration: duration,
        gain: Math.max(0.3, velocity * 1.2) // Boost volume, minimum 0.3
      });

      // Track scheduled note for cleanup
      if (noteOff) {
        const scheduledNote: ScheduledNote = {
          noteOff,
          time: when
        };
        this.scheduledNotes.push(scheduledNote);

        // Clean up old scheduled notes
        const cutoffTime = when - 5.0; // Keep 5 seconds of history
        this.scheduledNotes = this.scheduledNotes.filter(n => n.time > cutoffTime);
      }

    } catch (error) {
      console.warn('Failed to schedule note:', error);
    }
  }

  private midiNoteToName(midiNote: number): string {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midiNote / 12) - 1;
    const noteIndex = midiNote % 12;
    return noteNames[noteIndex] + octave;
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