import type { ParsedMIDIInfo, TrackInfo } from '../types.js';

export class MIDIParseService {
  parseMIDI(buffer: ArrayBuffer): ParsedMIDIInfo {
    try {
      const view = new DataView(buffer);
      const issues: string[] = [];
      
      if (buffer.byteLength < 14) {
        throw new Error('File too small');
      }
      
      const headerType = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      if (headerType !== 'MThd') {
        throw new Error('Invalid MIDI header');
      }

      const headerLength = view.getUint32(4);
      if (headerLength < 6) {
        throw new Error('Invalid MIDI header length');
      }

      const trackCount = view.getUint16(10);
      const timeDivision = view.getUint16(12);
      
      if (trackCount === 0) {
        issues.push('No tracks found');
      }

      let offset = 8 + headerLength;
      let parsedTracks = 0;
      let maxTick = 0;
      let tempoMicrosPerQuarter = 500000; // 120 BPM default
      let timeSig: { num: number; den: number } | undefined;

      const tracks: TrackInfo[] = [];
      for (let i = 0; i < trackCount && offset + 8 <= buffer.byteLength; i++) {
        const chunkType = String.fromCharCode(
          view.getUint8(offset),
          view.getUint8(offset + 1),
          view.getUint8(offset + 2),
          view.getUint8(offset + 3)
        );
        const chunkLength = view.getUint32(offset + 4);
        const chunkStart = offset + 8;
        const chunkEnd = chunkStart + chunkLength;

        if (chunkType !== 'MTrk') {
          issues.push(`Unexpected chunk type "${chunkType}" at track ${i + 1}`);
          offset = chunkEnd;
          continue;
        }
        if (chunkEnd > buffer.byteLength) {
          issues.push(`Track ${i + 1} exceeds file length`);
          break;
        }

        const parsed = this.parseTrack(view, chunkStart, chunkEnd);
        parsedTracks++;
        maxTick = Math.max(maxTick, parsed.trackEndTick);
        if (parsed.firstTempoMicrosPerQuarter && tempoMicrosPerQuarter === 500000) {
          tempoMicrosPerQuarter = parsed.firstTempoMicrosPerQuarter;
        }
        if (!timeSig && parsed.timeSig) {
          timeSig = parsed.timeSig;
        }

        tracks.push({
          id: i,
          name: parsed.name || `Track ${i + 1}`,
          program: parsed.program,
          noteCount: parsed.noteCount,
          channel: parsed.channel,
          register: this.pitchToRegister(parsed.avgPitch)
        });

        offset = chunkEnd;
      }

      if (parsedTracks < trackCount) {
        issues.push(`Parsed ${parsedTracks}/${trackCount} tracks`);
      }

      const totalNotes = tracks.reduce((sum, t) => sum + t.noteCount, 0);
      const tempoBpm = Math.max(1, Math.round((60_000_000 / tempoMicrosPerQuarter) * 100) / 100);
      const durationSec = this.estimateDurationSec(maxTick, timeDivision, tempoBpm);

      if (durationSec < 20) issues.push('Very short duration');
      if (durationSec > 600) issues.push('Very long duration');
      if (totalNotes < 50) issues.push('Very few notes');
      if (trackCount > 20) issues.push('Too many tracks');
      
      return {
        durationSec,
        tempoBpm,
        timeSig: timeSig || { num: 4, den: 4 },
        tracks,
        noteCount: totalNotes,
        issues
      };
    } catch (error) {
      throw new Error(`MIDI parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  private parseTrack(view: DataView, start: number, end: number): {
    noteCount: number;
    trackEndTick: number;
    firstTempoMicrosPerQuarter?: number;
    timeSig?: { num: number; den: number };
    name?: string;
    program?: number;
    channel?: number;
    avgPitch: number;
  } {
    let pos = start;
    let runningStatus = 0;
    let tick = 0;
    let firstTempoMicrosPerQuarter: number | undefined;
    let timeSig: { num: number; den: number } | undefined;
    let name: string | undefined;
    let program: number | undefined;
    let channel: number | undefined;
    let noteCount = 0;
    let pitchSum = 0;

    while (pos < end) {
      const delta = this.readVarLen(view, pos, end);
      pos = delta.next;
      tick += delta.value;

      if (pos >= end) break;

      let status = view.getUint8(pos);
      if (status < 0x80) {
        if (runningStatus === 0) {
          break;
        }
        status = runningStatus;
      } else {
        pos++;
        runningStatus = status;
      }

      // Meta event
      if (status === 0xff) {
        if (pos >= end) break;
        const metaType = view.getUint8(pos++);
        const len = this.readVarLen(view, pos, end);
        pos = len.next;
        const dataStart = pos;
        const dataEnd = Math.min(end, pos + len.value);

        if (metaType === 0x03 && !name) {
          name = this.decodeAscii(view, dataStart, dataEnd);
        } else if (metaType === 0x51 && len.value === 3 && firstTempoMicrosPerQuarter === undefined) {
          firstTempoMicrosPerQuarter =
            (view.getUint8(dataStart) << 16) |
            (view.getUint8(dataStart + 1) << 8) |
            view.getUint8(dataStart + 2);
        } else if (metaType === 0x58 && len.value >= 2 && !timeSig) {
          const num = view.getUint8(dataStart);
          const denPow = view.getUint8(dataStart + 1);
          timeSig = { num, den: Math.pow(2, denPow) };
        }

        pos = dataEnd;
        continue;
      }

      // SysEx (skip payload)
      if (status === 0xf0 || status === 0xf7) {
        const len = this.readVarLen(view, pos, end);
        pos = Math.min(end, len.next + len.value);
        continue;
      }

      const eventType = status & 0xf0;
      const eventChannel = status & 0x0f;

      if (channel === undefined) {
        channel = eventChannel;
      }

      const hasTwoDataBytes =
        eventType === 0x80 ||
        eventType === 0x90 ||
        eventType === 0xa0 ||
        eventType === 0xb0 ||
        eventType === 0xe0;

      if (hasTwoDataBytes) {
        if (pos + 1 >= end) break;
        const data1 = view.getUint8(pos++);
        const data2 = view.getUint8(pos++);

        // Program-like estimate for melodic tracks
        if (eventType === 0x90 && data2 > 0) {
          noteCount++;
          pitchSum += data1;
        }
      } else if (eventType === 0xc0 || eventType === 0xd0) {
        if (pos >= end) break;
        const data = view.getUint8(pos++);
        if (eventType === 0xc0 && program === undefined) {
          program = data;
        }
      } else {
        // Unknown status; stop to avoid desync.
        break;
      }
    }

    return {
      noteCount,
      trackEndTick: tick,
      firstTempoMicrosPerQuarter,
      timeSig,
      name,
      program,
      channel,
      avgPitch: noteCount > 0 ? pitchSum / noteCount : 60,
    };
  }

  private readVarLen(view: DataView, pos: number, end: number): { value: number; next: number } {
    let value = 0;
    let cursor = pos;
    for (let i = 0; i < 4 && cursor < end; i++) {
      const b = view.getUint8(cursor++);
      value = (value << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return { value, next: cursor };
  }

  private decodeAscii(view: DataView, start: number, end: number): string {
    let out = '';
    for (let i = start; i < end; i++) {
      const code = view.getUint8(i);
      if (code >= 32 && code <= 126) out += String.fromCharCode(code);
    }
    return out.trim();
  }

  private pitchToRegister(avgPitch: number): 'low' | 'mid' | 'high' {
    if (avgPitch < 48) return 'low';
    if (avgPitch < 72) return 'mid';
    return 'high';
  }

  private estimateDurationSec(maxTick: number, timeDivision: number, tempoBpm: number): number {
    // SMPTE time format is more complex; use conservative fallback.
    if ((timeDivision & 0x8000) !== 0) {
      return Math.max(0, Math.round((maxTick / 1000) * 100) / 100);
    }
    const ticksPerQuarter = timeDivision || 480;
    const seconds = (maxTick / ticksPerQuarter) * (60 / tempoBpm);
    return Math.max(0, Math.round(seconds * 100) / 100);
  }
}
