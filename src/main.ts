import { MotifEngine } from './core/MotifEngine';
import { MIDIService } from './services/MIDIService';
import { MIDIParser } from './midi/MIDIParser';
import { EnhancedMIDIPlayer } from './synthesis/EnhancedMIDIPlayer';
import { SoundfontMIDIPlayer } from './synthesis/SoundfontMIDIPlayer';
import { ToneJSMIDIPlayer } from './synthesis/ToneJSMIDIPlayer';
import type { NoteEvent } from './types';

class MotifApp {
  private motifEngine: MotifEngine;
  private midiService: MIDIService;
  private audioContext: AudioContext;

  // Multiple player instances
  private toneJSPlayer: ToneJSMIDIPlayer;
  private soundfontPlayer: SoundfontMIDIPlayer;
  private customPlayer: EnhancedMIDIPlayer;
  
  private searchBtn!: HTMLButtonElement;
  private songInput!: HTMLInputElement;
  private status!: HTMLElement;
  
  private resultsSection!: HTMLElement;
  private resultsBody!: HTMLElement;
  private playerSection!: HTMLElement;
  
  private selectedTitle!: HTMLElement;
  private selectedMeta!: HTMLElement;
  
  // Tone.js player controls
  private tonejsPlayBtn!: HTMLButtonElement;
  private tonejsStopBtn!: HTMLButtonElement;
  private tonejsVolumeSlider!: HTMLInputElement;

  // Soundfont player controls
  private soundfontPlayBtn!: HTMLButtonElement;
  private soundfontStopBtn!: HTMLButtonElement;
  private soundfontVolumeSlider!: HTMLInputElement;

  // Custom player controls
  private customPlayBtn!: HTMLButtonElement;
  private customStopBtn!: HTMLButtonElement;
  private customVolumeSlider!: HTMLInputElement;

  // Motif controls
  private motifBtn!: HTMLButtonElement;
  private motifStopBtn!: HTMLButtonElement;
  private motifVolumeSlider!: HTMLInputElement;

  private nextResultBtn!: HTMLButtonElement;
  
  private searchResults: any[] = [];
  private selectedResultIndex = 0;
  private currentMIDI: { events: NoteEvent[], metadata: any } | null = null;

  constructor() {
    // Create AudioContext lazily on first use for iOS compatibility
    this.audioContext = new AudioContext();
    this.motifEngine = new MotifEngine();
    this.midiService = new MIDIService();

    // Initialize all players
    this.toneJSPlayer = new ToneJSMIDIPlayer();
    this.soundfontPlayer = new SoundfontMIDIPlayer(this.audioContext);
    this.customPlayer = new EnhancedMIDIPlayer(this.audioContext);

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
    
    // Tone.js controls
    this.tonejsPlayBtn = document.getElementById('tonejsPlayBtn') as HTMLButtonElement;
    this.tonejsStopBtn = document.getElementById('tonejsStopBtn') as HTMLButtonElement;
    this.tonejsVolumeSlider = document.getElementById('tonejsVolume') as HTMLInputElement;

    // Soundfont controls
    this.soundfontPlayBtn = document.getElementById('soundfontPlayBtn') as HTMLButtonElement;
    this.soundfontStopBtn = document.getElementById('soundfontStopBtn') as HTMLButtonElement;
    this.soundfontVolumeSlider = document.getElementById('soundfontVolume') as HTMLInputElement;

    // Custom controls
    this.customPlayBtn = document.getElementById('customPlayBtn') as HTMLButtonElement;
    this.customStopBtn = document.getElementById('customStopBtn') as HTMLButtonElement;
    this.customVolumeSlider = document.getElementById('customVolume') as HTMLInputElement;

    // Motif controls
    this.motifBtn = document.getElementById('motifBtn') as HTMLButtonElement;
    this.motifStopBtn = document.getElementById('motifStopBtn') as HTMLButtonElement;
    this.motifVolumeSlider = document.getElementById('motifVolume') as HTMLInputElement;

    this.nextResultBtn = document.getElementById('nextResultBtn') as HTMLButtonElement;
  }

