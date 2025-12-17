import type { ParsedMIDIInfo, TrackInfo } from '../types.js';

export class MIDIParseService {
  parseMIDI(buffer: ArrayBuffer): ParsedMIDIInfo {
    try {
      // Basic MIDI parsing - simplified for MVP
      const view = new DataView(buffer);
      const issues: string[] = [];
      
      // Check header
      if (buffer.byteLength < 14) {
        throw new Error('File too small');
      }
      
      // Read MIDI header
      const headerType = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      if (headerType !== 'MThd') {
        throw new Error('Invalid MIDI header');
      }
      
      const format = view.getUint16(8);
      const trackCount = view.getUint16(10);
      const timeDivision = view.getUint16(12);
      
      if (trackCount === 0) {
        issues.push('No tracks found');
      }
      
      // Estimate duration and tempo (simplified)
      const durationSec = this.estimateDuration(view, buffer.byteLength);
      const tempoBpm = this.estimateTempo(view, timeDivision);
      
      // Create mock track info (real implementation would parse each track)
      const tracks: TrackInfo[] = [];
      for (let i = 0; i < Math.min(trackCount, 16); i++) {
        tracks.push({
          id: i,
          name: `Track ${i + 1}`,
          noteCount: Math.floor(Math.random() * 100) + 10, // Placeholder
          channel: i < 9 ? i : i + 1, // Skip channel 10 (drums)
          register: i === 0 ? 'low' : i < trackCount / 2 ? 'mid' : 'high'
        });
      }
      
      const totalNotes = tracks.reduce((sum, t) => sum + t.noteCount, 0);
      
      // Add quality issues
      if (durationSec < 20) issues.push('Very short duration');
      if (durationSec > 600) issues.push('Very long duration');
      if (totalNotes < 50) issues.push('Very few notes');
      if (trackCount > 20) issues.push('Too many tracks');
      
      return {
        durationSec,
        tempoBpm,
        timeSig: { num: 4, den: 4 }, // Default assumption
        tracks,
        noteCount: totalNotes,
        issues
      };
    } catch (error) {
      throw new Error(`MIDI parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  private estimateDuration(view: DataView, totalSize: number): number {
    // Very rough estimation based on file size
    const sizeKB = totalSize / 1024;
    if (sizeKB < 10) return 30;
    if (sizeKB < 50) return 120;
    if (sizeKB < 200) return 240;
    return 300;
  }
  
  private estimateTempo(view: DataView, timeDivision: number): number {
    // Default tempo estimation
    if (timeDivision & 0x8000) {
      // SMPTE format
      return 120;
    } else {
      // Ticks per quarter note format
      // Look for tempo meta events (would require full parsing)
      return 120; // Default
    }
  }
}