// Using dynamic import to handle the CommonJS module properly
export class ProperMIDI {
  static async generateMIDI(songName: string): Promise<ArrayBuffer> {
    console.log(`Generating synthetic MIDI for: ${songName}`);
    
    try {
      const MidiWriter = await import('midi-writer-js');
      
      // Create a hash-based seed for deterministic generation
      const hash = this.simpleHash(songName);
      const tempo = 120 + (hash % 40); // 120-160 BPM
      
      // Create a new track - try different import patterns
      const track = new (MidiWriter as any).Track();
      
      // Set tempo
      track.addEvent(new (MidiWriter as any).TempoEvent({ bpm: tempo }));
      
      // Create simple melody
      const notes = this.generateSimpleNotes(hash);
      
      // Add notes to track
      for (const note of notes) {
        track.addEvent(new (MidiWriter as any).NoteEvent({
          pitch: note.pitch,
          duration: note.duration,
          velocity: note.velocity,
          wait: note.wait
        }));
      }
      
      // Create writer and generate MIDI file
      const writer = new (MidiWriter as any).Writer(track);
      const midiData = writer.buildFile();
      
      // Convert to ArrayBuffer
      const uint8Array = new Uint8Array(midiData);
      return uint8Array.buffer;
    } catch (error) {
      console.error('MIDI generation error:', error);
      // Fallback to simple MIDI generation
      return this.generateFallbackMIDI(songName);
    }
  }
  
  private static getScale(key: number): number[] {
    // Major scale intervals
    const intervals = [0, 2, 4, 5, 7, 9, 11];
    const baseNote = 60 + key; // Middle C + key offset
    return intervals.map(interval => baseNote + interval);
  }
  
  private static generateSimpleNotes(hash: number): Array<{
    pitch: string,
    duration: string,
    velocity: number,
    wait: string
  }> {
    const notes = [];
    const durations = ['4', '8', '8', '4']; // Quarter, eighth, eighth, quarter
    const scale = [60, 62, 64, 65, 67, 69, 71]; // C major scale starting at C4
    
    for (let i = 0; i < 8; i++) {
      const noteIndex = (hash + i * 3) % scale.length;
      const pitch = scale[noteIndex];
      
      notes.push({
        pitch: this.midiNumberToNote(pitch),
        duration: durations[i % durations.length],
        velocity: 70 + ((hash + i * 5) % 30), // 70-100 velocity
        wait: i === 0 ? '0' : '0' // No wait between notes for legato
      });
    }
    
    return notes;
  }
  
  private static generateFallbackMIDI(songName: string): ArrayBuffer {
    console.log('Using fallback MIDI generation for:', songName);
    
    // Simple MIDI file structure
    const data: number[] = [];
    
    // MIDI Header (14 bytes)
    data.push(0x4D, 0x54, 0x68, 0x64); // "MThd"
    data.push(0x00, 0x00, 0x00, 0x06); // Header chunk size
    data.push(0x00, 0x00); // Format 0
    data.push(0x00, 0x01); // 1 track
    data.push(0x00, 0x60); // 96 ticks per quarter note
    
    // Track data
    const trackData: number[] = [];
    
    // Set tempo (120 BPM)
    trackData.push(0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20);
    
    // Simple 4-note melody
    const hash = this.simpleHash(songName);
    const rootNote = 60 + (hash % 12); // C4 + offset
    const melody = [0, 4, 7, 12]; // Root, major 3rd, perfect 5th, octave
    
    for (let i = 0; i < melody.length; i++) {
      const note = rootNote + melody[i];
      trackData.push(0x00, 0x90, note, 0x40); // Note On
      trackData.push(0x30, 0x80, note, 0x00); // Note Off after 48 ticks
    }
    
    // End of track
    trackData.push(0x00, 0xFF, 0x2F, 0x00);
    
    // Track header
    data.push(0x4D, 0x54, 0x72, 0x6B); // "MTrk"
    const trackLength = trackData.length;
    data.push(
      (trackLength >> 24) & 0xFF,
      (trackLength >> 16) & 0xFF,
      (trackLength >> 8) & 0xFF,
      trackLength & 0xFF
    );
    
    data.push(...trackData);
    
    return new Uint8Array(data).buffer;
  }
  
  private static midiNumberToNote(midiNumber: number): string {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midiNumber / 12) - 1;
    const note = noteNames[midiNumber % 12];
    return `${note}${octave}`;
  }
  
  private static simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}