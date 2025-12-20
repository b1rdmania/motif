import { MIDIService } from './services/MIDIService';
import { MIDIParser } from './midi/MIDIParser';
import { SoundfontMIDIPlayer } from './synthesis/SoundfontMIDIPlayer';
import { getAudioContext, unlockAudio } from './utils/audioUnlock';
import { MIDIProcessor } from './midi/MIDIProcessor';
import { RoleMapper } from './core/RoleMapper';
import { TestModelSynthesisEngine, type SynthModel } from './synthesis/TestModelSynthesisEngine';
import type { NoteEvent } from './types';

class ModelsApp {
  private midiService = new MIDIService();
  private midiProcessor = new MIDIProcessor();
  private roleMapper = new RoleMapper();

  private soundfontPlayer: SoundfontMIDIPlayer | null = null;
  private testEngine: TestModelSynthesisEngine | null = null;

  private songInput!: HTMLInputElement;
  private searchBtn!: HTMLButtonElement;
  private status!: HTMLElement;

  private resultsCard!: HTMLElement;
  private resultsBody!: HTMLElement;

  private playerCard!: HTMLElement;
  private selectedTitle!: HTMLElement;
  private selectedMeta!: HTMLElement;

  private previewPlayBtn!: HTMLButtonElement;
  private previewStopBtn!: HTMLButtonElement;
  private previewVol!: HTMLInputElement;
  private nextResultBtn!: HTMLButtonElement;

  private motifPlayBtn!: HTMLButtonElement;
  private motifStopBtn!: HTMLButtonElement;
  private motifVol!: HTMLInputElement;

  private modelHint!: HTMLElement;
  private modelButtons: HTMLButtonElement[] = [];
  private currentModel: SynthModel = 'nes_gb';

  private searchResults: any[] = [];
  private selectedResultIndex = 0;
  private currentMIDI: { events: NoteEvent[]; metadata: any } | null = null;

  constructor() {
    this.bindUI();
    this.bindEvents();
    this.setModel('nes_gb');
    this.updateStatus('Ready.');
  }

  private bindUI(): void {
    this.songInput = document.getElementById('songInput') as HTMLInputElement;
    this.searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
    this.status = document.getElementById('status')!;

    this.resultsCard = document.getElementById('resultsCard')!;
    this.resultsBody = document.getElementById('resultsBody')!;

    this.playerCard = document.getElementById('playerCard')!;
    this.selectedTitle = document.getElementById('selectedTitle')!;
    this.selectedMeta = document.getElementById('selectedMeta')!;

    this.previewPlayBtn = document.getElementById('previewPlayBtn') as HTMLButtonElement;
    this.previewStopBtn = document.getElementById('previewStopBtn') as HTMLButtonElement;
    this.previewVol = document.getElementById('previewVol') as HTMLInputElement;
    this.nextResultBtn = document.getElementById('nextResultBtn') as HTMLButtonElement;

    this.motifPlayBtn = document.getElementById('motifPlayBtn') as HTMLButtonElement;
    this.motifStopBtn = document.getElementById('motifStopBtn') as HTMLButtonElement;
    this.motifVol = document.getElementById('motifVol') as HTMLInputElement;

    this.modelHint = document.getElementById('modelHint')!;
    this.modelButtons = [
      document.getElementById('modelPre8') as HTMLButtonElement,
      document.getElementById('modelNesGb') as HTMLButtonElement,
      document.getElementById('modelSnes') as HTMLButtonElement,
    ];
  }

