# Handoff: Security + Search Resilience

## Scope

This branch contains local-only changes for review by the dev team. No deployment actions were taken.

Branch: `codex/security-and-parse-fixes`

## Change Sets

### 1) Backend security + deterministic metadata parsing

- `server/src/services/MIDIFetchService.ts`
  - Added URL target validation to reduce SSRF risk:
    - only `http/https`
    - blocks embedded credentials
    - blocks `localhost`/local hostnames
    - blocks private/local/multicast IP targets (direct or DNS-resolved)
- `server/src/services/MIDIParseService.ts`
  - Replaced placeholder/random parsing with deterministic MIDI track parsing.
  - Extracts stable metadata: note count, basic track info, tempo/time-signature hints, duration estimate from ticks.

### 2) BitMidi outage UX (clear retry message)

> **Superseded (2026-06-16).** The server-side BitMidi search path described
> here was removed. Search now runs entirely in the browser against BitMidi's
> CORS-enabled JSON API (`https://bitmidi.com/api/midi/search`), so the old
> `503` outage flow no longer exists. `server/src/adapters/BitMidiAdapter.ts`
> and `server/src/services/MIDISearchService.ts` were deleted. See
> `src/services/BitMidiClient.ts` and `src/services/MIDIService.ts` for the
> current implementation; the server now only proxies MIDI fetches (for
> non-CORS hosts) and mints share links.

## Build/Checks Run Locally

- Frontend:
  - `npm run typecheck` (pass)
  - `npm run build` (pass)
- Backend:
  - `npm run build` (pass)

## Behavior to Verify in Staging

1. Successful flow:
   - search song -> results load -> select result -> preview/generate works.
2. Source outage flow:
   - search runs browser-side against BitMidi; if BitMidi is unreachable the
     UI shows a "Search error" status, and "No MIDI files found" when a query
     simply has no matches.
3. SSRF guard:
   - blocked URL example returns `403`:
     - `/api/midi/fetch?u=http://127.0.0.1:3001/health`

## Rollback

Cherry-pick/merge by commit. If needed, revert individual commits cleanly.
