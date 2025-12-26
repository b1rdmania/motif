import { MIDIService } from './services/MIDIService';
import { MIDIParser } from './midi/MIDIParser';
import { MotifEngine } from './core/MotifEngine';
import type { NoteEvent } from './types';

function qs(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function getParam(name: string): string | null {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function buildMidiUrlFromParams(): { midiUrl: string | null; title: string } {
  const u = getParam('u');
  const src = getParam('src');
  const id = getParam('id');
  const title = getParam('title') || 'Shared MOTIF';

  if (u) return { midiUrl: u, title };

  // Short-link form (no server storage): reconstruct known providers.
  if (src === 'bitmidi' && id && /^\d+$/.test(id)) {
    return { midiUrl: `https://bitmidi.com/uploads/${id}.mid`, title };
  }

  return { midiUrl: null, title };
}

function titleCase(input: string): string {
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'via', 'with']);
  const words = input
    .split(/\s+/g)
    .filter(Boolean)
    .map((w) => w.trim());
  return words
    .map((word, idx) => {
      if (/^[A-Z0-9]+$/.test(word)) return word; // keep acronyms/IDs
      const lower = word.toLowerCase();
      if (idx !== 0 && small.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function cleanLooseTitle(raw: string): string {
  return (raw || '')
    .replace(/\.mid$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/[.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDisplayTitle(raw: string): { display: string; prefill: string } {
  const cleaned = cleanLooseTitle(raw);
  // If we have common separators "Artist - Title" or "Artist — Title", invert to "Title — Artist"
  const sepMatch = cleaned.match(/^(.+?)\s*(?:—|-)\s*(.+)$/);
  if (sepMatch) {
    const left = titleCase(sepMatch[1].trim());
    const right = titleCase(sepMatch[2].trim());
    // Heuristic: if left looks like an artist, invert (most common file naming)
    const display = `${right} — ${left}`;
    return { display, prefill: `${right} ${left}`.trim() };
  }

  // Dot-prefix heuristic: "ARTIST.Title" becomes "Title — Artist"
  const dotPrefix = raw.match(/^([A-Za-z]{2,20})[._\s]+(.+)$/);
  if (dotPrefix && dotPrefix[1] && dotPrefix[2]) {
    const artist = titleCase(cleanLooseTitle(dotPrefix[1]));
    const title = titleCase(cleanLooseTitle(dotPrefix[2]));
    if (artist && title) return { display: `${title} — ${artist}`, prefill: `${title} ${artist}`.trim() };
  }

  const t = titleCase(cleaned || 'Shared Motif');
  return { display: t, prefill: t };
}

async function main(): Promise<void> {
  const titleEl = qs('songTitle');
  const playBtn = qs('playToggleBtn') as HTMLButtonElement;
  const volumeEl = qs('volume') as HTMLInputElement;
  const generateOwn = qs('generateOwn') as HTMLAnchorElement;
  const progressContainer = qs('playProgressContainer') as HTMLElement;
  const progressBar = qs('playProgressBar') as HTMLInputElement;
  const progressFill = qs('playProgressFill') as HTMLElement;
  const currentTimeEl = qs('playCurrentTime') as HTMLElement;
  const durationEl = qs('playDuration') as HTMLElement;

  const { midiUrl: u, title } = buildMidiUrlFromParams();

  const formatted = formatDisplayTitle(title);
  titleEl.textContent = formatted.display;

  // Set CTA back to home, prefilling search if we have a title.
  generateOwn.href = formatted.prefill ? `/?song=${encodeURIComponent(formatted.prefill)}` : '/';

  if (!u) {
    playBtn.disabled = true;
    return;
  }

  const midiService = new MIDIService();
  const motifEngine = new MotifEngine();
  let events: NoteEvent[] | null = null;
  let isPlaying = false;
  let isGenerated = false;
  let progressInterval: number | null = null;
  let durationSec = 0;
  let resumeProgress = 0;
  let playStartMs: number | null = null; // performance.now() at audio time=0 (minus offset)
  let playOffsetSec = 0; // last known playback position in seconds

  try {
    const buf = await midiService.fetchMIDI(u);
    if (!buf) throw new Error('Failed to fetch MIDI');
    events = MIDIParser.parseMIDI(buf);
    playBtn.disabled = false;
  } catch (e) {
    playBtn.disabled = true;
    return;
  }

  function setUiPlaying(playing: boolean): void {
    isPlaying = playing;
    playBtn.textContent = playing ? 'Pause' : 'Play';
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function getLocalCurrentTime(): number {
    if (!durationSec) return 0;
    if (!isPlaying || playStartMs === null) return Math.max(0, Math.min(durationSec, playOffsetSec));
    const t = (performance.now() - playStartMs) / 1000;
    return Math.max(0, Math.min(durationSec, t));
  }

  function updateProgress(): void {
    const current = getLocalCurrentTime();
    const progress = durationSec > 0 ? current / durationSec : 0;
    progressBar.value = (progress * 100).toString();
    progressFill.style.width = `${progress * 100}%`;
    currentTimeEl.textContent = formatTime(current);

    // Auto-pause at end
    if (durationSec > 0 && current >= durationSec - 0.05) {
      resumeProgress = 0;
      playOffsetSec = 0;
      playStartMs = null;
      motifEngine.stop();
      setUiPlaying(false);
      stopProgressUpdates();
      progressBar.value = '100';
      progressFill.style.width = '100%';
      currentTimeEl.textContent = formatTime(durationSec);
    }
  }

  function startProgressUpdates(): void {
    stopProgressUpdates();
    progressInterval = window.setInterval(updateProgress, 100);
  }

  function stopProgressUpdates(): void {
    if (progressInterval !== null) {
      window.clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  volumeEl.addEventListener('input', () => {
    const vol = Number.parseFloat(volumeEl.value);
    motifEngine.setVolume(vol);
  });

  const seekHandler = (e: Event) => {
    const p = Number.parseFloat((e.target as HTMLInputElement).value) / 100;
    if (!isGenerated) {
      resumeProgress = p;
      progressFill.style.width = `${p * 100}%`;
      currentTimeEl.textContent = durationSec > 0 ? formatTime(p * durationSec) : '0:00';
      return;
    }
    if (isPlaying) {
      playOffsetSec = p * durationSec;
      playStartMs = performance.now() - playOffsetSec * 1000;
      motifEngine.seek(p);
      updateProgress();
    } else {
      resumeProgress = p;
      playOffsetSec = p * durationSec;
      progressFill.style.width = `${p * 100}%`;
      currentTimeEl.textContent = formatTime(p * durationSec);
    }
  };
  progressBar.addEventListener('input', seekHandler);
  progressBar.addEventListener('change', seekHandler);

  playBtn.addEventListener('click', async () => {
    if (!events) return;

    // Pause (implemented as stop + remembered position)
    if (isPlaying) {
      const current = getLocalCurrentTime();
      resumeProgress = durationSec > 0 ? current / durationSec : 0;
      playOffsetSec = current;
      playStartMs = null;
      motifEngine.stop();
      setUiPlaying(false);
      stopProgressUpdates();
      // Keep progress UI where it was
      progressBar.value = (resumeProgress * 100).toString();
      progressFill.style.width = `${resumeProgress * 100}%`;
      currentTimeEl.textContent = formatTime(resumeProgress * durationSec);
      return;
    }

    try {
      // First play generates the artifact (deterministically from MIDI structure).
      if (!isGenerated) {
        // Match main page "Generate & Play": procedural role-mapping → existing SynthesisEngine.
        await motifEngine.generateFromMIDI(events, 'procedural');
        motifEngine.setVolume(Number.parseFloat(volumeEl.value));
        durationSec = motifEngine.getDuration();
        durationEl.textContent = formatTime(durationSec);
        progressContainer.style.display = 'block';
        isGenerated = true;
        // If user scrubbed before play, carry that into seconds now that we know duration.
        playOffsetSec = resumeProgress * durationSec;
      }

      setUiPlaying(true);
      await motifEngine.play();
      // Seek to remembered position (for pause/resume and scrub-before-play)
      if (durationSec > 0 && playOffsetSec > 0) {
        resumeProgress = playOffsetSec / durationSec;
      }
      if (resumeProgress > 0) motifEngine.seek(resumeProgress);
      // Local progress tracking
      playStartMs = performance.now() - playOffsetSec * 1000;
      startProgressUpdates();
    } catch (e) {
      setUiPlaying(false);
      playStartMs = null;
      stopProgressUpdates();
    }
  });
}

void main();

