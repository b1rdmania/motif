import express from 'express';
import cors from 'cors';
import { MIDISearchService } from './services/MIDISearchService.js';
import { MIDIFetchService } from './services/MIDIFetchService.js';
import { MIDIParseService } from './services/MIDIParseService.js';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const searchService = new MIDISearchService();
const fetchService = new MIDIFetchService();
const parseService = new MIDIParseService();

// Search for MIDI files
app.get('/api/midi/search', async (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    console.log(`Searching for: ${query}`);
    const results = await searchService.search(query);
    res.json({ results, count: results.length });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Fetch and proxy MIDI file
app.get('/api/midi/fetch', async (req, res) => {
  try {
    const url = req.query.u as string;
    if (!url) {
      return res.status(400).json({ error: 'URL parameter "u" is required' });
    }

    console.log(`Fetching: ${url}`);
    const result = await fetchService.fetch(url);
    
    if (result.success) {
      res.setHeader('Content-Type', 'audio/midi');
      res.setHeader('Content-Length', result.data!.length);
      res.send(result.data);
    } else {
      res.status(404).json({ error: result.error });
    }
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// Parse MIDI metadata
app.get('/api/midi/parse', async (req, res) => {
  try {
    const url = req.query.u as string;
    if (!url) {
      return res.status(400).json({ error: 'URL parameter "u" is required' });
    }

    console.log(`Parsing MIDI metadata: ${url}`);
    const result = await fetchService.fetch(url);
    
    if (result.success && result.data) {
      const metadata = parseService.parseMIDI(result.data);
      res.json(metadata);
    } else {
      res.status(404).json({ error: result.error || 'Failed to fetch MIDI' });
    }
  } catch (error) {
    console.error('Parse error:', error);
    res.status(500).json({ error: 'Parse failed' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`🎵 Motif backend running on port ${port}`);
});