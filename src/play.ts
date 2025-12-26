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

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

async function main(): Promise<void> {
  const titleEl = qs('title');
  const statusEl = qs('status');
  const playBtn = qs('playBtn') as HTMLButtonElement;
  const stopBtn = qs('stopBtn') as HTMLButtonElement;
  const volumeEl = qs('volume') as HTMLInputElement;
  const generateOwn = qs('generateOwn') as HTMLAnchorElement;
  const shareHint = qs('shareHint');
  const progressContainer = qs('playProgressContainer') as HTMLElement;
  const progressBar = qs('playProgressBar') as HTMLInputElement;
  const progressFill = qs('playProgressFill') as HTMLElement;
  const currentTimeEl = qs('playCurrentTime') as HTMLElement;
  const durationEl = qs('playDuration') as HTMLElement;

  const { midiUrl: u, title } = buildMidiUrlFromParams();

  titleEl.textContent = title;
  shareHint.textContent = u ? 'Ready' : 'Missing MIDI URL';

  // Set CTA back to home, prefilling search if we have a title.
  generateOwn.href = title ? `/?song=${encodeURIComponent(title)}` : '/';

  if (!u) {
    statusEl.textContent = 'Missing link data (u=...).';
    playBtn.disabled = true;
    stopBtn.disabled = true;
    return;
  }

  const midiService = new MIDIService();
  const motifEngine = new MotifEngine();
  let events: NoteEvent[] | null = null;
  let isPlaying = false;
  let progressInterval: number | null = null;
  let durationSec = 0;

  statusEl.textContent = 'Loading MIDI…';
  try {
    const buf = await midiService.fetchMIDI(u);
    if (!buf) throw new Error('Failed to fetch MIDI');
    events = MIDIParser.parseMIDI(buf);
    statusEl.textContent = 'Ready. Tap Play.';
    playBtn.disabled = false;
  } catch (e) {
    statusEl.textContent = `Load error: ${e instanceof Error ? e.message : 'Unknown error'}`;
    playBtn.disabled = true;
    stopBtn.disabled = true;
    return;
  }

  function setUiPlaying(playing: boolean): void {
    isPlaying = playing;
    playBtn.disabled = playing;
    stopBtn.disabled = !playing;
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function updateProgress(): void {
    const progress = motifEngine.getProgress();
    const current = motifEngine.getCurrentTime();
    progressBar.value = (progress * 100).toString();
    progressFill.style.width = `${progress * 100}%`;
    currentTimeEl.textContent = formatTime(current);
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

  stopBtn.addEventListener('click', () => {
    motifEngine.stop();
    setUiPlaying(false);
    stopProgressUpdates();
    statusEl.textContent = 'Stopped.';
  });

  const seekHandler = (e: Event) => {
    const p = Number.parseFloat((e.target as HTMLInputElement).value) / 100;
    motifEngine.seek(p);
    updateProgress();
  };
  progressBar.addEventListener('input', seekHandler);
  progressBar.addEventListener('change', seekHandler);

  playBtn.addEventListener('click', async () => {
    if (!events || isPlaying) return;
    try {
      setUiPlaying(true);
      statusEl.textContent = 'Generating…';

      // Match main page "Generate & Play": procedural role-mapping → existing SynthesisEngine.
      await motifEngine.generateFromMIDI(events, 'procedural');
      motifEngine.setVolume(Number.parseFloat(volumeEl.value));
      durationSec = motifEngine.getDuration();
      durationEl.textContent = formatTime(durationSec);
      currentTimeEl.textContent = '0:00';
      progressBar.value = '0';
      progressFill.style.width = '0%';
      progressContainer.style.display = 'block';

      statusEl.textContent = 'Playing…';
      await motifEngine.play();
      startProgressUpdates();
    } catch (e) {
      setUiPlaying(false);
      stopProgressUpdates();
      statusEl.textContent = `Play error: ${e instanceof Error ? e.message : 'Unknown error'}`;
    }
  });

  // Small quality-of-life: let user click the header “Ready” to copy link.
  shareHint.addEventListener('click', async () => {
    try {
      await copyToClipboard(window.location.href);
      shareHint.textContent = 'Link copied';
      window.setTimeout(() => (shareHint.textContent = 'Ready'), 900);
    } catch {
      // ignore
    }
  });
  shareHint.style.cursor = 'pointer';
  shareHint.title = 'Click to copy link';
}

void main();

