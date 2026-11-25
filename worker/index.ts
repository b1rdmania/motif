// wario.style on Cloudflare Workers. Static files come from dist/ through the
// ASSETS binding; this script handles the routes the Express server handled
// on Vercel (/api/*, /s/:code, /health) plus the /v2 and .html redirects. The bare
// domain redirect lives in worker/apex.ts.
// server/src/server.ts stays in the repo for local dev and Vercel rollback.

import { ScoreUtils } from '../server/src/utils/ScoreUtils.js';
import { SimpleMIDI } from '../server/src/utils/SimpleMIDI.js';
import { MIDIParseService } from '../server/src/services/MIDIParseService.js';
import { fetchChecked } from './guard.js';
import { recordEvent, topPlayed } from './stats.js';

// Env (ASSETS, SHARES, STATS, STATS_SALT) is generated from wrangler.jsonc: npx wrangler types worker/worker-configuration.d.ts

type SharePayload =
  | { kind: 'bitmidi'; id: string; title?: string; createdAt: string; v: number }
  | { kind: 'url'; u: string; title?: string; createdAt: string; v: number };

// 30 days, as on Redis.
const SHARE_TTL_SEC = 60 * 60 * 24 * 30;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
};

const parseService = new MIDIParseService();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const path = url.pathname;

    // Old V2 links open the unified player with the same song.
    if (path === '/v2' || path === '/v2/' || path === '/v2.html') {
      return Response.redirect(`${url.origin}/${url.search}`, 301);
    }

    // Vercel served /page.html and /page as duplicates, and Google indexed
    // both. Send the .html form to the clean URL with a permanent redirect
    // (the assets layer would use a 307).
    if (path.endsWith('.html')) {
      const clean = path === '/index.html' ? '/' : path.slice(0, -'.html'.length);
      return Response.redirect(`${url.origin}${clean}${url.search}`, 301);
    }

    if (request.method === 'OPTIONS' && (path.startsWith('/api/') || path === '/health' || path.startsWith('/s/'))) {
      return new Response(null, {
        status: 204,
        headers: { ...CORS, 'Access-Control-Allow-Headers': request.headers.get('access-control-request-headers') || '' },
      });
    }

    try {
      if (path === '/health') {
        return json({ status: 'ok', timestamp: new Date().toISOString() });
      }
      if (path === '/api/e' && request.method === 'POST') {
        return await recordEvent(request, env, url);
      }
      if (path === '/api/top' && request.method === 'GET') {
        return await topPlayed(request, env, ctx);
      }
      if (path === '/api/share' && request.method === 'POST') {
        return await createShare(request, env);
      }
      const share = path.match(/^\/s\/([^/]+)$/);
      if (share && request.method === 'GET') {
        return await resolveShare(decodeURIComponent(share[1]).trim(), url.origin, env);
      }
      if (path === '/api/midi/fetch' && request.method === 'GET') {
        return await midiFetch(url);
      }
      if (path === '/api/midi/parse' && request.method === 'GET') {
        return await midiParse(url);
      }
    } catch (error) {
      console.error(`${path} error:`, error);
      return json({ error: 'Request failed' }, 500);
    }

    if (path.startsWith('/api/') || path.startsWith('/s/')) {
      return new Response(`Cannot ${request.method} ${path}`, { status: 404, headers: CORS });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function newCode(): string {
  // 8 chars base62-ish from random bytes (sufficient for our scale)
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (const b of crypto.getRandomValues(new Uint8Array(8))) out += alphabet[b % alphabet.length];
  return out;
}

async function createShare(request: Request, env: Env): Promise<Response> {
  let body: any = {};
  if ((request.headers.get('content-type') || '').includes('application/json')) {
    try {
      body = (await request.json()) || {};
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
  }
  const now = new Date().toISOString();
  const title = typeof body.title === 'string' ? body.title.slice(0, 200) : undefined;

  let payload: SharePayload | null = null;
  if (body.src === 'bitmidi' && typeof body.id === 'string' && /^\d+$/.test(body.id)) {
    payload = { kind: 'bitmidi', id: body.id, title, createdAt: now, v: 1 };
  } else if (typeof body.u === 'string' && body.u.startsWith('http')) {
    payload = { kind: 'url', u: body.u, title, createdAt: now, v: 1 };
  }

  if (!payload) {
    return json({ error: 'Invalid payload. Expected {src:"bitmidi",id:"123"} or {u:"https://..."}.' }, 400);
  }

  // Avoid collisions (extremely unlikely, but cheap to check a few times)
  let code = newCode();
  for (let i = 0; i < 3; i++) {
    if (!(await env.SHARES.get(`share:${code}`))) break;
    code = newCode();
  }

  await env.SHARES.put(`share:${code}`, JSON.stringify(payload), { expirationTtl: SHARE_TTL_SEC });
  return json({ code, url: `/s/${code}` });
}

async function resolveShare(code: string, origin: string, env: Env): Promise<Response> {
  if (!code) return new Response('Missing code', { status: 400, headers: CORS });

  const raw = await env.SHARES.get(`share:${code}`);
  if (!raw) return new Response('Not found', { status: 404, headers: CORS });
  const payload = JSON.parse(raw) as SharePayload;

  const sp = new URLSearchParams();
  if (payload.kind === 'bitmidi') {
    sp.set('src', 'bitmidi');
    sp.set('id', payload.id);
  } else {
    sp.set('u', payload.u);
  }
  if (payload.title) sp.set('title', payload.title);
  const dest = `/play?${sp.toString()}`;

  // Social crawlers (Telegram, X, etc.) need HTML with OG/Twitter tags.
  // Serve a tiny landing document that redirects humans to /play.
  const shortUrl = `${origin}/s/${encodeURIComponent(code)}`;
  const playUrl = `${origin}${dest}`;
  const imageUrl = `${origin}/warioX.png`;

  const sharedTitle = (payload.title || '').trim();
  const ogTitle = sharedTitle ? `${sharedTitle} - Wario Synth` : 'Wario Synth 8-Bit Midi';
  const ogDescription = sharedTitle
    ? `I made ${sharedTitle} Game Boy version. Click to listen or generate your own.`
    : 'Turn any song into a Game Boy version';

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

    <meta name="twitter:card" content="summary_large_image" />
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
    <script>location.replace(${JSON.stringify(playUrl).replaceAll('<', '\\u003c')});</script>
  </body>
</html>`;

  return new Response(html, { headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8' } });
}

// Fetch a MIDI file through the SSRF guard and validate it.
async function fetchMidi(url: string): Promise<{ data: ArrayBuffer } | { error: string }> {
  // Only generate synthetic MIDI for explicit synthetic URLs
  if (url.startsWith('synthetic:') || url.includes('mock')) {
    const songName = url.startsWith('synthetic:')
      ? url.replace('synthetic:', '')
      : url.split('/').pop()?.replace('.mid', '') || 'test';
    console.log(`Generating synthetic MIDI for: ${url}`);
    return { data: SimpleMIDI.generateValidMIDI(songName) };
  }

  let response: Response | { error: string };
  try {
    response = await fetchChecked(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MotifBot/1.0)' },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
  if (!(response instanceof Response)) return response;
  if (!response.ok) return { error: `HTTP ${response.status}` };

  const buffer = await response.arrayBuffer();

  if (buffer.byteLength < 14) return { error: 'File too small to be valid MIDI' };
  const header = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (header !== 'MThd') return { error: 'Invalid MIDI header' };
  if (buffer.byteLength > 10_000_000) return { error: 'File too large' }; // 10MB max

  const quality = ScoreUtils.assessQuality(buffer);
  if (quality.score < 0.3) return { error: `Poor quality: ${quality.issues.join(', ')}` };

  return { data: buffer };
}

function fetchError(error: string): Response {
  const blocked = /blocked|not allowed/i.test(error);
  return json({ error }, blocked ? 403 : 404);
}

async function midiFetch(url: URL): Promise<Response> {
  const target = url.searchParams.get('u');
  if (!target) return json({ error: 'URL parameter "u" is required' }, 400);

  console.log(`Fetching: ${target}`);
  const result = await fetchMidi(target);
  if ('error' in result) return fetchError(result.error);

  return new Response(result.data, {
    headers: { ...CORS, 'Content-Type': 'audio/midi', 'Content-Length': String(result.data.byteLength) },
  });
}

async function midiParse(url: URL): Promise<Response> {
  const target = url.searchParams.get('u');
  if (!target) return json({ error: 'URL parameter "u" is required' }, 400);

  console.log(`Parsing MIDI metadata: ${target}`);
  const result = await fetchMidi(target);
  if ('error' in result) return fetchError(result.error);

  return json(parseService.parseMIDI(result.data));
}
