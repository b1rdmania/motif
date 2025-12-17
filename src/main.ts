import { MotifEngine } from './core/MotifEngine';
import { MIDIService } from './services/MIDIService';
import { MIDIParser } from './midi/MIDIParser';
import { MIDIPlayer } from './synthesis/MIDIPlayer';
import type { NoteEvent } from './types';

class MotifApp {
  private motifEngine: MotifEngine;
  private midiService: MIDIService;
  private midiPlayer: MIDIPlayer;
  private audioContext: AudioContext;
  
  private searchBtn: HTMLButtonElement;
  private songInput: HTMLInputElement;
  private status: HTMLElement;
  
  private resultsSection: HTMLElement;
  private resultsBody: HTMLElement;
  private playerSection: HTMLElement;
  
  private selectedTitle: HTMLElement;
  private selectedMeta: HTMLElement;
  
  private previewBtn: HTMLButtonElement;
  private previewStopBtn: HTMLButtonElement;
  private motifBtn: HTMLButtonElement;
  private motifStopBtn: HTMLButtonElement;
  private nextResultBtn: HTMLButtonElement;
  
  private searchResults: any[] = [];
  private selectedResultIndex = 0;
  private currentMIDI: { events: NoteEvent[], metadata: any } | null = null;

  constructor() {
    this.audioContext = new AudioContext();
    this.motifEngine = new MotifEngine();
    this.midiService = new MIDIService();
    this.midiPlayer = new MIDIPlayer(this.audioContext);
    
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

  async selectResult(index: number): Promise<void> {
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

      this.currentMIDI = { events, metadata };
      
      // Load into players
      this.midiPlayer.load(events);
      
      // Update UI
      this.selectedTitle.textContent = result.title;
      this.selectedMeta.innerHTML = `
        <strong>Source:</strong> ${result.source} | 
        <strong>Duration:</strong> ${Math.round(metadata.duration || 0)}s | 
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
      await this.midiPlayer.play();
      this.previewBtn.disabled = true;
      this.previewStopBtn.disabled = false;
      this.updateStatus('Playing MIDI preview...');
    } catch (error) {
      this.updateStatus(`Preview error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private handlePreviewStop(): void {
    this.midiPlayer.stop();
    this.previewBtn.disabled = false;
    this.previewStopBtn.disabled = true;
    this.updateStatus('Preview stopped.');
  }

  private async handleMotif(): Promise<void> {
    if (!this.currentMIDI) return;

    const result = this.searchResults[this.selectedResultIndex];
    
    try {
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