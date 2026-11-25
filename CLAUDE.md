# MOTIF — Aims, Scope, and Guidelines (for AI agents)

## Aims (what we’re trying to achieve)
- **Primary aim (MVP)**: Let a user search any song name, find real MIDI files online, **load one**, and **play it back in-browser** in a way that feels like a proper MIDI performance.
- **Secondary aim (next step)**: From the same MIDI, generate a **similar-but-different** “Motif” version and play that.
- **Future aim (later)**: Add stylistic transforms (“more ominous”, “dance/remix”), controls, and improved musical intelligence.

## Scope (what is in-bounds right now)
- **Search + ranking** of MIDI candidates from multiple sources
- **Local MIDI upload** (client-side parse; no server upload endpoint)
- **Fetch + validate + cache** MIDI bytes via the backend (with SSRF protection)
- **Parse** MIDI and show basic metadata (duration, track count, issues) - now deterministic
- **Playback of the fetched MIDI** (this is the current priority)
- **Export** generated results as WAV or MIDI after playback
- **Error handling**: Clear user feedback when upstream services fail
- Keep Motif generation working, but don't block MVP playback on it

## Non-scope (avoid for now)
- Perfect matching/similarity, chord/key analysis, advanced arrangement
- Big infra (CDN/monitoring), large refactors. Usage stats exist since 2.1.0 (D1 `wario-stats`); keep them small and anonymous
- New features unrelated to search/fetch/parse/playback reliability

## Guidelines (how to work in this repo)
- **Bias toward real MIDI**: don't silently replace real results with synthetic/mock in the default user path.
- **Make degradation explicit**: if mock/synthetic is used, it must be clearly indicated (UI/logs).
- **Keep changes incremental**: prioritize reliable end-to-end playback over architecture rewrites.
- **Respect browser audio constraints**: playback must work with autoplay policies (user gesture → resume AudioContext).
- **Add practical observability**: when fixing issues, add minimal logs/errors that explain which step failed (search vs fetch vs parse vs playback).
- **Security first**: All URL fetches must validate targets (SSRF protection is enabled). Never bypass security checks.
- **User-friendly errors**: When upstream services fail, return clear, actionable error messages (not generic "something went wrong").
- **Deterministic behavior**: Parsing and metadata extraction should be stable/reproducible across runs (no random placeholders).
- **Definition of done for any PR**:
  - Search returns results for common queries (or clear error if source is down)
  - Selecting a result fetches bytes successfully (or shows a clear error)
  - Playback starts/stops reliably without breaking subsequent plays
  - Security validations pass (no SSRF vulnerabilities introduced)

## "Done means demo-able"
A change is successful if someone can:
- search "Hotel California"
- select a result
- hit Play and hear it
- hit Stop and try another result

## Recent Improvements (2026-11-25)
- **v2.1.0 — Usage stats + top played chart**: `src/services/stats.ts` sends fire-and-forget events (search, play, save, share, open) to `POST /api/e`; `worker/stats.ts` stores them in D1 (`STATS` binding, `migrations/0001_events.sql`). `GET /api/top` returns the top 10 plays over 30 days (one per visitor per song per day), cached 10 min, shown on the home page when 3+ songs qualify. Visitor key = HMAC(IP + UA) with secret `STATS_SALT` + UTC day; no IPs stored. `npm run stats` reads the numbers. New schema changes: add a numbered file in `migrations/` and run `npx wrangler d1 migrations apply wario-stats --remote`.

## Recent Improvements (2026-06-16)
- **Browser-direct MIDI search**: Search now runs entirely client-side against BitMidi's CORS-enabled JSON API (`https://bitmidi.com/api/midi/search`) via `src/services/BitMidiClient.ts`. This fixed the production outage where BitMidi blocked/garbled the old server-side HTML scrape from Vercel's datacenter IPs. Removed the `/api/midi/search` endpoint, the server-side scraper (`BitMidiAdapter.ts`, `MIDISearchService.ts`), and the unused Dongrays/FreeMidi/Mock adapters. The server now only proxies MIDI fetches (non-CORS hosts) and mints share links.

## Recent Improvements (2026-06-15)
- **v1.6 — Local MIDI upload + export**: Upload `.mid`/`.midi` client-side; Save Audio (WAV) and Save MIDI after generation. Sharing (Copy link, Share to X) still works for searched MIDI; local uploads are export-only ([#2](https://github.com/b1rdmania/motif/pull/2), [@RobertAgee](https://github.com/RobertAgee))
- **Offline export stability**: Dense MIDIs capped during offline render so exports do not choke the audio context
- **Live at**: [www.wario.style](https://www.wario.style/)

## Recent Improvements (2026-02-05)
- **SSRF Protection**: All MIDI fetch endpoints now validate URLs and block private/local targets (localhost, 10.x, 192.168.x, 169.254.x, etc.)
- **Deterministic MIDI Parsing**: Replaced random placeholder metadata with real track analysis (stable note counts, tempo, time signatures)
- **BitMidi Outage UX**: When upstream MIDI sources fail, users see clear retry messages instead of silent failures (returns 503 with actionable message) _(superseded 2026-06-16 — search is now browser-direct; the 503 server path was removed)_
- **Verified**: All changes tested and merged to master (commits 5e81227, 686c961)
