# WARIO SYNTH

Turn any song into retro game console music using the Wario Synthesis Engine.

WARIO SYNTH is a small experiment in **music-as-code**: treat MIDI as structural data, not audio. It pulls MIDI patterns from the web, plays the original performance, then generates a retro Gameboy-style procedural version using the Wario Synthesis Engine and Web Audio.

## About

- **What it does**: Search songs → pick a result → play the original MIDI → generate retro game console music with the Wario Synthesis Engine.
- **Why it's fun**: It's like "hear a MIDI version of anything", then transform it into classic chiptune-style audio.
- **Status**: Working locally end-to-end. Hosted frontend exists, backend hosting may be separate depending on deployment.

## Live demo

- **Frontend**: `https://motif-46uf00ypw-boom-test-c54cde04.vercel.app`

Note: if the backend isn’t deployed/configured for the demo environment, search/fetch won’t work from the hosted URL. Run locally for the full experience.

## Use on your website (embed)

WARIO SYNTH includes an embeddable widget page at **`/embed`**. It generates audio in the user's browser (no audio files needed).

Example:

```html
<iframe
  src="https://YOUR_DOMAIN/embed?song=Hotel%20California"
  width="420"
  height="260"
  style="border:0;border-radius:12px;overflow:hidden"
  allow="autoplay"
></iframe>
```

### Embed parameters (v1)
- **`song`**: the query to load (e.g. `Hotel%20California`)\n+- **`volume`**: preview volume `0..1` (optional)\n+- **`motifVolume`**: motif volume `0..1` (optional)

Notes:\n- Autoplay is best-effort; iOS/Safari requires a user gesture before sound.\n
## Features

- **MIDI search** (currently BitMidi; additional sources optional)
- **MIDI fetch + validation + caching** via an Express backend
- **Browser playback** with multiple engines:
  - Tone.js sampled piano
  - Soundfont piano
  - Custom WebAudio synth preview
- **Wario Synthesis Engine**: role-based synthesis (bass / drone / ostinato / texture / accents) from parsed MIDI structure

## Quick start (local)

```bash
# Install frontend deps
npm install

# Install backend deps
cd server && npm install && cd ..

# Run backend (http://localhost:3001)
npm run dev:backend

# Run frontend (Vite prints the URL, typically http://localhost:5173)
npm run dev
```

## How it works (pipeline)

1. User searches for a song
2. Backend searches MIDI sources and returns ranked candidates
3. Backend fetches the selected `.mid`, validates it, and caches it
4. Frontend parses MIDI into normalized note events
5. User can:
   - **Play original MIDI** (soundfont/sampler playback), or
   - **Generate with Wario Synthesis Engine** (procedural Web Audio synthesis derived from structure)

## Backend API

- `GET /api/midi/search?q=song`
- `GET /api/midi/fetch?u=url` (URL must be encoded)
- `GET /api/midi/parse?u=url`
- `GET /health`

## Project structure

```
src/
├── core/           # MotifEngine, RoleMapper
├── midi/           # Parsing + feature extraction
├── services/       # Backend API client
├── synthesis/      # Players + procedural synthesis engine
└── types/          # TypeScript interfaces

server/
├── src/
│   ├── adapters/   # MIDI search adapters (sources)
│   ├── services/   # Search/fetch/parse
│   └── utils/      # Scoring, validation, MIDI helpers
└── cache/          # Downloaded MIDI cache (local dev)
```

## Roadmap

- **More sources**: add/replace flaky scrapers with more reliable sources
- **Better matching**: smarter ranking + metadata validation
- **Synthesis controls**: "more ominous", "more dancey", "more ambient", etc.
- **Deployment**: host backend and wire frontend to it via env config