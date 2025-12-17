# MOTIF

**Procedural Music Synthesis from MIDI Structure**

Motif extracts structural information from existing music and re-instantiates it as original, real-time audio using the Web Audio API. Music as executable structure, not static audio.

## Quick Start

```bash
# Install dependencies for both frontend and backend
npm install
cd server && npm install && cd ..

# Run both frontend and backend
npm run dev:all

# Or run separately:
npm run dev:backend  # Backend on :3001
npm run dev          # Frontend on :3000
```

## Architecture

- **Frontend**: TypeScript + Vite + Web Audio API
- **Backend**: Express API for MIDI search and fetching
- **MIDI Sources**: BitMidi, Dongrays (with synthetic fallback)
- **Synthesis**: Pure procedural Web Audio (no samples)

## How it works

1. Search for MIDI by song name
2. Extract structural features (tempo, density, roles)
3. Map to synthesis layers (bass, drone, ostinato, texture)
4. Generate original audio with similar "feel"

## Project Structure

```
src/
├── core/           # MotifEngine, RoleMapper
├── synthesis/      # Web Audio synthesis engine  
├── midi/           # MIDI parsing and processing
├── services/       # Backend API client
└── types/          # TypeScript interfaces

server/
├── src/
│   ├── adapters/   # MIDI search adapters
│   ├── services/   # Search and fetch logic
│   └── utils/      # Scoring and validation
└── cache/          # MIDI file cache
```

## API

- `GET /api/midi/search?q=song` - Search for MIDI files
- `GET /api/midi/fetch?u=url` - Fetch and validate MIDI

Built as a technical experiment in procedural audio and Web Audio capabilities.