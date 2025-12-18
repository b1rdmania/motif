export class SimpleMIDI {
  static generateValidMIDI(songName: string): ArrayBuffer {
    // Create a minimal but valid MIDI file
    const data: number[] = [];
    
    // MIDI Header (14 bytes)
    // "MThd" magic number
    data.push(0x4D, 0x54, 0x68, 0x64);
    // Header chunk size (6)
    data.push(0x00, 0x00, 0x00, 0x06);
    // Format 0
    data.push(0x00, 0x00);
    // 1 track
    data.push(0x00, 0x01);
    // 96 ticks per quarter note
    data.push(0x00, 0x60);
    
    // Track Header
    // "MTrk" magic number
    data.push(0x4D, 0x54, 0x72, 0x6B);
    
    // Track data
    const trackData: number[] = [];
    
    // Set tempo (120 BPM)
    trackData.push(0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20);
    
    // Generate a simple melody based on song name
    const hash = this.simpleHash(songName);
    const rootNote = 60 + (hash % 12); // C4 + offset
    
    // Simple 4-note melody
    const melody = [0, 4, 7, 12]; // Root, major 3rd, perfect 5th, octave
    
    for (let i = 0; i < melody.length; i++) {
      const note = rootNote + melody[i];
      
      // Note On (96 ticks = quarter note at 96 PPQ)
      trackData.push(0x00, 0x90, note, 0x40); // Delta time, Note On Ch0, Note, Velocity
      
      // Note Off after 48 ticks (eighth note)
      trackData.push(0x30, 0x80, note, 0x00); // Delta time, Note Off Ch0, Note, Velocity
    }
    
    // End of track
    trackData.push(0x00, 0xFF, 0x2F, 0x00);
    
    // Track length (4 bytes, big endian)
    const trackLength = trackData.length;
    data.push(
      (trackLength >> 24) & 0xFF,
      (trackLength >> 16) & 0xFF,
      (trackLength >> 8) & 0xFF,
      trackLength & 0xFF
    );
    
    // Add track data
    data.push(...trackData);
    
    // Convert to ArrayBuffer
    return new Uint8Array(data).buffer;
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