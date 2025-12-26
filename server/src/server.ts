import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
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

type SharePayload =
  | {
      kind: 'bitmidi';
      id: string;
      title?: string;
      createdAt: string;
      v: number;
    }
  | {
      kind: 'url';
      u: string;
      title?: string;
      createdAt: string;
      v: number;
    };

const localShareStore = new Map<string, SharePayload>();
const isVercel = Boolean(process.env.VERCEL);
const hasKvEnv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

function base62(bytes: Uint8Array): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function newCode(): string {
  // 8 chars base62-ish from random bytes (sufficient for our scale)
  return base62(crypto.randomBytes(8));
}

async function shareSet(code: string, payload: SharePayload): Promise<void> {
  const key = `share:${code}`;
  // 30 days TTL
  const exSec = 60 * 60 * 24 * 30;
  if (isVercel && !hasKvEnv) {
    throw new Error('Vercel KV is not configured for this project.');
  }

  try {
    if (hasKvEnv) {
      await kv.set(key, payload, { ex: exSec });
      return;
    }
  } catch {
    // fall through to local store (dev only)
  }

  // Local dev: best-effort in-memory store.
  localShareStore.set(code, payload);
}

async function shareGet(code: string): Promise<SharePayload | null> {
  const key = `share:${code}`;
  if (isVercel && !hasKvEnv) {
    throw new Error('Vercel KV is not configured for this project.');
  }

  try {
    if (hasKvEnv) {
      const val = await kv.get<SharePayload>(key);
      return val ?? null;
    }
  } catch {
    // fall through to local store (dev only)
  }

  return localShareStore.get(code) ?? null;
}

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

// Create a short share link
app.post('/api/share', async (req, res) => {
  try {
    const body = (req.body || {}) as any;
    const now = new Date().toISOString();
    const title = typeof body.title === 'string' ? body.title.slice(0, 200) : undefined;

    let payload: SharePayload | null = null;
    if (body.src === 'bitmidi' && typeof body.id === 'string' && /^\d+$/.test(body.id)) {
      payload = { kind: 'bitmidi', id: body.id, title, createdAt: now, v: 1 };
    } else if (typeof body.u === 'string' && body.u.startsWith('http')) {
      payload = { kind: 'url', u: body.u, title, createdAt: now, v: 1 };
    }

    if (!payload) {
      return res.status(400).json({ error: 'Invalid payload. Expected {src:\"bitmidi\",id:\"123\"} or {u:\"https://...\"}.' });
    }

    // Avoid collisions (extremely unlikely, but cheap to check a few times)
    let code = newCode();
    for (let i = 0; i < 3; i++) {
      const existing = await shareGet(code);
      if (!existing) break;
      code = newCode();
    }

    await shareSet(code, payload);
    res.json({
      code,
      url: `/s/${code}`,
    });
  } catch (error) {
    console.error('Share create error:', error);
    const msg = error instanceof Error ? error.message : 'Share create failed';
    res.status(msg.includes('KV') ? 503 : 500).json({ error: msg });
  }
});

// Resolve a short share link and redirect to /play
app.get('/s/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) return res.status(400).send('Missing code');

    const payload = await shareGet(code);
    if (!payload) return res.status(404).send('Not found');

    let dest = '/play';
    if (payload.kind === 'bitmidi') {
      const sp = new URLSearchParams();
      sp.set('src', 'bitmidi');
      sp.set('id', payload.id);
      if (payload.title) sp.set('title', payload.title);
      dest = `/play?${sp.toString()}`;
    } else if (payload.kind === 'url') {
      const sp = new URLSearchParams();
      sp.set('u', payload.u);
      if (payload.title) sp.set('title', payload.title);
      dest = `/play?${sp.toString()}`;
    }

    res.redirect(302, dest);
  } catch (error) {
    console.error('Share resolve error:', error);
    const msg = error instanceof Error ? error.message : 'Resolve failed';
    res.status(msg.includes('KV') ? 503 : 500).send(msg);
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
      res.setHeader('Content-Length', result.data!.byteLength);
      res.send(Buffer.from(result.data!));
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

// Vercel serverless runtime expects an exported handler (Express apps are handlers).
// Locally, we still want to run a dev server with `app.listen`.
export default app;

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`🎵 Motif backend running on port ${port}`);
  });
}