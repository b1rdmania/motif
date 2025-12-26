import { MotifEngine } from './core/MotifEngine';
import { MIDIService } from './services/MIDIService';
import { MIDIParser } from './midi/MIDIParser';
import { SoundfontMIDIPlayer } from './synthesis/SoundfontMIDIPlayer';
import { getAudioContext, isAudioReady, peekAudioContext, unlockAudio } from './utils/audioUnlock';
import type { NoteEvent } from './types';

class MotifApp {
  private motifEngine: MotifEngine;
  private midiService: MIDIService;

  // Preview player (lazily created for iOS compatibility)
  private soundfontPlayer: SoundfontMIDIPlayer | null = null;
  private playingPreviewIndex: number | null = null;
  private previewStopTimeout: number | null = null;
  private previewButtons: HTMLButtonElement[] = [];
  
  private searchBtn!: HTMLButtonElement;
  private songInput!: HTMLInputElement;
  private status!: HTMLElement;
  
  private resultsSection!: HTMLElement;
  private resultsBody!: HTMLElement;
  private playerSection!: HTMLElement;
  
  private selectedTitle!: HTMLElement;
  private selectedMeta!: HTMLElement;
  private selectedDetails!: HTMLElement;

  // Preview player (no UI volume)

  // Motif controls
  private motifBtn!: HTMLButtonElement;
  private motifStopBtn!: HTMLButtonElement;
  private motifProgressContainer!: HTMLElement;
  private motifProgressBar!: HTMLInputElement;
  private motifProgressFill!: HTMLElement;
  private motifCurrentTime!: HTMLElement;
  private motifDuration!: HTMLElement;
  private motifProgressInterval: number | null = null;

  // iOS audio unlock UI (Motif only)
  private iosAudioBanner!: HTMLElement;
  private enableAudioBtn!: HTMLButtonElement;
  private iosAudioState!: HTMLElement;

  private copyLinkBtn!: HTMLButtonElement;

  // Embed snippet UI
  private embedSection: HTMLElement | null = null;
  private embedCodeEl: HTMLElement | null = null;
  private copyEmbedBtn: HTMLButtonElement | null = null;
  private copyToast: HTMLElement | null = null;

  // FAQ modal
  private faqBtn!: HTMLButtonElement;
  private faqBackdrop!: HTMLElement;
  private faqCloseBtn!: HTMLButtonElement;

  private searchResults: any[] = [];
  private selectedResultIndex = 0;
  private currentMIDI: { events: NoteEvent[], metadata: any } | null = null;

  constructor() {
    this.motifEngine = new MotifEngine();
    this.midiService = new MIDIService();
    // soundfontPlayer created lazily on first play for iOS compatibility

    this.initializeUI();
    this.setupEventListeners();

    // Always play at 100%
    this.motifEngine.setVolume(1);
  }

