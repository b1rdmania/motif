// Browser-direct BitMidi client.
//
// BitMidi exposes a JSON search API and serves MIDI files with permissive CORS
// (`access-control-allow-origin: *`), so we can run the whole search pipeline
// from the browser with no server hop. This keeps Wario.Style genuinely
// client-side and sidesteps the datacenter-IP problems we hit when the Vercel
// function scraped BitMidi's HTML server-side.

export interface BitMidiResult {
  id: string;
  title: string;
  source: 'bitmidi';
  pageUrl: string;
  midiUrl: string;
  confidence: number;
}

const BITMIDI_BASE = 'https://bitmidi.com';

export const BITMIDI_SEARCH_UNAVAILABLE_MESSAGE =
  'Sorry, it seems BitMidi search is down right now. Please try again later.';

export class BitMidiSearchUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(BITMIDI_SEARCH_UNAVAILABLE_MESSAGE);
    this.name = 'BitMidiSearchUnavailableError';
    if (cause instanceof Error) this.cause = cause;
  }
}

interface BitMidiApiMidi {
  id: number | string;
  name?: string;
  slug?: string;
  url?: string;
  downloadUrl?: string;
}

export async function searchBitMidi(query: string): Promise<BitMidiResult[]> {
  const url = `${BITMIDI_BASE}/api/midi/search?q=${encodeURIComponent(query)}`;
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch (cause) {
    throw new BitMidiSearchUnavailableError(cause);
  }

  if (!response.ok) {
    throw new BitMidiSearchUnavailableError(`HTTP ${response.status}`);
  }

  let data: { result?: { results?: BitMidiApiMidi[] } };
  try {
    data = (await response.json()) as { result?: { results?: BitMidiApiMidi[] } };
  } catch (cause) {
    throw new BitMidiSearchUnavailableError(cause);
  }
  const rows = data?.result?.results;
  if (!Array.isArray(rows)) return [];

  const candidates: BitMidiResult[] = [];
  for (const row of rows) {
    const idRaw = String(row.id ?? '').trim();
    const title = String(row.name ?? '').trim();
    if (!idRaw || !title) continue;

    const downloadPath = row.downloadUrl || `/uploads/${idRaw}.mid`;
    const midiUrl = downloadPath.startsWith('http') ? downloadPath : `${BITMIDI_BASE}${downloadPath}`;
    const pagePath = row.url || (row.slug ? `/${row.slug}` : '');
    const pageUrl = pagePath.startsWith('http') ? pagePath : `${BITMIDI_BASE}${pagePath}`;

    candidates.push({
      id: `bitmidi_${idRaw}`,
      title,
      source: 'bitmidi',
      pageUrl,
      midiUrl,
      confidence: calculateConfidence(title, query),
    });
  }

  // Dedupe by MIDI URL, keep the highest-confidence matches.
  const seen = new Set<string>();
  return candidates
    .filter((c) => {
      if (c.confidence <= 0.3) return false;
      if (seen.has(c.midiUrl)) return false;
      seen.add(c.midiUrl);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
}

// Confidence scoring ported from the server's ScoreUtils, specialised for the
// single BitMidi source. Kept in sync intentionally so result ordering matches
// what production users saw before the move to client-side search.
const STOP_WORDS = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .filter((t) => !STOP_WORDS.has(t));
}

function parseArtistSongQuery(query: string): { artist: string; song: string } | null {
  const dashMatch = query.match(/^(.+?)\s*[-:]\s*(.+)$/);
  if (dashMatch) {
    return { artist: dashMatch[1].trim(), song: dashMatch[2].trim() };
  }

  const words = query.split(/\s+/);
  if (words.length >= 3) {
    const twoWordArtist = words.slice(0, 2).join(' ');
    const remainingSong = words.slice(2).join(' ');
    if (remainingSong.length > twoWordArtist.length) {
      return { artist: twoWordArtist, song: remainingSong };
    }
    return { artist: words[0], song: words.slice(1).join(' ') };
  }

  return null;
}

function calculateConfidence(title: string, query: string): number {
  const titleLower = title.toLowerCase();
  const queryLower = query.toLowerCase();
  let score = 0;

  const titleTokens = tokenize(titleLower);
  const queryTokens = tokenize(queryLower);

  if (titleLower === queryLower) {
    score += 1.0;
  } else if (titleLower.includes(queryLower)) {
    score += 0.8;
  }

  const artistSong = parseArtistSongQuery(queryLower);
  if (artistSong) {
    const hasArtist = titleLower.includes(artistSong.artist);
    const hasSong = titleLower.includes(artistSong.song);
    if (hasArtist && hasSong) score += 0.9;
    else if (hasArtist) score += 0.4;
    else if (hasSong) score += 0.5;
  } else if (queryTokens.length > 0) {
    const matching = queryTokens.filter((token) =>
      titleTokens.some((t) => t.includes(token) || token.includes(t)),
    );
    const ratio = matching.length / queryTokens.length;
    score += ratio * 0.6;
    if (ratio === 1.0) score += 0.2;
  }

  const penalties: Array<{ pattern: RegExp; penalty: number }> = [
    { pattern: /karaoke|kar|midkar/, penalty: 0.3 },
    { pattern: /vocal|lyrics/, penalty: 0.2 },
    { pattern: /demo|test|sample/, penalty: 0.2 },
    { pattern: /incomplete|broken/, penalty: 0.5 },
  ];
  for (const { pattern, penalty } of penalties) {
    if (pattern.test(titleLower)) score -= penalty;
  }

  if (title.includes('.mid')) score += 0.1;
  // Single source today, but keep the BitMidi preference baked in.
  score += 0.1;

  return Math.max(0, Math.min(1, score));
}
