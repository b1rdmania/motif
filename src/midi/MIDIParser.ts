import { Midi } from '@tonejs/midi';
import type { NoteEvent } from '../types';

export class MIDIParser {
  static parseMIDI(arrayBuffer: ArrayBuffer): NoteEvent[] {
    try {
      const midi = new Midi(arrayBuffer);
      const events: NoteEvent[] = [];
      
      midi.tracks.forEach((track, trackIndex) => {
        track.notes.forEach(note => {
          events.push({
            time: note.time,
            duration: note.duration,
            pitch: note.midi,
            velocity: note.velocity,
            track: trackIndex,
            channel: track.channel // Capture MIDI channel (9 = drums)
          });
        });
      });
      
      // Sort events by time
      events.sort((a, b) => a.time - b.time);
      
      console.log(`Parsed ${events.length} notes from ${midi.tracks.length} tracks`);
      return events;
    } catch (error) {
      console.error('MIDI parsing error:', error);
      throw new Error(`Failed to parse MIDI: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  static getMIDIInfo(arrayBuffer: ArrayBuffer): {
    duration: number;
    trackCount: number;
    noteCount: number;
    tempo: number;
  } {
    try {
      const midi = new Midi(arrayBuffer);
      
      return {
        duration: midi.duration,
        trackCount: midi.tracks.length,
        noteCount: midi.tracks.reduce((total, track) => total + track.notes.length, 0),
        tempo: midi.header.tempos[0]?.bpm || 120
      };
    } catch (error) {
      console.error('MIDI info extraction error:', error);
      return {
        duration: 0,
        trackCount: 0,
        noteCount: 0,
        tempo: 120
      };
    }
  }
}