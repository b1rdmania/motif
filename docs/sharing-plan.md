# Sharing plan: links + player landing + Motif export

This document captures the implementation plan for **Share links** (Copy Link + Share to X), a minimal **player landing page**, and the next step: sharing **generated Motif variants** via **exported artifacts** (MIDI and/or audio).

## Goals
- **Shareable outcome**: users can share something they heard (original MIDI preview, or a generated Motif variant).
- **One-click-to-hear**: shared links load quickly and are ready to play (but never true autoplay; iOS requires a user gesture).
- **Lightweight**: keep the landing page minimal and stable.
- **Safe**: shared URLs must not turn the backend into an open proxy.

## MVP constraints (important)
- **iOS/Safari** blocks audio until a user gesture. The landing can preload, but playback needs a tap.
- **X/Twitter** shares are links + preview cards. No reliable in-post WebAudio playback.
- Search results can change over time, so **index-based sharing** is brittle.

## UX spec

### A) Main app: Share controls
Placement: near the “Selected MIDI”/result context (where users decide something is share-worthy).

Controls:
- **Copy link**: copies a permalink to clipboard + shows a small “Copied” toast.
- **Share to X**: opens the tweet composer with prefilled text + URL.

X intent URL format:
- `https://twitter.com/intent/tweet?text=<encodedText>&url=<encodedShareUrl>`

Suggested default tweet text:
- `Listening to “{title}” in MOTIF — try it`

### B) Share landing: `/play`
A minimal landing page that:
- reads parameters from the URL
- fetches the MIDI (or exported artifact)
- enables Play/Stop + volume
- shows iOS “Enable Audio” CTA if required
- includes a primary CTA: **Generate your own** → links back to the main app

## URL design (heart of the plan)

### v1: share the original MIDI preview (recommended MVP)
Use the MIDI URL as the stable identifier.

Landing URL:
- `/play?u=<encodedMidiUrl>&title=<encodedTitle>&song=<encodedQuery>`

Notes:
- `u` is required for reproducibility.
- `title` is display-only (optional).
- `song` supports the CTA back to the main app (optional).

Example:
- `/play?u=https%3A%2F%2Fbitmidi.com%2Fuploads%2F...mid&title=Hotel%20California&song=Hotel%20California`

Main app CTA target:
- `/?song=<encodedQuery>`

### Why not share “result index”?
Because search ranking shifts; index links rot. If needed, index can be a fallback only when `u` is missing.

## `/play` landing behavior

### Required inputs
- **Preview share**: `u` (MIDI source URL)
- **Export share**: `m` (motif midi id) or `a` (audio id)

### State machine
- If `m` or `a` present → load exported artifact
- Else if `u` present → fetch + parse MIDI via backend proxy
- Else → show “Invalid link” + CTA to home

### Playback
- Never autoplay.
- Enable Audio CTA shown until AudioContext is running.

### Error cases
- Missing/invalid params → show “Invalid link”
- Backend fetch failure → show “Couldn’t load this MIDI”
- Parse failure → show “Unsupported or corrupted MIDI”

## Export-based sharing (generated Motif variants)
Sharing a generated Motif variant needs an artifact the landing page can load reliably:
- **MIDI export**: smaller, fast, consistent with the project (music-as-structure)
- **Audio export**: most universal listening, but heavier and needs careful encoding/hosting

### Recommended sequencing
1) **MIDI export first** (fast, small, easy to iterate)\n2) Add **audio export** once the flow proves value (and storage/limits are solved)

### Proposed backend endpoints

#### 1) Create export (returns a shareable play URL)
`POST /api/share/export`

Input (example):
```json
{
  "u": "https://bitmidi.com/uploads/....mid",
  "song": "Hotel California",
  "title": "Hotel California - Eagles",
  "preset": "dance|ambient|ominous|default",
  "params": { "intensity": 0.5, "swing": 0.1 },
  "format": "midi|audio"
}
```

Output (example):
```json
{
  "id": "abc123",
  "format": "midi",
  "playUrl": "/play?m=abc123&title=Hotel%20California&song=Hotel%20California"
}
```

#### 2) Fetch export artifact
Option A (explicit):
- `GET /api/share/artifact?id=abc123` → returns bytes (MIDI or audio)

Option B (format-specific):
- `GET /api/share/midi?id=abc123`
- `GET /api/share/audio?id=abc123`

Landing params:
- MIDI artifact: `/play?m=<id>&title=...&song=...`
- Audio artifact: `/play?a=<id>&title=...&song=...`

### Storage strategy (dev vs production)
- **Local dev**: filesystem under `server/cache/exports/`
- **Vercel production**: filesystem is not durable; prefer:
  - blob storage (recommended), or
  - KV/object store (if blob not available), or
  - a small database row referencing a blob key

### Security constraints (must-have)
- Validate `u` server-side:
  - allow only `http`/`https`
  - strongly consider allowlisting hosts (e.g. `bitmidi.com`) for v1
- Enforce limits:
  - max MIDI bytes
  - max parsed duration
  - max export size
  - max export time/CPU
- Rate-limit export endpoints.
- Cache and dedupe exports:
  - key by `(sourceMidiHash + preset + params + format)` to avoid repeated work

## Files (expected) — implementation map
Frontend:
- `index.html`: Share UI elements
- `src/main.ts`: URL generation + clipboard + X intent
- `play.html` + `src/play.ts`: landing page UI + logic
- `vite.config.ts`: add `play.html` to multi-page inputs

Backend:
- `server/src/server.ts`: route handlers for export endpoints
- `server/src/services/*`: reuse parsing/generation services as needed
- `server/cache/exports/`: local dev artifact cache

Routing/deploy:
- `vercel.json`: add `/play` → `/play.html` similar to `/embed`

## Test plan
- Desktop:
  - Share from main app → open `/play?...` in new tab → loads → plays after click
  - Copy link works; X intent opens with correct URL
- iOS Safari:
  - `/play` shows Enable Audio when needed
  - Tap Enable Audio → tap Play → sound
- Export flow:
  - Export MIDI variant → receive `/play?m=...` → plays the exported MIDI reliably
  - Export audio variant (if implemented) → `/play?a=...` → plays reliably

## Success criteria
- A shared link reliably recreates “the thing” (preview or exported variant) and is playable with one tap.
- The system remains safe under abuse (no open proxy behavior, bounded cost).

