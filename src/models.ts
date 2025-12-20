import { MIDIService } from './services/MIDIService';
import { MIDIParser } from './midi/MIDIParser';
import { SoundfontMIDIPlayer } from './synthesis/SoundfontMIDIPlayer';
import { getAudioContext, isAudioReady, unlockAudio } from './utils/audioUnlock';
import { MIDIProcessor } from './midi/MIDIProcessor';
import { RoleMapper } from './core/RoleMapper';
import { TestModelSynthesisEngine } from './synthesis/TestModelSynthesisEngine';
import type { NoteEvent } from './types';

type SynthModel = 'pre8bit' | 'nes_gb' | 'snes_ish';

class ModelsApp {
  private midiService: MIDIService;
  private midiProcessor: MIDIProcessor;
  private roleMapper: RoleMapper;
  private testEngine: TestModelSynthesisEngine | null = null;

  private soundfontPlayer: SoundfontMIDIPlayer | null = null;

  private searchBtn!: HTMLButtonElement;
  private songInput!: HTMLInputElement;
  private status!: HTMLElement;

  private resultsSection!: HTMLElement;
  private resultsBody!: HTMLElement;
  private playerSection!: HTMLElement;

  private selectedTitle!: HTMLElement;
  private selectedMeta!: HTMLElement;

  private soundfontPlayBtn!: HTMLButtonElement;
  private soundfontStopBtn!: HTMLButtonElement;
  private soundfontVolumeSlider!: HTMLInputElement;

  private motifBtn!: HTMLButtonElement;
  private motifStopBtn!: HTMLButtonElement;
  private motifVolumeSlider!: HTMLInputElement;

  private modelSelect!: HTMLSelectElement;
  private modelHint!: HTMLElement;

  private iosAudioBanner!: HTMLElement;
  private enableAudioBtn!: HTMLButtonElement;
  private iosAudioState!: HTMLElement;

  private nextResultBtn!: HTMLButtonElement;

  private searchResults: any[] = [];
  private selectedResultIndex = 0;
  private currentMIDI: { events: NoteEvent[]; metadata: any } | null = null;

  constructor() {
    this.midiService = new MIDIService();
    this.midiProcessor = new MIDIProcessor();
    this.roleMapper = new RoleMapper();
    this.initializeUI();
    this.setupEventListeners();
    this.syncModelHint();
  }

  private async ensureAudioReady(): Promise<SoundfontMIDIPlayer> {
    const audioContext = await unlockAudio();
    if (!this.soundfontPlayer) {
      this.soundfontPlayer = new SoundfontMIDIPlayer(audioContext);
    }
    return this.soundfontPlayer;
  }

  private initializeUI(): void {
    this.searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
    this.songInput = document.getElementById('songInput') as HTMLInputElement;
    this.status = document.getElementById('status')!;

    this.resultsSection = document.getElementById('resultsSection')!;
    this.resultsBody = document.getElementById('resultsBody')!;
    this.playerSection = document.getElementById('playerSection')!;

    this.selectedTitle = document.getElementById('selectedTitle')!;
    this.selectedMeta = document.getElementById('selectedMeta')!;

    this.soundfontPlayBtn = document.getElementById('soundfontPlayBtn') as HTMLButtonElement;
    this.soundfontStopBtn = document.getElementById('soundfontStopBtn') as HTMLButtonElement;
    this.soundfontVolumeSlider = document.getElementById('soundfontVolume') as HTMLInputElement;

    this.motifBtn = document.getElementById('motifBtn') as HTMLButtonElement;
    this.motifStopBtn = document.getElementById('motifStopBtn') as HTMLButtonElement;
    this.motifVolumeSlider = document.getElementById('motifVolume') as HTMLInputElement;

    this.modelSelect = document.getElementById('modelSelect') as HTMLSelectElement;
    this.modelHint = document.getElementById('modelHint')!;

    this.nextResultBtn = document.getElementById('nextResultBtn') as HTMLButtonElement;

    this.iosAudioBanner = document.getElementById('iosAudioBanner')!;
    this.enableAudioBtn = document.getElementById('enableAudioBtn') as HTMLButtonElement;
    this.iosAudioState = document.getElementById('iosAudioState')!;
  }

