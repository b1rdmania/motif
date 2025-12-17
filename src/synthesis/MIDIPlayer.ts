import type { NoteEvent } from '../types';

export class MIDIPlayer {
  private audioContext: AudioContext;
  private masterGain: GainNode;
  private isPlaying = false;
  private schedulerIntervalId: number | null = null;
  private startTime = 0;
  private events: NoteEvent[] = [];
  private currentEventIndex = 0;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
    this.masterGain = audioContext.createGain();
    this.masterGain.connect(audioContext.destination);
    this.masterGain.gain.value = 0.3;
  }

  load(events: NoteEvent[]): void {
    this.events = [...events].sort((a, b) => a.time - b.time);
    this.currentEventIndex = 0;
    console.log(`Loaded ${this.events.length} MIDI events for preview`);
  }

  async play(): Promise<void> {
    if (this.isPlaying) return;
    if (this.events.length === 0) {
      throw new Error('No MIDI events loaded');
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.isPlaying = true;
    this.startTime = this.audioContext.currentTime;
    this.currentEventIndex = 0;

    // Schedule events with lookahead
    this.schedulerIntervalId = window.setInterval(() => {
      this.scheduleEvents();
    }, 25); // 25ms lookahead scheduling

    console.log('MIDI preview started');
  }

  stop(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    
    if (this.schedulerIntervalId) {
      clearInterval(this.schedulerIntervalId);
      this.schedulerIntervalId = null;
    }

    // Fade out
    this.masterGain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.1);
    
    // Reset volume after fade
    setTimeout(() => {
      if (!this.isPlaying) {
        this.masterGain.gain.value = 0.3;
      }
    }, 150);

    console.log('MIDI preview stopped');
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
      if (eventTime >= currentTime) {
        this.scheduleNote(event, eventTime);
      }

      this.currentEventIndex++;
    }

    // Stop when all events are done
    if (this.currentEventIndex >= this.events.length) {
      // Check if we're past the last event's end time
      const lastEvent = this.events[this.events.length - 1];
      const lastEventEnd = this.startTime + lastEvent.time + lastEvent.duration;
      
      if (currentTime > lastEventEnd + 1.0) { // 1 second grace period
        this.stop();
      }
    }
  }

  private scheduleNote(event: NoteEvent, when: number): void {
    const osc = this.audioContext.createOscillator();
    const envelope = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    // Basic frequency conversion
    const frequency = 440 * Math.pow(2, (event.pitch - 69) / 12);
    osc.frequency.value = frequency;

    // Simple timbre based on track/register
    if (event.pitch < 48) {
      // Bass register
      osc.type = 'square';
      filter.type = 'lowpass';
      filter.frequency.value = 400;
    } else if (event.pitch > 84) {
      // High register
      osc.type = 'sine';
      filter.type = 'highpass';
      filter.frequency.value = 800;
    } else {
      // Mid register
      osc.type = 'triangle';
      filter.type = 'bandpass';
      filter.frequency.value = 1000;
    }

    // Channel 10 (drums) handling
    if (event.track === 9) { // Track 9 = MIDI channel 10 (drums)
      osc.type = 'sawtooth';
      filter.type = 'highpass';
      filter.frequency.value = 2000;
    }

    // Connect audio graph
    osc.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.masterGain);

    // Envelope
    const gainValue = (event.velocity * 0.4) / Math.max(this.getPolyphonyAtTime(event.time), 1);
    const attackTime = Math.min(0.02, event.duration * 0.1);
    const releaseTime = Math.min(0.05, event.duration * 0.2);

    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(gainValue, when + attackTime);
    envelope.gain.linearRampToValueAtTime(gainValue * 0.7, when + event.duration - releaseTime);
    envelope.gain.exponentialRampToValueAtTime(0.001, when + event.duration);

    osc.start(when);
    osc.stop(when + event.duration);

    // Cleanup
    setTimeout(() => {
      try {
        osc.disconnect();
        filter.disconnect();
        envelope.disconnect();
      } catch (e) {
        // Already disconnected
      }
    }, (event.duration + 0.1) * 1000);
  }

  private getPolyphonyAtTime(time: number): number {
    // Count overlapping notes for volume scaling
    let count = 0;
    const tolerance = 0.05; // 50ms tolerance
    
    for (const event of this.events) {
      if (event.time <= time + tolerance && 
          event.time + event.duration >= time - tolerance) {
        count++;
      }
    }
    
    return Math.max(count, 1);
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
}