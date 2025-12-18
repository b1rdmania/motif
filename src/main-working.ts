console.log('Full Motif app loading...');

interface SearchResult {
  id: string;
  title: string;
  source: string;
  pageUrl: string;
  midiUrl: string;
  confidence: number;
}

class MotifApp {
  private searchResults: SearchResult[] = [];
  private selectedIndex = 0;

  constructor() {
    document.addEventListener('DOMContentLoaded', () => {
      this.initializeUI();
    });
  }

  private initializeUI(): void {
    console.log('Initializing UI...');
    
    const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
    const songInput = document.getElementById('songInput') as HTMLInputElement;
    
    if (!searchBtn || !songInput) {
      console.error('UI elements not found!');
      return;
    }
    
    searchBtn.addEventListener('click', () => this.handleSearch());
    songInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleSearch();
    });
    
    // Make selectResult globally available for onclick handlers
    (window as any).app = this;
    
    console.log('UI initialized successfully');
  }

  private async handleSearch(): Promise<void> {
    const songInput = document.getElementById('songInput') as HTMLInputElement;
    const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
    const status = document.getElementById('status')!;
    
    const songName = songInput.value.trim();
    if (!songName) return;

    status.textContent = 'Searching for MIDI files...';
    searchBtn.disabled = true;

    try {
      const response = await fetch(`http://localhost:3001/api/midi/search?q=${encodeURIComponent(songName)}`);
      const data = await response.json();
      
      console.log('Search results:', data);
      
      if (data.results.length === 0) {
        status.textContent = 'No MIDI files found. Try a different search.';
        return;
      }

      this.searchResults = data.results;
      this.displayResults();
      status.textContent = `Found ${data.results.length} MIDI files. Select one to play.`;

    } catch (error) {
      console.error('Search error:', error);
      status.textContent = `Search error: ${error}`;
    } finally {
      searchBtn.disabled = false;
    }
  }

  private displayResults(): void {
    const resultsSection = document.getElementById('resultsSection')!;
    const resultsBody = document.getElementById('resultsBody')!;
    
    resultsBody.innerHTML = '';
    
    this.searchResults.forEach((result, index) => {
      const row = document.createElement('tr');
      if (index === this.selectedIndex) {
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
        <td>?</td>
        <td>?</td>
        <td></td>
        <td><button onclick="window.app.selectResult(${index})">Select</button></td>
      `;
      
      resultsBody.appendChild(row);
    });
    
    resultsSection.classList.add('visible');
    
    // Auto-select first result
    if (this.searchResults.length > 0) {
      this.selectResult(0);
    }
  }

  public async selectResult(index: number): Promise<void> {
    if (index < 0 || index >= this.searchResults.length) return;
    
    this.selectedIndex = index;
    const result = this.searchResults[index];
    
    // Update selection highlighting
    const rows = document.querySelectorAll('#resultsBody tr');
    rows.forEach((row, i) => {
      row.classList.toggle('selected', i === index);
    });
    
    const status = document.getElementById('status')!;
    const playerSection = document.getElementById('playerSection')!;
    const selectedTitle = document.getElementById('selectedTitle')!;
    const selectedMeta = document.getElementById('selectedMeta')!;
    
    status.textContent = 'Loading MIDI file...';

    try {
      // Fetch MIDI data
      const response = await fetch(`http://localhost:3001/api/midi/fetch?u=${encodeURIComponent(result.midiUrl)}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch MIDI: ${response.status}`);
      }

      const midiBuffer = await response.arrayBuffer();
      
      // Update UI
      selectedTitle.textContent = result.title;
      selectedMeta.innerHTML = `
        <strong>Source:</strong> ${result.source} | 
        <strong>Size:</strong> ${(midiBuffer.byteLength / 1024).toFixed(1)}KB | 
        <strong>Confidence:</strong> ${Math.round(result.confidence * 100)}%
      `;
      
      playerSection.classList.add('visible');
      
      // Enable preview button
      const previewBtn = document.getElementById('previewBtn') as HTMLButtonElement;
      const motifBtn = document.getElementById('motifBtn') as HTMLButtonElement;
      previewBtn.disabled = false;
      motifBtn.disabled = false;
      
      // Store MIDI data for playback
      (this as any).currentMIDI = { buffer: midiBuffer, result };
      
      status.textContent = 'MIDI loaded. You can now preview or generate synthesis.';

    } catch (error) {
      console.error('Load error:', error);
      status.textContent = `Load error: ${error}`;
    }
  }

  public async handlePreview(): Promise<void> {
    console.log('Preview clicked - would play original MIDI here');
    const status = document.getElementById('status')!;
    status.textContent = 'Preview playback not yet implemented - but MIDI is loaded!';
  }

  public async handleMotif(): Promise<void> {
    console.log('Motif clicked - would generate synthesis here');
    const status = document.getElementById('status')!;
    status.textContent = 'Motif synthesis not yet implemented - but MIDI is parsed!';
  }
}

// Initialize app
new MotifApp();

// Expose handlers for buttons
(window as any).handlePreview = () => (window as any).app.handlePreview();
(window as any).handleMotif = () => (window as any).app.handleMotif();