  private setupEventListeners(): void {
    this.searchBtn.addEventListener('click', () => void this.handleSearch());
    this.songInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') void this.handleSearch();
    });

    this.soundfontPlayBtn.addEventListener('click', () => void this.handleSoundfontPlay());
    this.soundfontStopBtn.addEventListener('click', () => this.handleSoundfontStop());
    this.soundfontVolumeSlider.addEventListener('input', (e) => {
      const volume = parseFloat((e.target as HTMLInputElement).value);
      this.soundfontPlayer?.setVolume(volume);
    });

    this.motifBtn.addEventListener('click', () => void this.handleMotif());
    this.motifStopBtn.addEventListener('click', () => this.handleMotifStop());
    this.motifVolumeSlider.addEventListener('input', (e) => {
      const volume = parseFloat((e.target as HTMLInputElement).value);
      this.testEngine?.setVolume(volume);
    });

    this.modelSelect.addEventListener('change', () => this.syncModelHint());

    this.nextResultBtn.addEventListener('click', () => this.handleNextResult());

    const enable = () => void this.handleEnableAudio();
    this.enableAudioBtn.addEventListener('click', enable);
    this.enableAudioBtn.addEventListener('touchend', enable, { passive: true });
  }

  private getModel(): SynthModel {
    const v = (this.modelSelect.value || 'nes_gb') as SynthModel;
    if (v === 'pre8bit' || v === 'nes_gb' || v === 'snes_ish') return v;
    return 'nes_gb';
  }

  private syncModelHint(): void {
    const model = this.getModel();
    const hint =
      model === 'pre8bit'
        ? 'Ultra-sparse: mostly square/triangle, short gates, minimal polyphony.'
        : model === 'snes_ish'
          ? 'Warmer: gentler filter + echo. More voices, smoother release.'
          : 'Chip: square/triangle/saw flavor, tight envelope, crisp attacks.';

    this.modelHint.textContent = hint;
  }

  private isIOSLike(): boolean {
    const ua = navigator.userAgent || '';
    const iOS = /iPad|iPhone|iPod/.test(ua);
    const iPadOS13Plus = /Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1;
    return iOS || iPadOS13Plus;
  }

  private updateIOSAudioBanner(): void {
    if (!this.isIOSLike()) {
      this.iosAudioBanner.style.display = 'none';
      return;
    }

    const ready = isAudioReady();
    this.iosAudioBanner.style.display = ready ? 'none' : 'block';

    const ctx = (() => {
      try { return getAudioContext(); } catch { return null; }
    })();
    if (!ready && ctx) {
      this.iosAudioState.style.display = 'block';
      this.iosAudioState.textContent = `Audio: ${ctx.state} @ ${ctx.sampleRate}Hz`;
    } else {
      this.iosAudioState.style.display = 'none';
      this.iosAudioState.textContent = '';
    }
  }

  private async handleEnableAudio(): Promise<void> {
    try {
      this.enableAudioBtn.disabled = true;
      this.iosAudioState.style.display = 'block';
      this.iosAudioState.textContent = 'Audio: enabling…';

      await unlockAudio();

      const ctx = getAudioContext();
      if (ctx.state !== 'running') {
        this.enableAudioBtn.disabled = false;
        this.iosAudioState.textContent = 'Audio still locked. Tap Enable Audio again.';
        return;
      }

      this.iosAudioState.textContent = `Audio: running @ ${ctx.sampleRate}Hz`;
      window.setTimeout(() => this.updateIOSAudioBanner(), 250);
    } catch {
      this.enableAudioBtn.disabled = false;
      this.iosAudioState.style.display = 'block';
      this.iosAudioState.textContent = 'Audio enable failed. Tap again, or disable Silent Mode.';
    } finally {
      this.enableAudioBtn.disabled = false;
    }
  }

  private updateStatus(message: string): void {
    this.status.textContent = message;
  }

  private hideResults(): void {
    this.resultsSection.classList.remove('visible');
    this.playerSection.classList.remove('visible');
  }

  private enablePlayerControls(): void {
    this.soundfontPlayBtn.disabled = false;
    this.motifBtn.disabled = false;
    this.nextResultBtn.disabled = this.searchResults.length <= 1;
  }

  private disablePlayerControls(): void {
    this.soundfontPlayBtn.disabled = true;
    this.soundfontStopBtn.disabled = true;
    this.motifBtn.disabled = true;
    this.motifStopBtn.disabled = true;
    this.nextResultBtn.disabled = true;
  }

  private async handleSearch(): Promise<void> {
    const songName = this.songInput.value.trim();
    if (!songName) return;

    this.handleMotifStop();
    this.updateStatus('Searching for MIDI files...');
    this.searchBtn.disabled = true;
    this.hideResults();

    try {
      const results = await this.midiService.search(songName);
      if (results.length === 0) {
        this.updateStatus('No MIDI files found. Try a different search.');
        return;
      }

      this.searchResults = results;
      this.selectedResultIndex = 0;

      this.updateStatus('Analyzing MIDI files...');
      for (let i = 0; i < Math.min(results.length, 3); i++) {
        const metadata = await this.midiService.parseMIDI(results[i].midiUrl);
        if (metadata) results[i].parsed = metadata;
      }

      this.displayResults();
      this.updateStatus(`Found ${results.length} MIDI files. Select one to compare models.`);
      this.updateIOSAudioBanner();
    } catch (error) {
      this.updateStatus(`Search error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.searchBtn.disabled = false;
    }
  }

  private displayResults(): void {
    this.resultsBody.innerHTML = '';

    this.searchResults.forEach((result, index) => {
      const row = document.createElement('tr');
      if (index === this.selectedResultIndex) row.classList.add('selected');

      row.innerHTML = `
        <td>${result.title}</td>
        <td>${result.source}</td>
        <td>${result.parsed ? Math.round(result.parsed.durationSec) + 's' : '?'}</td>
      `;

      row.addEventListener('click', () => void this.selectResult(index));
      this.resultsBody.appendChild(row);
    });

    this.resultsSection.classList.add('visible');
    if (this.searchResults.length > 0) void this.selectResult(0);
  }

  public async selectResult(index: number): Promise<void> {
    if (index < 0 || index >= this.searchResults.length) return;

    this.handleMotifStop();

    this.selectedResultIndex = index;
    const result = this.searchResults[index];

    const rows = this.resultsBody.querySelectorAll('tr');
    rows.forEach((row, i) => row.classList.toggle('selected', i === index));

    this.updateStatus('Loading MIDI file...');
    this.disablePlayerControls();

    try {
      const midiBuffer = await this.midiService.fetchMIDI(result.midiUrl);
      if (!midiBuffer) throw new Error('Failed to fetch MIDI file');

      const events = MIDIParser.parseMIDI(midiBuffer);
      const metadata = result.parsed || MIDIParser.getMIDIInfo(midiBuffer);

      let actualDuration = metadata.duration || metadata.durationSec || 0;
      if (actualDuration === 0 && events.length > 0) {
        actualDuration = Math.max(...events.map(e => e.time + e.duration));
      }

      this.currentMIDI = { events, metadata: { ...metadata, duration: actualDuration } };

      const player = await this.ensureAudioReady();
      await player.load(events);

      this.selectedTitle.textContent = result.title;
      this.selectedMeta.innerHTML = `
        <strong>Source:</strong> ${result.source} |
        <strong>Duration:</strong> ${Math.round(actualDuration)}s |
        <strong>Tracks:</strong> ${metadata.trackCount} |
        <strong>Notes:</strong> ${events.length} |
        <strong>Tempo:</strong> ${metadata.tempo}bpm
      `;

      this.updateIOSAudioBanner();
      this.playerSection.classList.add('visible');
      this.enablePlayerControls();
      this.updateStatus('MIDI loaded. Preview, then switch models and generate.');
    } catch (error) {
      this.updateStatus(`Load error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleSoundfontPlay(): Promise<void> {
    if (!this.currentMIDI) return;
    try {
      const player = await this.ensureAudioReady();
      await player.play();
      this.soundfontPlayBtn.disabled = true;
      this.soundfontStopBtn.disabled = false;
      this.updateStatus('Previewing MIDI...');
    } catch (error) {
      this.updateStatus(`Preview error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    this.updateIOSAudioBanner();
  }

  private handleSoundfontStop(): void {
    this.soundfontPlayer?.stop();
    this.soundfontPlayBtn.disabled = false;
    this.soundfontStopBtn.disabled = true;
    this.updateStatus('Preview stopped.');
  }

  private async handleMotif(): Promise<void> {
    if (!this.currentMIDI) return;

    try {
      await unlockAudio();
      this.updateIOSAudioBanner();

      const model = this.getModel();
      this.updateStatus(`Generating Motif (${model})...`);
      this.motifBtn.disabled = true;

      // Ensure the previous model engine is stopped/cleared so each run is isolated.
      this.handleMotifStop();

      const audioContext = getAudioContext();
      const features = this.midiProcessor.extractFeatures(this.currentMIDI.events);
      const assignments = this.roleMapper.assignRoles(features, this.currentMIDI.events);

      this.testEngine = new TestModelSynthesisEngine(audioContext, model);
      this.testEngine.setupLayers(assignments);
      this.testEngine.setVolume(parseFloat(this.motifVolumeSlider.value));
      this.testEngine.start();

      this.motifStopBtn.disabled = false;
      this.updateStatus(`Playing Motif (${model})...`);
    } catch (error) {
      this.updateStatus(`Motif error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.motifBtn.disabled = false;
    }
  }

  private handleMotifStop(): void {
    this.testEngine?.stop();
    this.testEngine = null;
    this.motifBtn.disabled = false;
    this.motifStopBtn.disabled = true;
  }

  private handleNextResult(): void {
    const nextIndex = (this.selectedResultIndex + 1) % this.searchResults.length;
    void this.selectResult(nextIndex);
  }
}

const app = new ModelsApp();
(window as any).modelsApp = app;

