// Usage stats (2.1.0): the page sends small events to POST /api/e and the
// home page reads the top played songs from GET /api/top. Events go to the D1
// database bound as STATS. Tracking must never break the site, so every
// failure here returns 204 or an empty list.

const TYPES = new Set(['search', 'play', 'share', 'open', 'save']);
const PAGES = new Set(['home', 'play']);
const DETAILS = new Set(['bitmidi', 'url', 'upload', 'link', 'x', 'top']);

const TOP_WINDOW_SEC = 60 * 60 * 24 * 30; // rolling 30 days
const TOP_LIMIT = 10;
const TOP_CACHE_SEC = 600;

export interface TopSong {
  id: string;
  title: string;
  plays: number;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const s = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

// HMAC(IP + user agent) keyed with the secret and the UTC day. Rotates daily;
// the raw IP is never stored.
async function visitorId(request: Request, day: string, salt: string): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = request.headers.get('user-agent') || '';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${salt}:${day}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ip}|${ua}`)));
  return [...sig.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function recordEvent(request: Request, env: Env, url: URL): Promise<Response> {
  const done = new Response(null, { status: 204 });

  // Only the site itself may send events.
  const origin = request.headers.get('origin');
  if (origin !== url.origin) return done;

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 2000) return done;
    body = JSON.parse(text);
  } catch {
    return done;
  }
  if (!body || typeof body !== 'object') return done;

  const type = clean(body.t, 10);
  if (!type || !TYPES.has(type)) return done;

  const idRaw = clean(body.id, 20);
  const songId = idRaw && /^\d+$/.test(idRaw) ? idRaw : null;
  const title = clean(body.title, 200);
  const query = type === 'search' ? clean(body.q, 100)?.toLowerCase() ?? null : null;
  const detailRaw = clean(body.d, 10);
  const detail =
    type === 'search'
      ? detailRaw && /^\d{1,3}$/.test(detailRaw) ? detailRaw : null
      : detailRaw && DETAILS.has(detailRaw) ? detailRaw : null;
  const pageRaw = clean(body.p, 10);
  const page = pageRaw && PAGES.has(pageRaw) ? pageRaw : null;

  if (type === 'search' && !query) return done;

  const now = new Date();
  const ts = Math.floor(now.getTime() / 1000);
  const day = now.toISOString().slice(0, 10);

  try {
    const visitor = await visitorId(request, day, env.STATS_SALT || 'dev');
    await env.STATS.prepare(
      'INSERT INTO events (ts, day, type, song_id, title, query, detail, page, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(ts, day, type, songId, title, query, detail, page, visitor)
      .run();
  } catch (error) {
    console.error('stats insert failed:', error);
  }
  return done;
}

// Plays count once per visitor per song per day, so reloading or replaying
// does not move the chart. Each song shows the title most visitors sent.
const TOP_SQL = `
WITH p AS (
  SELECT DISTINCT song_id, title, day, visitor
  FROM events
  WHERE type = 'play' AND song_id IS NOT NULL AND title IS NOT NULL AND ts >= ?1
),
counts AS (
  SELECT song_id, COUNT(*) AS plays
  FROM (SELECT DISTINCT song_id, day, visitor FROM p)
  GROUP BY song_id
),
titles AS (
  SELECT song_id, title,
         ROW_NUMBER() OVER (PARTITION BY song_id ORDER BY COUNT(*) DESC, title) AS rn
  FROM p
  GROUP BY song_id, title
)
SELECT c.song_id AS id, t.title AS title, c.plays AS plays
FROM counts c
JOIN titles t ON t.song_id = c.song_id AND t.rn = 1
ORDER BY c.plays DESC, c.song_id
LIMIT ?2`;

export async function topSongs(env: Env, sinceTs: number): Promise<TopSong[]> {
  const { results } = await env.STATS.prepare(TOP_SQL).bind(sinceTs, TOP_LIMIT).all<TopSong>();
  return results;
}

export async function topPlayed(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/top', request.url).href, { method: 'GET' });
  // The edge copy lives 10 minutes. Browsers get no-store, because the zone's
  // Browser Cache TTL (4 hours) would otherwise replace a short max-age.
  const toBrowser = (body: BodyInit | null) =>
    new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

  const hit = await cache.match(cacheKey);
  if (hit) return toBrowser(hit.body);

  let songs: TopSong[] = [];
  try {
    songs = await topSongs(env, Math.floor(Date.now() / 1000) - TOP_WINDOW_SEC);
  } catch (error) {
    console.error('top query failed:', error);
    return toBrowser(JSON.stringify({ songs: [] }));
  }

  const body = JSON.stringify({ songs, window: '30d' });
  ctx.waitUntil(
    cache.put(
      cacheKey,
      new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TOP_CACHE_SEC}` } }),
    ),
  );
  return toBrowser(body);
}
