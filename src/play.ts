import { MIDIService } from './services/MIDIService';
import { MIDIParser } from './midi/MIDIParser';
import { MotifEngine } from './core/MotifEngine';
import { unlockAudio } from './utils/audioUnlock';
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
    .trim()
    // Strip standalone "mid" or "midi" words
    .replace(/\b(midi?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripJunkTokens(s: string): string {
  const tokens = (s || '').split(/\s+/g).filter(Boolean);
  const drop = new Set(['MID', 'MIDI', 'K']);
  const out: string[] = [];
  for (const t of tokens) {
    const up = t.toUpperCase();
    if (drop.has(up)) continue;
    // drop single-letter suffix tokens (common filename artefacts)
    if (/^[A-Z]$/i.test(t)) continue;
    out.push(t);
  }
  return out.join(' ');
}

function scoreTitleLike(part: string): number {
  const words = (part || '').split(/\s+/g).filter(Boolean);
  let score = 0;
  for (const w of words) {
    const isCaps = w.length >= 3 && w === w.toUpperCase() && /[A-Z]/.test(w);
    const isWordy = w.length >= 3;
    if (isWordy && !isCaps) score += 2;
    if (isCaps) score -= 2;
    if (w.length === 1) score -= 1;
  }
  score += Math.min(6, words.length);
  return score;
}

function splitOnSeparators(raw: string): string[] {
  const normalized = (raw || '')
    .replace(/[–—]/g, '-') // normalize en/em-dash to hyphen
    .replace(/\s*-\s*/g, ' - ');
  return normalized
    .split(/\s+-\s+/g)
    .map((p) => p.trim())
    .filter(Boolean);
}

function pickShareTitle(raw: string): { title: string; artist: string | null; prefill: string } {
  const cleaned = cleanLooseTitle(raw);
  const parts = splitOnSeparators(cleaned);

  // Default: use best-looking part and avoid guessing artist unless very confident.
  let chosen = cleaned;
  let artist: string | null = null;

  if (parts.length >= 2) {
    const a = parts[0];
    const b = parts.slice(1).join(' - ');
    const scoreA = scoreTitleLike(a);
    const scoreB = scoreTitleLike(b);
    chosen = scoreB > scoreA ? b : a;
    if (scoreA === scoreB) chosen = b; // default to "Artist - Title" pattern

    // Only show artist if the other side looks confidently like a human name/titlecase.
    const other = chosen === a ? b : a;
    const otherTC = titleCase(stripJunkTokens(other));
    const chosenTC = titleCase(stripJunkTokens(chosen));
    const looksLikeName = otherTC.split(/\s+/).length >= 2 && otherTC !== otherTC.toUpperCase();
    if (looksLikeName && chosenTC && chosenTC.length >= 3) {
      // Only accept if other isn't screaming filename (no digits, no extensions)
      if (!/[0-9]/.test(otherTC)) artist = otherTC;
    }
  }

  const title = titleCase(stripJunkTokens(chosen)).trim();
  return { title: title || 'Shared Motif', artist, prefill: title || cleaned || 'Shared Motif' };
}

async function main(): Promise<void> {
  const titleEl = qs('songTitle');
  const artistEl = qs('songArtist');
  const playBtn = qs('playToggleBtn') as HTMLButtonElement;
  const generateOwn = qs('generateOwn') as HTMLAnchorElement;
  const progressContainer = qs('playProgressContainer') as HTMLElement;
  const progressBar = qs('playProgressBar') as HTMLInputElement;
  const progressFill = qs('playProgressFill') as HTMLElement;
  const currentTimeEl = qs('playCurrentTime') as HTMLElement;
  const durationEl = qs('playDuration') as HTMLElement;
  const timeRow = qs('playTimeRow') as HTMLElement;

  const { midiUrl: u, title } = buildMidiUrlFromParams();

  const picked = pickShareTitle(title);
  titleEl.textContent = picked.title;
  if (picked.artist) {
    artistEl.textContent = picked.artist;
    (artistEl as HTMLElement).style.display = 'block';
  } else {
    (artistEl as HTMLElement).style.display = 'none';
  }

  // Set CTA back to home, prefilling search if we have a title.
  generateOwn.href = picked.prefill ? `/?song=${encodeURIComponent(picked.prefill)}` : '/';

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
  let timeRowTimeout: number | null = null;

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

  function showTimeRow(): void {
    timeRow.classList.add('active');
    if (timeRowTimeout) window.clearTimeout(timeRowTimeout);
    timeRowTimeout = window.setTimeout(() => timeRow.classList.remove('active'), 900);
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

  const seekHandler = (e: Event) => {
    showTimeRow();
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

    // CRITICAL: On iOS, we must interact with AudioContext synchronously
    // in the user gesture before any async work. Fire off unlock immediately.
    const unlockPromise = unlockAudio();

    // Pause (implemented as stop + remembered position)
    if (isPlaying) {
      showTimeRow();
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
      // Wait for unlock to complete
      await unlockPromise;

      // First play generates the artifact (deterministically from MIDI structure).
      if (!isGenerated) {
        // Match main page "Generate & Play": procedural role-mapping → existing SynthesisEngine.
        await motifEngine.generateFromMIDI(events, 'procedural');
        motifEngine.setVolume(1);
        durationSec = motifEngine.getDuration();
        durationEl.textContent = formatTime(durationSec);
        progressContainer.style.display = 'block';
        isGenerated = true;
        // If user scrubbed before play, carry that into seconds now that we know duration.
        playOffsetSec = resumeProgress * durationSec;
        showTimeRow();
      }

      setUiPlaying(true);
      motifEngine.setVolume(1);
      await motifEngine.play();
      // Seek to remembered position (for pause/resume and scrub-before-play)
      if (durationSec > 0 && playOffsetSec > 0) {
        resumeProgress = playOffsetSec / durationSec;
      }
      if (resumeProgress > 0) motifEngine.seek(resumeProgress);
      // Local progress tracking
      playStartMs = performance.now() - playOffsetSec * 1000;
      startProgressUpdates();
      showTimeRow();
    } catch (e) {
      setUiPlaying(false);
      playStartMs = null;
      stopProgressUpdates();
    }
  });
}

void main();