  /**
   * Ensure audio is unlocked and soundfontPlayer is ready.
   * Must be called from a user gesture context.
   */
  private async ensureAudioReady(): Promise<SoundfontMIDIPlayer> {
    const audioContext = await unlockAudio();
    if (!this.soundfontPlayer) {
      this.soundfontPlayer = new SoundfontMIDIPlayer(audioContext);
      this.soundfontPlayer.setVolume(1);
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
    this.selectedDetails = document.getElementById('selectedDetails')!;

    // Motif controls
    this.motifBtn = document.getElementById('motifBtn') as HTMLButtonElement;
    this.motifStopBtn = document.getElementById('motifStopBtn') as HTMLButtonElement;
    this.motifProgressContainer = document.getElementById('motifProgressContainer')!;
    this.motifProgressBar = document.getElementById('motifProgressBar') as HTMLInputElement;
    this.motifProgressFill = document.getElementById('motifProgressFill')!;
    this.motifCurrentTime = document.getElementById('motifCurrentTime')!;
    this.motifDuration = document.getElementById('motifDuration')!;

    this.copyLinkBtn = document.getElementById('copyLinkBtn') as HTMLButtonElement;

    // iOS audio unlock UI (Motif)
    this.iosAudioBanner = document.getElementById('iosAudioBanner')!;
    this.enableAudioBtn = document.getElementById('enableAudioBtn') as HTMLButtonElement;
    this.iosAudioState = document.getElementById('iosAudioState')!;

    // Optional embed UI (only present on main page)
    this.embedSection = document.getElementById('embedSection');
    this.embedCodeEl = document.getElementById('embedCode');
    this.copyEmbedBtn = document.getElementById('copyEmbedBtn') as HTMLButtonElement | null;
    this.copyToast = document.getElementById('copyToast');

    // FAQ modal
    this.faqBtn = document.getElementById('faqBtn') as HTMLButtonElement;
    this.faqBackdrop = document.getElementById('faqModalBackdrop')!;
    this.faqCloseBtn = document.getElementById('faqCloseBtn') as HTMLButtonElement;
  }

  private setupEventListeners(): void {
    this.searchBtn.addEventListener('click', () => this.handleSearch());
    
    this.songInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleSearch();
      }
    });

    // Preview MIDI (verification only) — controlled from results table rows

    // Motif
    this.motifBtn.addEventListener('click', () => this.handleMotif());
    this.motifStopBtn.addEventListener('click', () => this.handleMotifStop());
    // Use both input and change for iOS compatibility
    const seekHandler = (e: Event) => {
      const progress = parseFloat((e.target as HTMLInputElement).value) / 100;
      this.handleMotifSeek(progress);
    };
    this.motifProgressBar.addEventListener('input', seekHandler);
    this.motifProgressBar.addEventListener('change', seekHandler);

    this.copyLinkBtn.addEventListener('click', () => void this.handleCopyLink());

    // Embed snippet copy (may be disabled / not-live)
    this.copyEmbedBtn?.addEventListener('click', () => void this.copyEmbedSnippet());

    // iOS audio unlock CTA — must be a user gesture
    const enable = () => void this.handleEnableAudio();
    this.enableAudioBtn.addEventListener('click', enable);
    this.enableAudioBtn.addEventListener('touchend', enable, { passive: true });

    // FAQ
    this.faqBtn.addEventListener('click', () => this.openFaq());
    this.faqCloseBtn.addEventListener('click', () => this.closeFaq());
    this.faqBackdrop.addEventListener('click', (e) => {
      if (e.target === this.faqBackdrop) this.closeFaq();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeFaq();
    });
  }

  private openFaq(): void {
    this.faqBackdrop.classList.add('open');
    // focus close for keyboard users
    this.faqCloseBtn.focus();
  }

  private closeFaq(): void {
    this.faqBackdrop.classList.remove('open');
  }

  private isIOSLike(): boolean {
    const ua = navigator.userAgent || '';
    const iOS = /iPad|iPhone|iPod/.test(ua);
    const iPadOS13Plus = /Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1;
    return iOS || iPadOS13Plus;
  }

  private updateIOSAudioBanner(): void {
    // Only show this UX on iOS-like browsers, and only until audio is running.
    if (!this.isIOSLike()) {
      this.iosAudioBanner.style.display = 'none';
      return;
    }

    const ready = isAudioReady();
    this.iosAudioBanner.style.display = ready ? 'none' : 'block';

    // Optional tiny state readout (helps support debugging)
    const ctx = peekAudioContext();
    if (!ready && ctx) {
      this.iosAudioState.style.display = 'block';
      this.iosAudioState.textContent = `Audio: ${ctx.state} @ ${ctx.sampleRate}Hz`;
    } else {
      this.iosAudioState.style.display = 'none';
      this.iosAudioState.textContent = '';
    }
  }

  private async handleEnableAudio(): Promise<void> {
    // Must run in a user gesture context.
    try {
      this.enableAudioBtn.disabled = true;
      this.iosAudioState.style.display = 'block';
      this.iosAudioState.textContent = 'Audio: enabling…';

      await unlockAudio();

      // Update banner state
      const ctx = getAudioContext();
      if (ctx.state !== 'running') {
        this.enableAudioBtn.disabled = false;
        this.iosAudioState.textContent = 'Audio still locked. Tap Enable Audio again.';
        return;
      }

      this.iosAudioState.textContent = `Audio: running @ ${ctx.sampleRate}Hz`;
      // Hide after a short beat to reduce flicker
      window.setTimeout(() => this.updateIOSAudioBanner(), 250);
    } catch {
      this.enableAudioBtn.disabled = false;
      this.iosAudioState.style.display = 'block';
      this.iosAudioState.textContent = 'Audio enable failed. Tap again, or disable Silent Mode.';
    } finally {
      this.enableAudioBtn.disabled = false;
    }
  }

  private async handleSearch(): Promise<void> {
    const songName = this.songInput.value.trim();
    if (!songName) return;

    // Stop any playing Motif audio
    this.handleMotifStop();

    this.updateStatus('Searching…');
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
      this.updateStatus('Pick a source to use.');
      this.updateIOSAudioBanner();

    } catch (error) {
      this.updateStatus(`Search error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.searchBtn.disabled = false;
    }
  }

  private displayResults(): void {
    this.resultsBody.innerHTML = '';
    this.previewButtons = [];

    this.searchResults.forEach((result, index) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${this.cleanSongTitle(result.title)}</td>
        <td class="source-col">${this.formatSourceLabel(result.source)}</td>
        <td class="duration-col">${this.formatDuration(result.parsed?.durationSec)}</td>
        <td class="action-col">
          <div style="display:flex; gap: 10px; justify-content: flex-end; align-items:center;">
            <button type="button" class="row-preview-btn">Play</button>
            <button type="button" class="row-use-btn">Use this</button>
          </div>
        </td>
      `;

      const previewBtn = row.querySelector('button.row-preview-btn') as HTMLButtonElement;
      previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.handleRowPreview(index);
      });
      this.previewButtons[index] = previewBtn;

      // Use explicit action button to reduce accidental selection
      const useBtn = row.querySelector('button.row-use-btn') as HTMLButtonElement;
      useBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.selectResult(index);
      });

      this.resultsBody.appendChild(row);
    });

    this.resultsSection.classList.add('visible');
    this.resultsSection.classList.remove('collapsed');
    this.playerSection.classList.remove('visible');

    // No auto-select: user should choose "Use this"
  }

  private updatePreviewButtons(): void {
    for (let i = 0; i < this.previewButtons.length; i++) {
      const btn = this.previewButtons[i];
      if (!btn) continue;
      btn.textContent = this.playingPreviewIndex === i ? 'Stop' : 'Play';
    }
  }

  private async handleRowPreview(index: number): Promise<void> {
    // Toggle stop if same row
    if (this.playingPreviewIndex === index) {
      this.stopPreview(true);
      return;
    }

    // Stop any existing preview first
    this.stopPreview(false);

    const result = this.searchResults[index];
    if (!result?.midiUrl) return;

    try {
      const player = await this.ensureAudioReady();

      // Lazy-load events for preview without affecting selection state.
      let events: NoteEvent[] | null = (result as any).__previewEvents || null;
      if (!events) {
        const midiBuffer = await this.midiService.fetchMIDI(result.midiUrl);
        if (!midiBuffer) throw new Error('Failed to fetch MIDI');
        events = MIDIParser.parseMIDI(midiBuffer);
        (result as any).__previewEvents = events;
      }

      await player.load(events);
      player.setVolume(1);
      await player.play();

      this.playingPreviewIndex = index;
      this.updatePreviewButtons();

      // Best-effort: reset UI after playback ends (SoundfontMIDIPlayer self-stops)
      const duration = player.getDuration();
      if (this.previewStopTimeout) window.clearTimeout(this.previewStopTimeout);
      this.previewStopTimeout = window.setTimeout(() => {
        if (this.playingPreviewIndex === index) {
          this.stopPreview(false);
        }
      }, Math.max(0.5, duration + 0.5) * 1000);
    } catch {
      this.stopPreview(false);
    }
  }

  private stopPreview(updateStatus: boolean): void {
    if (this.previewStopTimeout) {
      window.clearTimeout(this.previewStopTimeout);
      this.previewStopTimeout = null;
    }
    this.soundfontPlayer?.stop();
    this.playingPreviewIndex = null;
    this.updatePreviewButtons();
    if (updateStatus) {
      // No status spam in main flow.
    }
  }

  public async selectResult(index: number): Promise<void> {
    if (index < 0 || index >= this.searchResults.length) return;

    // Stop any playing Motif audio
    this.handleMotifStop();
    // Stop any playing preview audio
    this.soundfontPlayer?.stop();

    this.selectedResultIndex = index;
    const result = this.searchResults[index];

    // Update selection highlighting
    const rows = this.resultsBody.querySelectorAll('tr');
    rows.forEach((row, i) => {
      row.classList.toggle('selected', i === index);
    });
    
    this.updateStatus('Loading…');
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

      // Update UI
      const displayTitle = this.cleanSongTitle(result.title);
      this.selectedTitle.textContent = displayTitle;
      this.selectedMeta.textContent = `Source: ${this.formatSourceLabel(result.source)} · Length: ${this.formatDuration(actualDuration)} · Notes: ${events.length}`;

      // Optional details (hidden behind toggle)
      const detailParts: string[] = [];
      const trackCount = Number(metadata.trackCount);
      const tempo = Number(metadata.tempo);
      const duration = Number(actualDuration);
      if (Number.isFinite(trackCount) && trackCount > 0) detailParts.push(`Tracks: ${trackCount}`);
      if (Number.isFinite(tempo) && tempo > 0) detailParts.push(`Tempo: ${Math.round(tempo)} bpm`);
      if (Number.isFinite(duration) && duration > 0) detailParts.push(`Length: ${this.formatDuration(duration)}`);
      detailParts.push(`Notes: ${events.length}`);
      this.selectedDetails.textContent = detailParts.join(' · ');

      this.updateEmbedSnippet(result.title);
      this.updateIOSAudioBanner();
      
      this.playerSection.classList.add('visible');
      this.resultsSection.classList.add('collapsed');
      this.enablePlayerControls();
      this.updateStatus('');

      // Intent: after selecting "Use this", bring the workbench controls into view.
      // Do this after the card is visible and MIDI is loaded.
      try {
        this.playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        // ignore
      }

    } catch (error) {
      this.updateStatus(`Load error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Motif handlers
  private async handleMotif(): Promise<void> {
    if (!this.currentMIDI) {
      return;
    }

    try {
      // Best-effort: ensure iOS audio is unlocked from this user gesture.
      await unlockAudio();
      this.updateIOSAudioBanner();

      this.updateStatus('Generating…');
      this.motifBtn.disabled = true;

      // Generate a variation using the procedural role-mapping mode
      await this.motifEngine.generateFromMIDI(this.currentMIDI.events, 'procedural');
      this.motifEngine.setVolume(1);

      await this.motifEngine.play();

      this.motifStopBtn.disabled = false;

      // Show progress bar and set duration
      this.motifProgressContainer.style.display = 'block';
      const duration = this.motifEngine.getDuration();
      this.motifDuration.textContent = this.formatTime(duration);
      this.motifProgressBar.value = '0';
      this.motifProgressFill.style.width = '0%';

      // Start progress updates
      this.startMotifProgressUpdates();

      this.updateStatus('');
    } catch (error) {
      this.updateStatus(`Motif error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.motifBtn.disabled = false;
    }
  }

  private handleMotifStop(): void {
    this.motifEngine.stop();
    this.motifBtn.disabled = false;
    this.motifStopBtn.disabled = true;
    this.stopMotifProgressUpdates();
    this.updateStatus('');
  }

  private handleMotifSeek(progress: number): void {
    this.motifEngine.seek(progress);
    this.updateMotifProgress();
  }

  private startMotifProgressUpdates(): void {
    this.stopMotifProgressUpdates();
    this.motifProgressInterval = window.setInterval(() => {
      this.updateMotifProgress();
    }, 100); // Update 10 times per second
  }

  private stopMotifProgressUpdates(): void {
    if (this.motifProgressInterval !== null) {
      clearInterval(this.motifProgressInterval);
      this.motifProgressInterval = null;
    }
  }

  private updateMotifProgress(): void {
    const progress = this.motifEngine.getProgress();
    const currentTime = this.motifEngine.getCurrentTime();

    this.motifProgressBar.value = (progress * 100).toString();
    this.motifProgressFill.style.width = `${progress * 100}%`;
    this.motifCurrentTime.textContent = this.formatTime(currentTime);
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private titleCase(input: string): string {
    const small = new Set([
      'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into',
      'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'via', 'with',
    ]);
    const words = (input || '')
      .split(/\s+/g)
      .filter(Boolean)
      .map((w) => w.trim());
    return words
      .map((word, idx) => {
        if (/^[A-Z0-9]+$/.test(word)) return word;
        const lower = word.toLowerCase();
        if (idx !== 0 && small.has(lower)) return lower;
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(' ');
  }

  private cleanSongTitle(raw: string): string {
    const cleaned = (raw || '')
      .replace(/\.mid$/i, '')
      .replace(/[_]+/g, ' ')
      .replace(/[.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return this.titleCase(cleaned || 'Unknown');
  }

  private formatDuration(secondsMaybe: any): string {
    const seconds = Number(secondsMaybe);
    if (!Number.isFinite(seconds) || seconds <= 0) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private formatSourceLabel(source: string): string {
    const s = String(source || '').toLowerCase();
    if (s === 'bitmidi') return 'BitMidi';
    if (s === 'dongrays') return 'Dongrays';
    return this.titleCase(s);
  }

  private hideResults(): void {
    this.resultsSection.classList.remove('visible');
    this.playerSection.classList.remove('visible');
  }

  private enablePlayerControls(): void {
    this.motifBtn.disabled = false;
    this.copyLinkBtn.disabled = this.currentMIDI == null;
  }

  private disablePlayerControls(): void {
    this.motifBtn.disabled = true;
    this.motifStopBtn.disabled = true;
    this.copyLinkBtn.disabled = true;
  }

  private updateStatus(message: string): void {
    this.status.textContent = message;
  }

  private cleanTitleForShare(title: string): string {
    return (title || '')
      .replace(/\.mid$/i, '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  private async copyToClipboard(text: string): Promise<void> {
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

  private async handleCopyLink(): Promise<void> {
    const result = this.searchResults[this.selectedResultIndex];
    if (!result?.midiUrl) return;

    const title = this.cleanTitleForShare(result.title || 'MOTIF');

    // Prefer backend shortlink /s/<code>
    let shareUrl: string | null = null;
    try {
      let payload: any = null;
      if (result.source === 'bitmidi') {
        const m = String(result.midiUrl).match(/\/uploads\/(\d+)\.mid/i);
        if (m?.[1]) payload = { src: 'bitmidi', id: m[1], title };
      }
      if (!payload) payload = { u: result.midiUrl, title };

      const resp = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.url) shareUrl = `${window.location.origin}${data.url}`;
      }
    } catch {
      // fall through
    }

    // Fallback: direct /play link (still works, just longer)
    if (!shareUrl) {
      if (result.source === 'bitmidi') {
        const m = String(result.midiUrl).match(/\/uploads\/(\d+)\.mid/i);
        if (m?.[1]) {
          shareUrl = `${window.location.origin}/play?src=bitmidi&id=${encodeURIComponent(m[1])}`;
        }
      }
      if (!shareUrl) {
        shareUrl = `${window.location.origin}/play?u=${encodeURIComponent(result.midiUrl)}`;
      }
    }

    try {
      this.copyLinkBtn.disabled = true;
      await this.copyToClipboard(shareUrl);
      const prev = this.copyLinkBtn.textContent || 'Copy link';
      this.copyLinkBtn.textContent = 'Copied';
      window.setTimeout(() => {
        this.copyLinkBtn.textContent = prev;
      }, 900);
    } catch {
      // keep quiet; clipboard can fail in some contexts
    } finally {
      this.copyLinkBtn.disabled = false;
    }
  }

  private updateEmbedSnippet(songTitle: string): void {
    if (!this.embedSection || !this.embedCodeEl) return;

    const notLive = this.embedSection.getAttribute('data-not-live') === 'true';
    const base = notLive ? 'https://YOUR_DOMAIN' : window.location.origin;
    const url = `${base}/embed?song=${encodeURIComponent(songTitle)}`;

    const snippet = `<iframe\n  src=\"${url}\"\n  width=\"420\"\n  height=\"260\"\n  style=\"border:0;border-radius:12px;overflow:hidden\"\n  allow=\"autoplay\"\n></iframe>`;

    this.embedCodeEl.textContent = snippet;
    this.embedSection.style.display = 'block';
    if (this.copyToast) this.copyToast.style.display = 'none';
  }

  private async copyEmbedSnippet(): Promise<void> {
    if (!this.embedCodeEl) return;
    if (this.embedSection?.getAttribute('data-not-live') === 'true') {
      this.updateStatus('Embed is coming soon.');
      return;
    }

    const text = this.embedCodeEl.textContent || '';
    if (!text.trim()) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }

      if (this.copyToast) {
        this.copyToast.style.display = 'inline';
        window.setTimeout(() => {
          if (this.copyToast) this.copyToast.style.display = 'none';
        }, 1200);
      }
    } catch {
      this.updateStatus('Copy failed. Select the snippet and copy manually.');
    }
  }
}

// Make app globally available for onclick handlers
const app = new MotifApp();
(window as any).app = app;