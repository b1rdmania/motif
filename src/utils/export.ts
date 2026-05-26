import type { NoteEvent } from '../types';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function writeVarLen(value: number): number[] {
  let v = Math.max(0, Math.floor(value));
  const bytes: number[] = [v & 0x7f];
  while ((v >>= 7) > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
  }
  return bytes;
}

function strBytes(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0) & 0xff);
}

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u32be(n: number): number[] {
  return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function noteEventsToMidiBytes(events: NoteEvent[], ppq = 480, bpm = 120): Uint8Array {
  const safeEvents = events
    .filter((e) => Number.isFinite(e.time) && Number.isFinite(e.duration) && e.duration > 0)
    .map((e) => ({ ...e }))
    .sort((a, b) => a.time - b.time);

  const ticksPerSec = (ppq * bpm) / 60;
  const midiEvents: Array<{ tick: number; on: boolean; pitch: number; velocity: number }> = [];

  for (const e of safeEvents) {
    const startTick = Math.max(0, Math.round(e.time * ticksPerSec));
    const endTick = Math.max(startTick + 1, Math.round((e.time + e.duration) * ticksPerSec));
    const pitch = clamp(Math.round(e.pitch), 0, 127);
    const vel = clamp(Math.round((e.velocity || 0.7) * 127), 1, 127);
    midiEvents.push({ tick: startTick, on: true, pitch, velocity: vel });
    midiEvents.push({ tick: endTick, on: false, pitch, velocity: 0 });
  }

  midiEvents.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    if (a.on === b.on) return 0;
    return a.on ? 1 : -1; // Note-off first at same tick
  });

  const trackData: number[] = [];
  const tempoMpqn = Math.round(60000000 / Math.max(1, bpm));
  trackData.push(0x00, 0xff, 0x51, 0x03, (tempoMpqn >> 16) & 0xff, (tempoMpqn >> 8) & 0xff, tempoMpqn & 0xff);

  let lastTick = 0;
  for (const ev of midiEvents) {
    const delta = ev.tick - lastTick;
    trackData.push(...writeVarLen(delta));
    trackData.push(ev.on ? 0x90 : 0x80, ev.pitch, ev.velocity);
    lastTick = ev.tick;
  }

  trackData.push(0x00, 0xff, 0x2f, 0x00); // end of track

  const header = [
    ...strBytes('MThd'),
    ...u32be(6),
    ...u16be(0), // format 0
    ...u16be(1), // one track
    ...u16be(ppq),
  ];

  const track = [
    ...strBytes('MTrk'),
    ...u32be(trackData.length),
    ...trackData,
  ];

  return new Uint8Array([...header, ...track]);
}

export function audioBufferToWavBytes(buffer: AudioBuffer): Uint8Array {
  const channels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = length * blockAlign;
  const totalSize = 44 + dataSize;

  const out = new ArrayBuffer(totalSize);
  const view = new DataView(out);
  let offset = 0;

  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  };
  const writeU16 = (n: number) => { view.setUint16(offset, n, true); offset += 2; };
  const writeU32 = (n: number) => { view.setUint32(offset, n, true); offset += 4; };

  writeStr('RIFF');
  writeU32(36 + dataSize);
  writeStr('WAVE');
  writeStr('fmt ');
  writeU32(16);
  writeU16(1); // PCM
  writeU16(channels);
  writeU32(sampleRate);
  writeU32(sampleRate * blockAlign);
  writeU16(blockAlign);
  writeU16(16);
  writeStr('data');
  writeU32(dataSize);

  const chData = Array.from({ length: channels }, (_, ch) => buffer.getChannelData(ch));
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const sample = clamp(chData[ch][i] || 0, -1, 1);
      const int16 = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Uint8Array(out);
}
