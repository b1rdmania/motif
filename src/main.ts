import { MotifEngine } from './core/MotifEngine';

class MotifApp {
  private engine: MotifEngine;
  private generateBtn: HTMLButtonElement;
  private playBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private songInput: HTMLInputElement;
  private status: HTMLElement;

  constructor() {
    this.engine = new MotifEngine();
    this.initializeUI();
    this.setupEventListeners();
  }

  private initializeUI(): void {
    this.generateBtn = document.getElementById('generateBtn') as HTMLButtonElement;
    this.playBtn = document.getElementById('playBtn') as HTMLButtonElement;
    this.stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
    this.songInput = document.getElementById('songInput') as HTMLInputElement;
    this.status = document.getElementById('status')!;
  }

  private setupEventListeners(): void {
    this.generateBtn.addEventListener('click', () => this.handleGenerate());
    this.playBtn.addEventListener('click', () => this.handlePlay());
    this.stopBtn.addEventListener('click', () => this.handleStop());
    
    this.songInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleGenerate();
      }
    });
  }

  private async handleGenerate(): Promise<void> {
    const songName = this.songInput.value.trim();
    if (!songName) return;

    this.updateStatus('Generating structure...');
    this.generateBtn.disabled = true;

    try {
      await this.engine.generateFromSong(songName);
      this.updateStatus(`Generated: ${songName} - Ready to play`);
      this.playBtn.disabled = false;
    } catch (error) {
      this.updateStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.generateBtn.disabled = false;
    }
  }

  private async handlePlay(): Promise<void> {
    try {
      await this.engine.play();
      this.updateStatus('Playing...');
      this.playBtn.disabled = true;
      this.stopBtn.disabled = false;
    } catch (error) {
      this.updateStatus(`Playback error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private handleStop(): void {
    this.engine.stop();
    this.updateStatus('Stopped');
    this.playBtn.disabled = false;
    this.stopBtn.disabled = true;
  }

  private updateStatus(message: string): void {
    this.status.textContent = message;
  }
}

new MotifApp();