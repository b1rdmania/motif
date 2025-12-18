export class SyntheticMIDI {
  static generateMIDIBuffer(songName: string): ArrayBuffer {
    // Create a minimal MIDI file for testing
    // This is a simplified MIDI file with basic header and one note
    
    const hash = this.simpleHash(songName);
    const tempo = 120 + (hash % 60); // 120-180 BPM
    const key = hash % 12; // 0-11 for C-B
    
    // MIDI Header
    const header = new Uint8Array([
      // "MThd"
      0x4D, 0x54, 0x68, 0x64,
      // Header length (6 bytes)
      0x00, 0x00, 0x00, 0x06,
      // Format type 0
      0x00, 0x00,
      // Number of tracks (1)
      0x00, 0x01,
      // Time division (480 ticks per quarter note)
      0x01, 0xE0
    ]);

    // Track data with some basic notes
    const trackData = this.generateTrackData(key, tempo);
    
    // Track header
    const trackHeader = new Uint8Array([
      // "MTrk"
      0x4D, 0x54, 0x72, 0x6B,
      // Track length (will be calculated)
      0x00, 0x00, 0x00, trackData.length
    ]);
    
    // Combine all parts
    const totalLength = header.length + trackHeader.length + trackData.length;
    const result = new ArrayBuffer(totalLength);
    const view = new Uint8Array(result);
    
    let offset = 0;
    view.set(header, offset);
    offset += header.length;
    view.set(trackHeader, offset);
    offset += trackHeader.length;
    view.set(trackData, offset);
    
    return result;
  }

  private static generateTrackData(key: number, tempo: number): Uint8Array {
    const events: number[] = [];
    
    // Set tempo meta event
    events.push(
      0x00, // Delta time
      0xFF, 0x51, 0x03, // Set tempo meta event
      0x07, 0xA1, 0x20  // 500000 microseconds per quarter note (120 BPM)
    );

    // Add some basic notes in the key
    const scale = [0, 2, 4, 5, 7, 9, 11]; // Major scale
    const baseNote = 60 + key; // Middle C + key offset
    
    let time = 0;
    for (let i = 0; i < 8; i++) {
      const note = baseNote + scale[i % scale.length] + (Math.floor(i / scale.length) * 12);
      
      // Note on
      events.push(
        this.encodeVariableLength(time)[0], // Delta time
        0x90, // Note on, channel 0
        note, // Note number
        0x64  // Velocity
      );
      
      // Note off after 480 ticks (quarter note)
      events.push(
        this.encodeVariableLength(480)[0], // Delta time
        0x80, // Note off, channel 0
        note, // Note number
        0x00  // Velocity
      );
      
      time = 0; // Next note starts immediately after previous ends
    }
    
    // End of track
    events.push(0x00, 0xFF, 0x2F, 0x00);
    
    return new Uint8Array(events);
  }

  private static encodeVariableLength(value: number): number[] {
    if (value < 128) {
      return [value];
    }
    // For simplicity, just handle small values
    return [value & 0x7F];
  }

  private static simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}