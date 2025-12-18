import { MotifEngine } from './core/MotifEngine';
import { MIDIService } from './services/MIDIService';
import { MIDIParser } from './midi/MIDIParser';
import { EnhancedMIDIPlayer } from './synthesis/EnhancedMIDIPlayer';
import { SoundfontMIDIPlayer } from './synthesis/SoundfontMIDIPlayer';
import { ToneJSMIDIPlayer } from './synthesis/ToneJSMIDIPlayer';
import type { NoteEvent } from './types';

type MIDIPlayerType = 'tonejs' | 'soundfont' | 'custom';

interface MIDIPlayer {
  load(events: NoteEvent[]): void | Promise<void>;
  play(): void | Promise<void>;
  stop(): void;
  setVolume(volume: number): void;
  getDuration(): number;
  getProgress(): number;
}

class MotifApp {
  private motifEngine: MotifEngine;
  private midiService: MIDIService;
  private audioContext: AudioContext;

  // Multiple player instances
  private toneJSPlayer: ToneJSMIDIPlayer;
  private soundfontPlayer: SoundfontMIDIPlayer;
  private customPlayer: EnhancedMIDIPlayer;
  private currentPlayer: MIDIPlayer;
  private currentPlayerType: MIDIPlayerType = 'tonejs';
  
  private searchBtn!: HTMLButtonElement;
  private songInput!: HTMLInputElement;
  private status!: HTMLElement;
  
  private resultsSection!: HTMLElement;
  private resultsBody!: HTMLElement;
  private playerSection!: HTMLElement;
  
  private selectedTitle!: HTMLElement;
  private selectedMeta!: HTMLElement;
  
  private previewBtn!: HTMLButtonElement;
  private previewStopBtn!: HTMLButtonElement;
  private motifBtn!: HTMLButtonElement;
  private motifStopBtn!: HTMLButtonElement;
  private nextResultBtn!: HTMLButtonElement;

  private previewVolumeSlider!: HTMLInputElement;
  private motifVolumeSlider!: HTMLInputElement;
  private engineSelect!: HTMLSelectElement;
  
  private searchResults: any[] = [];
  private selectedResultIndex = 0;
  private currentMIDI: { events: NoteEvent[], metadata: any } | null = null;

  constructor() {
    this.audioContext = new AudioContext();
    this.motifEngine = new MotifEngine();
    this.midiService = new MIDIService();

    // Initialize all players
    this.toneJSPlayer = new ToneJSMIDIPlayer();
    this.soundfontPlayer = new SoundfontMIDIPlayer(this.audioContext);
    this.customPlayer = new EnhancedMIDIPlayer(this.audioContext);
    this.currentPlayer = this.toneJSPlayer; // Default to Tone.js

    this.initializeUI();
    this.setupEventListeners();
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
    
    this.previewBtn = document.getElementById('previewBtn') as HTMLButtonElement;
    this.previewStopBtn = document.getElementById('previewStopBtn') as HTMLButtonElement;
    this.motifBtn = document.getElementById('motifBtn') as HTMLButtonElement;
    this.motifStopBtn = document.getElementById('motifStopBtn') as HTMLButtonElement;
    this.nextResultBtn = document.getElementById('nextResultBtn') as HTMLButtonElement;

    this.previewVolumeSlider = document.getElementById('previewVolume') as HTMLInputElement;
    this.motifVolumeSlider = document.getElementById('motifVolume') as HTMLInputElement;
    this.engineSelect = document.getElementById('engineSelect') as HTMLSelectElement;
  }

