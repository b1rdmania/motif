// Usage events (2.1.0). Fire-and-forget: tracking never blocks or breaks the
// player. The Worker stores these in D1; see worker/stats.ts.

export type StatsEvent =
  | { t: 'search'; q: string; d: string }
  | { t: 'play'; id?: string; title?: string; d: 'bitmidi' | 'url' | 'upload' }
  | { t: 'share'; id?: string; title?: string; d: 'link' | 'x' }
  | { t: 'open'; id?: string; title?: string; d: 'link' | 'top' }
  | { t: 'save'; id?: string; title?: string };

export interface TopSong {
  id: string;
  title: string;
  plays: number;
}

export function bitmidiId(midiUrl: string | undefined | null): string | undefined {
  return midiUrl?.match(/bitmidi\.com\/uploads\/(\d+)\.mid/i)?.[1];
}

export function track(event: StatsEvent, page: 'home' | 'play' = 'home'): void {
  try {
    const body = JSON.stringify({ ...event, p: page });
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon?.('/api/e', blob)) return;
    void fetch('/api/e', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  } catch {
    // Tracking is optional.
  }
}

export async function fetchTopSongs(): Promise<TopSong[]> {
  try {
    const res = await fetch('/api/top');
    if (!res.ok) return [];
    const data = (await res.json()) as { songs?: TopSong[] };
    return Array.isArray(data.songs) ? data.songs : [];
  } catch {
    return [];
  }
}