  private bindEvents(): void {
    this.searchBtn.addEventListener('click', () => void this.handleSearch());
    this.songInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.handleSearch();
    });

    this.previewPlayBtn.addEventListener('click', () => void this.handlePreviewPlay());
    this.previewStopBtn.addEventListener('click', () => this.handlePreviewStop());
    this.previewVol.addEventListener('input', () => this.soundfontPlayer?.setVolume(parseFloat(this.previewVol.value)));
    this.nextResultBtn.addEventListener('click', () => void this.selectResult((this.selectedResultIndex + 1) % this.searchResults.length));

    for (const btn of this.modelButtons) {
      btn.addEventListener('click', () => this.setModel((btn.dataset.model as SynthModel) || 'nes_gb'));
    }

    this.motifPlayBtn.addEventListener('click', () => void this.handleMotifGeneratePlay());
    this.motifStopBtn.addEventListener('click', () => this.handleMotifStop());
    this.motifVol.addEventListener('input', () => this.testEngine?.setVolume(parseFloat(this.motifVol.value)));
  }

  private updateStatus(message: string): void {
    this.status.textContent = message;
  }

  private setModel(model: SynthModel): void {
    this.currentModel = model;
    for (const btn of this.modelButtons) {
      btn.setAttribute('aria-pressed', btn.dataset.model === model ? 'true' : 'false');
    }

    const hint =
      model === 'pre8bit'
        ? 'Pre‑8bit: very limited voices, hard gates, square/triangle + noise feel.'
        : model === 'snes'
          ? 'SNES: sample-voice feel, 8 voices, ADSR, echo/reverb + downsample vibe.'
          : 'NES/GB: classic chip oscillators (square/triangle/saw), tighter envelopes.';

    this.modelHint.textContent = hint;
  }

  private async ensureAudioReady(): Promise<SoundfontMIDIPlayer> {
    const ctx = await unlockAudio();
    if (!this.soundfontPlayer) this.soundfontPlayer = new SoundfontMIDIPlayer(ctx);
    return this.soundfontPlayer;
  }

  private async handleSearch(): Promise<void> {
    const q = this.songInput.value.trim();
    if (!q) return;

    this.handleMotifStop();
    this.handlePreviewStop();

    this.updateStatus('Searching…');
    this.searchBtn.disabled = true;
    this.resultsCard.style.display = 'none';
    this.playerCard.style.display = 'none';

    try {
      const results = await this.midiService.search(q);
      if (!results.length) {
        this.updateStatus('No MIDI found. Try another query.');
        return;
      }

      for (let i = 0; i < Math.min(3, results.length); i++) {
        const meta = await this.midiService.parseMIDI(results[i].midiUrl);
        if (meta) results[i].parsed = meta;
      }

      this.searchResults = results;
      this.selectedResultIndex = 0;
      this.renderResults();
      this.resultsCard.style.display = 'block';
      this.updateStatus(`Found ${results.length}. Select one to compare models.`);
    } catch (e) {
      this.updateStatus(`Search error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      this.searchBtn.disabled = false;
    }
  }

  private renderResults(): void {
    this.resultsBody.innerHTML = '';
    this.searchResults.forEach((r, idx) => {
      const tr = document.createElement('tr');
      if (idx === this.selectedResultIndex) tr.classList.add('selected');
      tr.innerHTML = `<td>${r.title}</td><td>${r.source}</td><td>${r.parsed ? Math.round(r.parsed.durationSec) + 's' : '?'}</td>`;
      tr.addEventListener('click', () => void this.selectResult(idx));
      this.resultsBody.appendChild(tr);
    });
    void this.selectResult(0);
  }

  private async selectResult(index: number): Promise<void> {
    if (index < 0 || index >= this.searchResults.length) return;
    this.handleMotifStop();
    this.handlePreviewStop();

    this.selectedResultIndex = index;
    const rows = this.resultsBody.querySelectorAll('tr');
    rows.forEach((row, i) => row.classList.toggle('selected', i === index));

    const result = this.searchResults[index];
    this.updateStatus('Loading MIDI…');
    this.disablePlayback();

    try {
      const buf = await this.midiService.fetchMIDI(result.midiUrl);
      if (!buf) throw new Error('Failed to fetch MIDI');

      const events = MIDIParser.parseMIDI(buf);
      const metadata = result.parsed || MIDIParser.getMIDIInfo(buf);
      const duration = metadata.duration || metadata.durationSec || (events.length ? Math.max(...events.map(e => e.time + e.duration)) : 0);

      this.currentMIDI = { events, metadata: { ...metadata, duration } };

      const player = await this.ensureAudioReady();
      await player.load(events);
      player.setVolume(parseFloat(this.previewVol.value));

      this.selectedTitle.textContent = result.title;
      this.selectedMeta.innerHTML =
        `<strong>Source:</strong> ${result.source} | <strong>Duration:</strong> ${Math.round(duration)}s | ` +
        `<strong>Tracks:</strong> ${metadata.trackCount} | <strong>Notes:</strong> ${events.length} | <strong>Tempo:</strong> ${metadata.tempo}bpm`;

      this.playerCard.style.display = 'block';
      this.enablePlayback();
      this.updateStatus('Ready. Preview or generate with a chosen model.');
    } catch (e) {
      this.updateStatus(`Load error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  private disablePlayback(): void {
    this.previewPlayBtn.disabled = true;
    this.previewStopBtn.disabled = true;
    this.nextResultBtn.disabled = true;
    this.motifPlayBtn.disabled = true;
    this.motifStopBtn.disabled = true;
  }

  private enablePlayback(): void {
    this.previewPlayBtn.disabled = false;
    this.nextResultBtn.disabled = this.searchResults.length <= 1;
    this.motifPlayBtn.disabled = false;
  }

  private async handlePreviewPlay(): Promise<void> {
    if (!this.currentMIDI) return;
    try {
      const player = await this.ensureAudioReady();
      await player.play();
      this.previewPlayBtn.disabled = true;
      this.previewStopBtn.disabled = false;
      this.updateStatus('Preview playing…');
    } catch (e) {
      this.updateStatus(`Preview error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  private handlePreviewStop(): void {
    this.soundfontPlayer?.stop();
    this.previewPlayBtn.disabled = false;
    this.previewStopBtn.disabled = true;
  }

  private async handleMotifGeneratePlay(): Promise<void> {
    if (!this.currentMIDI) return;
    try {
      await unlockAudio();
      this.handleMotifStop(); // isolate each run

      const ctx = getAudioContext();
      const features = this.midiProcessor.extractFeatures(this.currentMIDI.events);
      const assignments = this.roleMapper.assignRoles(features, this.currentMIDI.events);

      this.testEngine = new TestModelSynthesisEngine(ctx, this.currentModel);
      this.testEngine.setupLayers(assignments);
      this.testEngine.setVolume(parseFloat(this.motifVol.value));
      this.testEngine.start();

      this.motifPlayBtn.disabled = true;
      this.motifStopBtn.disabled = false;
      this.updateStatus(`Motif playing (${this.currentModel})…`);
    } catch (e) {
      this.updateStatus(`Motif error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      this.motifPlayBtn.disabled = false;
    }
  }

  private handleMotifStop(): void {
    this.testEngine?.stop();
    this.testEngine = null;
    this.motifPlayBtn.disabled = false;
    this.motifStopBtn.disabled = true;
  }
}

new ModelsApp();

