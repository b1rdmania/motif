import { MIDIService } from './services/MIDIService';
import { MIDIParser } from './midi/MIDIParser';
import { SoundfontMIDIPlayer } from './synthesis/SoundfontMIDIPlayer';
import { MotifEngine } from './core/MotifEngine';
import type { NoteEvent } from './types';

type SearchResult = {
  title: string;
  midiUrl: string;
  confidence: number;
};

function qs<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function getParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function setStatus(msg: string): void {
  qs<HTMLElement>('status').textContent = msg;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

async function main(): Promise<void> {
  const songInput = qs<HTMLInputElement>('songInput');
  const loadBtn = qs<HTMLButtonElement>('loadBtn');
  const nextBtn = qs<HTMLButtonElement>('nextBtn');

  const previewPlayBtn = qs<HTMLButtonElement>('previewPlayBtn');
  const previewStopBtn = qs<HTMLButtonElement>('previewStopBtn');
  const previewVol = qs<HTMLInputElement>('previewVol');

  const motifPlayBtn = qs<HTMLButtonElement>('motifPlayBtn');
  const motifStopBtn = qs<HTMLButtonElement>('motifStopBtn');
  const motifVol = qs<HTMLInputElement>('motifVol');

  const midiService = new MIDIService();
  const audioContext = new AudioContext();
  const previewPlayer = new SoundfontMIDIPlayer(audioContext);
  const motifEngine = new MotifEngine();

  let results: SearchResult[] = [];
  let selectedIndex = 0;
  let currentEvents: NoteEvent[] | null = null;
  let isMotifPlaying = false;

  function disableAll(): void {
    previewPlayBtn.disabled = true;
    previewStopBtn.disabled = true;
    motifPlayBtn.disabled = true;
    motifStopBtn.disabled = true;
    nextBtn.disabled = true;
  }

  function stopEverything(): void {
    previewPlayer.stop();
    motifEngine.stop();
    previewPlayBtn.disabled = currentEvents === null;
    previewStopBtn.disabled = true;
    motifStopBtn.disabled = true;
    isMotifPlaying = false;
  }

  async function loadIndex(index: number): Promise<void> {
    if (index < 0 || index >= results.length) return;
    selectedIndex = index;
    const r = results[selectedIndex];

    setStatus(`Loading: ${r.title}`);
    disableAll();

    try {
      const midiBuffer = await midiService.fetchMIDI(r.midiUrl);
      if (!midiBuffer) throw new Error('Fetch failed');

      const events = MIDIParser.parseMIDI(midiBuffer);
      currentEvents = events;

      await previewPlayer.load(events);
      previewPlayer.setVolume(clamp01(parseFloat(previewVol.value)));

      setStatus(`Ready: ${r.title}`);
      previewPlayBtn.disabled = false;
      motifPlayBtn.disabled = false;
      nextBtn.disabled = results.length <= 1;
    } catch (e) {
      currentEvents = null;
      setStatus(`Load error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  async function doSearch(): Promise<void> {
    const query = songInput.value.trim();
    if (!query) return;

    stopEverything();
    disableAll();
    setStatus('Searching…');
    loadBtn.disabled = true;

    try {
      const r = await midiService.search(query);
      results = r.map((x: any) => ({
        title: x.title,
        midiUrl: x.midiUrl,
        confidence: x.confidence,
      }));

      if (results.length === 0) {
        setStatus('No results found.');
        return;
      }

      // Pick best by confidence (backend already sorts, but keep safe)
      results.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      selectedIndex = 0;
      setStatus(`Found ${results.length}. Loading best match…`);
      await loadIndex(0);
    } catch (e) {
      setStatus(`Search error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      loadBtn.disabled = false;
    }
  }

  loadBtn.addEventListener('click', () => void doSearch());
  songInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void doSearch();
  });

  nextBtn.addEventListener('click', () => {
    if (results.length <= 1) return;
    const next = (selectedIndex + 1) % results.length;
    void loadIndex(next);
  });

  previewVol.addEventListener('input', (e) => {
    const v = clamp01(parseFloat((e.target as HTMLInputElement).value));
    previewPlayer.setVolume(v);
  });

  motifVol.addEventListener('input', (e) => {
    const v = clamp01(parseFloat((e.target as HTMLInputElement).value));
    motifEngine.setVolume(v);
  });

  previewPlayBtn.addEventListener('click', async () => {
    if (!currentEvents) return;
    try {
      motifEngine.stop();
      isMotifPlaying = false;
      await previewPlayer.play();
      previewPlayBtn.disabled = true;
      previewStopBtn.disabled = false;
      motifStopBtn.disabled = true;
      setStatus('Playing preview…');
    } catch (e) {
      setStatus(`Preview error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  });

  previewStopBtn.addEventListener('click', () => {
    previewPlayer.stop();
    previewPlayBtn.disabled = currentEvents === null;
    previewStopBtn.disabled = true;
    setStatus('Preview stopped.');
  });

  motifPlayBtn.addEventListener('click', async () => {
    if (!currentEvents) return;
    try {
      // Stop preview and generate variation
      previewPlayer.stop();
      previewPlayBtn.disabled = false;
      previewStopBtn.disabled = true;

      motifPlayBtn.disabled = true;
      setStatus('Generating variation…');

      await motifEngine.generateFromMIDI(currentEvents, 'procedural');
      motifEngine.setVolume(clamp01(parseFloat(motifVol.value)));
      await motifEngine.play();

      isMotifPlaying = true;
      motifStopBtn.disabled = false;
      setStatus('Playing variation…');
    } catch (e) {
      motifPlayBtn.disabled = false;
      setStatus(`Motif error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  });

  motifStopBtn.addEventListener('click', () => {
    motifEngine.stop();
    isMotifPlaying = false;
    motifStopBtn.disabled = true;
    motifPlayBtn.disabled = currentEvents === null;
    setStatus('Variation stopped.');
  });

  // Initialize from query params
  const song = getParam('song');
  const volume = getParam('volume');
  const motifVolume = getParam('motifVolume');

  if (volume) {
    previewVol.value = String(clamp01(parseFloat(volume)));
    previewPlayer.setVolume(parseFloat(previewVol.value));
  }
  if (motifVolume) {
    motifVol.value = String(clamp01(parseFloat(motifVolume)));
  }

  if (song) {
    songInput.value = song;
    setStatus('Loading from URL…');
    // best-effort: do not autoplay audio, just load the MIDI
    void doSearch();
  } else {
    setStatus('Ready. Add ?song=Hotel%20California to auto-load.');
  }

  // Defensive: stop audio when the iframe/tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopEverything();
      if (isMotifPlaying) {
        motifPlayBtn.disabled = currentEvents === null;
      }
    }
  });
}

void main();

