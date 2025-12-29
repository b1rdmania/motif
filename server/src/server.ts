import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
import { createClient } from 'redis';
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

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getOrigin(req: express.Request): string {
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = xfProto || (req.secure ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  if (!host) return '';
  return `${proto}://${host}`;
}

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
const redisUrl = process.env.REDIS_URL;
const hasRedisEnv = Boolean(redisUrl);

let redisClient: ReturnType<typeof createClient> | null = null;
let redisConnectPromise: Promise<void> | null = null;

async function getRedis(): Promise<ReturnType<typeof createClient>> {
  if (!redisUrl) throw new Error('REDIS_URL is not configured for this project.');
  if (!redisClient) {
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => console.error('Redis error:', err));
  }
  if (!redisClient.isOpen) {
    if (!redisConnectPromise) {
      redisConnectPromise = redisClient.connect().then(() => {}).finally(() => {
        redisConnectPromise = null;
      });
    }
    await redisConnectPromise;
  }
  return redisClient;
}

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
  if (isVercel && !hasRedisEnv && !hasKvEnv) {
    throw new Error('No storage configured (need REDIS_URL or Vercel KV env vars).');
  }

  // Prefer Redis integration if present (your project has REDIS_URL).
  if (hasRedisEnv) {
    const r = await getRedis();
    await r.set(key, JSON.stringify(payload), { EX: exSec });
    return;
  }

  // Fallback: Vercel KV REST (Upstash)
  if (hasKvEnv) {
    await kv.set(key, payload, { ex: exSec });
    return;
  }

  // Local dev only: best-effort in-memory store.
  localShareStore.set(code, payload);
}

async function shareGet(code: string): Promise<SharePayload | null> {
  const key = `share:${code}`;
  if (isVercel && !hasRedisEnv && !hasKvEnv) {
    throw new Error('No storage configured (need REDIS_URL or Vercel KV env vars).');
  }

  if (hasRedisEnv) {
    const r = await getRedis();
    const val = await r.get(key);
    if (!val) return null;
    return JSON.parse(val) as SharePayload;
  }

  if (hasKvEnv) {
    const val = await kv.get<SharePayload>(key);
    return val ?? null;
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

    // Social crawlers (Telegram, X, etc.) need HTML with OG/Twitter tags.
    // Serve a tiny landing document that redirects humans to /play.
    const origin = getOrigin(req);
    const shortUrl = origin ? `${origin}/s/${encodeURIComponent(code)}` : `/s/${encodeURIComponent(code)}`;
    const playUrl = origin ? `${origin}${dest}` : dest;
    const imageUrl = origin ? `${origin}/wario-synth.png` : '/wario-synth.png';

    const sharedTitle = (payload.title || '').trim();
    const ogTitle = sharedTitle || 'WARIO SYNTH';
    const ogDescription = 'I made this in Wario Synth, click to listen or generate your own';

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(ogTitle)}</title>
    <meta name="description" content="${escapeHtml(ogDescription)}" />

    <meta property="og:title" content="${escapeHtml(ogTitle)}" />
    <meta property="og:description" content="${escapeHtml(ogDescription)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:width" content="1472" />
    <meta property="og:image:height" content="704" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeHtml(shortUrl)}" />

    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(ogTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(ogDescription)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />

    <meta http-equiv="refresh" content="0;url=${escapeHtml(playUrl)}" />
    <link rel="canonical" href="${escapeHtml(playUrl)}" />
    <style>
      body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background:#0a0a0a; color:#e8e8e8; margin:0; padding:24px; }
      a { color:#00ff88; }
    </style>
  </head>
  <body>
    Redirecting to the player… <a href="${escapeHtml(playUrl)}">Tap here</a>
    <script>location.replace(${JSON.stringify(playUrl)});</script>
  </body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
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