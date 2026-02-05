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

- `server/src/adapters/BitMidiAdapter.ts`
  - Propagates adapter failures instead of silently returning empty results.
- `server/src/services/MIDISearchService.ts`
  - Distinguishes "all providers failed" from "no matches".
- `server/src/server.ts`
  - Returns `503` + explicit message when MIDI source is unavailable.
- `src/services/MIDIService.ts`
  - Surfaces backend JSON error messages to the frontend.

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
   - when BitMidi fails upstream, user sees:
     - `BitMidi is temporarily unavailable. Please try again in a minute.`
3. SSRF guard:
   - blocked URL example returns `403`:
     - `/api/midi/fetch?u=http://127.0.0.1:3001/health`

## Rollback

Cherry-pick/merge by commit. If needed, revert individual commits cleanly.