  private setupEventListeners(): void {
    this.searchBtn.addEventListener('click', () => this.handleSearch());
    
    this.songInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleSearch();
      }
    });
    
    // Tone.js player
    this.tonejsPlayBtn.addEventListener('click', () => this.handleTonejsPlay());
    this.tonejsStopBtn.addEventListener('click', () => this.handleTonejsStop());
    this.tonejsVolumeSlider.addEventListener('input', (e) => {
      const volume = parseFloat((e.target as HTMLInputElement).value);
      this.toneJSPlayer.setVolume(volume);
    });

    // Soundfont player
    this.soundfontPlayBtn.addEventListener('click', () => this.handleSoundfontPlay());
    this.soundfontStopBtn.addEventListener('click', () => this.handleSoundfontStop());
    this.soundfontVolumeSlider.addEventListener('input', (e) => {
      const volume = parseFloat((e.target as HTMLInputElement).value);
      this.soundfontPlayer.setVolume(volume);
    });

    // Custom player
    this.customPlayBtn.addEventListener('click', () => this.handleCustomPlay());
    this.customStopBtn.addEventListener('click', () => this.handleCustomStop());
    this.customVolumeSlider.addEventListener('input', (e) => {
      const volume = parseFloat((e.target as HTMLInputElement).value);
      this.customPlayer.setVolume(volume);
    });

    // Motif
    this.motifBtn.addEventListener('click', () => this.handleMotif());
    this.motifStopBtn.addEventListener('click', () => this.handleMotifStop());
    this.motifVolumeSlider.addEventListener('input', (e) => {
      const volume = parseFloat((e.target as HTMLInputElement).value);
      this.motifEngine.setVolume(volume);
    });

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

      // Load into all players
      await Promise.all([
        this.toneJSPlayer.load(events),
        this.soundfontPlayer.load(events),
        this.customPlayer.load(events)
      ]);
      
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

  // Tone.js player handlers
  private async handleTonejsPlay(): Promise<void> {
    if (!this.currentMIDI) return;
    try {
      await this.toneJSPlayer.play();
      this.tonejsPlayBtn.disabled = true;
      this.tonejsStopBtn.disabled = false;
      this.updateStatus('Playing Tone.js piano...');
    } catch (error) {
      this.updateStatus(`Tone.js error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private handleTonejsStop(): void {
    console.log('Tone.js stop button clicked');
    this.toneJSPlayer.stop();
    this.tonejsPlayBtn.disabled = false;
    this.tonejsStopBtn.disabled = true;
    this.updateStatus('Tone.js stopped.');
  }

  // Soundfont player handlers
  private async handleSoundfontPlay(): Promise<void> {
    if (!this.currentMIDI) return;
    try {
      await this.soundfontPlayer.play();
      this.soundfontPlayBtn.disabled = true;
      this.soundfontStopBtn.disabled = false;
      this.updateStatus('Playing Soundfont piano...');
    } catch (error) {
      this.updateStatus(`Soundfont error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private handleSoundfontStop(): void {
    console.log('Soundfont stop button clicked');
    this.soundfontPlayer.stop();
    this.soundfontPlayBtn.disabled = false;
    this.soundfontStopBtn.disabled = true;
    this.updateStatus('Soundfont stopped.');
  }

  // Custom player handlers
  private async handleCustomPlay(): Promise<void> {
    if (!this.currentMIDI) return;
    try {
      await this.customPlayer.play();
      this.customPlayBtn.disabled = true;
      this.customStopBtn.disabled = false;
      this.updateStatus('Playing custom synthesis...');
    } catch (error) {
      this.updateStatus(`Custom player error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private handleCustomStop(): void {
    console.log('Custom stop button clicked');
    this.customPlayer.stop();
    this.customPlayBtn.disabled = false;
    this.customStopBtn.disabled = true;
    this.updateStatus('Custom synthesis stopped.');
  }

  // Motif handlers
  private async handleMotif(): Promise<void> {
    console.log('Motif Generate & Play button clicked');
    if (!this.currentMIDI) {
      console.error('No MIDI loaded');
      return;
    }

    try {
      this.updateStatus('Generating Motif synthesis...');
      this.motifBtn.disabled = true;

      console.log('Calling generateFromMIDI with', this.currentMIDI.events.length, 'events');
      // Use the current MIDI data directly in passthrough mode
      await this.motifEngine.generateFromMIDI(this.currentMIDI.events, 'passthrough');

      console.log('Calling motifEngine.play()');
      await this.motifEngine.play();

      this.motifStopBtn.disabled = false;
      this.updateStatus('Playing Motif synthesis...');
      console.log('Motif playback started successfully');
    } catch (error) {
      console.error('Motif error:', error);
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
    this.tonejsPlayBtn.disabled = false;
    this.soundfontPlayBtn.disabled = false;
    this.customPlayBtn.disabled = false;
    this.motifBtn.disabled = false;
    this.nextResultBtn.disabled = this.searchResults.length <= 1;
  }

  private disablePlayerControls(): void {
    this.tonejsPlayBtn.disabled = true;
    this.tonejsStopBtn.disabled = true;
    this.soundfontPlayBtn.disabled = true;
    this.soundfontStopBtn.disabled = true;
    this.customPlayBtn.disabled = true;
    this.customStopBtn.disabled = true;
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