  private setupEventListeners(): void {
    this.searchBtn.addEventListener('click', () => this.handleSearch());
    
    this.songInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleSearch();
      }
    });
    
    this.previewBtn.addEventListener('click', () => this.handlePreview());
    this.previewStopBtn.addEventListener('click', () => this.handlePreviewStop());
    this.motifBtn.addEventListener('click', () => this.handleMotif());
    this.motifStopBtn.addEventListener('click', () => this.handleMotifStop());
    this.nextResultBtn.addEventListener('click', () => this.handleNextResult());

    // Volume control event listeners
    this.previewVolumeSlider.addEventListener('input', (e) => {
      const volume = parseFloat((e.target as HTMLInputElement).value);
      this.currentPlayer.setVolume(volume);
    });

    this.motifVolumeSlider.addEventListener('input', (e) => {
      const volume = parseFloat((e.target as HTMLInputElement).value);
      this.motifEngine.setVolume(volume);
    });

    // Engine selector event listener
    this.engineSelect.addEventListener('change', (e) => {
      this.handleEngineChange((e.target as HTMLSelectElement).value as MIDIPlayerType);
    });
  }

  private async handleSearch(): Promise<void> {
    const songName = this.songInput.value.trim();
    if (!songName) return;

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

      // Parse metadata for results
      this.updateStatus('Analyzing MIDI files...');
      for (let i = 0; i < Math.min(results.length, 3); i++) {
        const metadata = await this.midiService.parseMIDI(results[i].midiUrl);
        if (metadata) {
          results[i].parsed = metadata;
        }
      }

      this.displayResults();
      this.updateStatus(`Found ${results.length} MIDI files. Select one to play.`);

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
      if (index === this.selectedResultIndex) {
        row.classList.add('selected');
      }
      
      row.innerHTML = `
        <td>${result.title}</td>
        <td>${result.source}</td>
        <td>
          <div class="confidence-bar">
            <div class="confidence-fill" style="width: ${result.confidence * 100}%"></div>
          </div>
        </td>
        <td>${result.parsed ? Math.round(result.parsed.durationSec) + 's' : '?'}</td>
        <td>${result.parsed ? result.parsed.tracks.length : '?'}</td>
        <td class="issues">${result.parsed?.issues.join(', ') || ''}</td>
        <td><button onclick="window.app.selectResult(${index})">Select</button></td>
      `;
      
      this.resultsBody.appendChild(row);
    });
    
    this.resultsSection.classList.add('visible');
    
    // Auto-select first result
    if (this.searchResults.length > 0) {
      this.selectResult(0);
    }
  }

  public async selectResult(index: number): Promise<void> {
    if (index < 0 || index >= this.searchResults.length) return;
    
    this.selectedResultIndex = index;
    const result = this.searchResults[index];
    
    // Update selection highlighting
    const rows = this.resultsBody.querySelectorAll('tr');
    rows.forEach((row, i) => {
      row.classList.toggle('selected', i === index);
    });
    
    this.updateStatus('Loading MIDI file...');
    this.disablePlayerControls();

    try {
      // Fetch and parse MIDI
      const midiBuffer = await this.midiService.fetchMIDI(result.midiUrl);
      if (!midiBuffer) {
        throw new Error('Failed to fetch MIDI file');
      }

      const events = MIDIParser.parseMIDI(midiBuffer);
      const metadata = result.parsed || MIDIParser.getMIDIInfo(midiBuffer);

      // Calculate duration from events if metadata duration is 0 or missing
      let actualDuration = metadata.duration || metadata.durationSec || 0;
      if (actualDuration === 0 && events.length > 0) {
        // Calculate duration from the last event
        actualDuration = Math.max(...events.map(e => e.time + e.duration));
      }

      this.currentMIDI = { events, metadata: { ...metadata, duration: actualDuration } };

      // Load into current player
      await this.currentPlayer.load(events);
      
      // Update UI
      this.selectedTitle.textContent = result.title;
      this.selectedMeta.innerHTML = `
        <strong>Source:</strong> ${result.source} |
        <strong>Duration:</strong> ${Math.round(actualDuration)}s |
        <strong>Tracks:</strong> ${metadata.trackCount} |
        <strong>Notes:</strong> ${events.length} |
        <strong>Tempo:</strong> ${metadata.tempo}bpm
      `;
      
      this.playerSection.classList.add('visible');
      this.enablePlayerControls();
      this.updateStatus('MIDI loaded. You can now preview or generate.');

    } catch (error) {
      this.updateStatus(`Load error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handlePreview(): Promise<void> {
    if (!this.currentMIDI) return;

    try {
      // Stop Motif if it's playing
      this.motifEngine.stop();
      this.motifBtn.disabled = false;
      this.motifStopBtn.disabled = true;

      await this.currentPlayer.play();
      this.previewBtn.disabled = true;
      this.previewStopBtn.disabled = false;
      this.updateStatus(`Playing original MIDI (${this.currentPlayerType})...`);
    } catch (error) {
      this.updateStatus(`Preview error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private handlePreviewStop(): void {
    this.currentPlayer.stop();
    this.previewBtn.disabled = false;
    this.previewStopBtn.disabled = true;
    this.updateStatus('Preview stopped.');
  }

  private async handleEngineChange(engineType: MIDIPlayerType): Promise<void> {
    // Stop current player
    this.currentPlayer.stop();

    // Switch to new player
    this.currentPlayerType = engineType;
    switch (engineType) {
      case 'tonejs':
        this.currentPlayer = this.toneJSPlayer;
        break;
      case 'soundfont':
        this.currentPlayer = this.soundfontPlayer;
        break;
      case 'custom':
        this.currentPlayer = this.customPlayer;
        break;
    }

    // Reload MIDI into new player if we have one loaded
    if (this.currentMIDI) {
      try {
        this.updateStatus(`Switching to ${engineType} engine...`);
        await this.currentPlayer.load(this.currentMIDI.events);

        // Apply current volume setting
        const volume = parseFloat(this.previewVolumeSlider.value);
        this.currentPlayer.setVolume(volume);

        this.updateStatus(`Switched to ${engineType} engine. Ready to play.`);
      } catch (error) {
        this.updateStatus(`Engine switch error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private async handleMotif(): Promise<void> {
    if (!this.currentMIDI) return;

    try {
      // Stop preview if it's playing
      this.currentPlayer.stop();
      this.previewBtn.disabled = false;
      this.previewStopBtn.disabled = true;

      this.updateStatus('Generating Motif synthesis...');
      this.motifBtn.disabled = true;

      // Use the current MIDI data directly
      await this.motifEngine.generateFromMIDI(this.currentMIDI.events);
      await this.motifEngine.play();

      this.motifStopBtn.disabled = false;
      this.updateStatus('Playing Motif synthesis...');
    } catch (error) {
      this.updateStatus(`Motif error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.motifBtn.disabled = false;
    }
  }

  private handleMotifStop(): void {
    this.motifEngine.stop();
    this.motifBtn.disabled = false;
    this.motifStopBtn.disabled = true;
    this.updateStatus('Motif synthesis stopped.');
  }

  private handleNextResult(): void {
    const nextIndex = (this.selectedResultIndex + 1) % this.searchResults.length;
    this.selectResult(nextIndex);
  }

  private hideResults(): void {
    this.resultsSection.classList.remove('visible');
    this.playerSection.classList.remove('visible');
  }

  private enablePlayerControls(): void {
    this.previewBtn.disabled = false;
    this.motifBtn.disabled = false;
    this.nextResultBtn.disabled = this.searchResults.length <= 1;
  }

  private disablePlayerControls(): void {
    this.previewBtn.disabled = true;
    this.previewStopBtn.disabled = true;
    this.motifBtn.disabled = true;
    this.motifStopBtn.disabled = true;
    this.nextResultBtn.disabled = true;
  }

  private updateStatus(message: string): void {
    this.status.textContent = message;
  }
}

// Make app globally available for onclick handlers
const app = new MotifApp();
(window as any).app = app;