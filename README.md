# Wario Synthesis Engine 8-Bit Midi

![Wario Synth Logo](public/wariosynthlogo.png)

Turn any song into a Game Boy version.

## Live Demo

**[www.wario.style](https://www.wario.style)**

## About

WARIO SYNTH is a fun experiment in **music-as-code**: it treats MIDI as structural data, not audio. Search for any song, pick a MIDI source, and the Wario Synthesis Engine analyses the MIDI structure and resynthesises it using Web Audio oscillators tuned to mimic the Game Boy's 4-channel sound chip.

- **Two pulse wave channels** for melody and harmony
- **One wave channel** for bass
- **One noise channel** for percussion

All processing runs client-side in your browser - no server-side audio generation.

![Wario](public/wario-sprite.png)

## Features

- **MIDI search** from BitMidi and other sources
- **Browser playback** with soundfont piano preview
- **Wario Synthesis Engine**: procedural Game Boy-style synthesis from parsed MIDI structure
- **Share links** with dynamic social previews
- **Works on mobile** (iOS audio unlock included)

## Quick Start (Local)

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

## How It Works

1. User searches for a song
2. Backend searches MIDI sources and returns ranked candidates
3. User picks a MIDI source
4. Frontend parses MIDI into normalized note events
5. Wario Synthesis Engine maps tracks to Game Boy sound channels
6. Web Audio oscillators generate the retro sound

## Embed Widget

WARIO SYNTH includes an embeddable widget at **`/embed`**:

```html
<iframe
  src="https://www.wario.style/embed?song=Hotel%20California"
  width="420"
  height="260"
  style="border:0;border-radius:12px;overflow:hidden"
  allow="autoplay"
></iframe>
```

## Tech Stack

- **Frontend**: TypeScript, Vite, Web Audio API
- **Backend**: Express, Node.js
- **Deployment**: Vercel
- **Built with**: Claude Code

## Credits

A non-commercial project by [@b1rdmania](https://x.com/b1rdmania) for lols. Please don't sue me.

![Wario Moment](public/wario.png)
