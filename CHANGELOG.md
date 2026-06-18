# Changelog

All notable changes to [Wario Synth](https://www.wario.style/) are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.7.1] - 2026-06-17

### Fixed
- **Clearer melodies, fuller mixes** in the procedural engine. Same-role tracks are now merged instead of overwriting each other (so a role's layer plays all its notes, not just the last), and a melody safeguard promotes the strongest lead candidate when no melody was assigned. Surgical: only affects files that were previously dropping tracks or had no clear lead. Thanks to [@joenb33](https://github.com/joenb33) ([#3](https://github.com/b1rdmania/motif/issues/3)) for the diagnosis and suggestions.

## [1.7.0] - 2026-06-17

### Added
- **v2 beta engine** — a new "v2 beta" tab offering an experimental engine that targets the actual Game Boy sound chip (Sharp LR35902): a real 15-bit/7-bit LFSR noise channel, pulse channels with proper duty cycles, and custom wavetables. v1 remains the default, polished engine; v2 is an honest work in progress with some low-mid distortion on the noise channels
- **Engine tabs** — switch between v1 and v2 from either page; the selected song carries across
- **Shareable v2 deep links** — `…/v2.html?id=<bitmidi>&title=…` (or `?q=<search>`) loads a song straight into the v2 engine

### Changed
- Extracted the shared design into a single stylesheet so v1 and v2 look identical
- v2 page mirrors v1's look and flow (search, pick, play, progress)

## [1.6.1] - 2026-06-16

### Fixed
- **Search restored on production** — MIDI search now runs entirely in the browser against BitMidi's CORS-enabled JSON API instead of a server-side HTML scrape, which BitMidi blocked from Vercel's datacenter IPs

### Changed
- Search, MIDI fetch, and metadata parsing now happen client-side (BitMidi serves both its search API and `.mid` files with open CORS); the server only proxies non-CORS MIDI fetches and mints share links
- Removed the dead server-side search path (BitMidi/Dongrays/FreeMidi/Mock adapters, the search service and endpoint) and two now-unused dependencies (`cheerio`, `midi-writer-js`)

## [1.6.0] - 2026-06-15

### Added
- **Local MIDI upload** — pick a `.mid` / `.midi` file from your device; parsed entirely client-side
- **Save Audio (WAV)** — download the generated Game Boy-style render after playback
- **Save MIDI** — export the generated motif as a MIDI file
- FAQ entries for upload, export, and why local uploads cannot be shared

### Changed
- Version history and in-app FAQ updated for the upload/export flow
- Offline export rendering caps note density on very busy MIDIs so exports stay reliable

### Notes
- **Sharing still works** for searched/online MIDI sources (Copy link, Share to X after Generate)
- Local uploads can be played, generated, and exported, but not shared — there is no online URL to link to
- Contributed by [@RobertAgee](https://github.com/RobertAgee) in [#2](https://github.com/b1rdmania/motif/pull/2)

## [1.5.0] - 2026-03-05

### Changed
- Playback polish and synthesis tweaks
- iOS audio unlock and mobile playback fixes
- Footer links (GitHub, b1rdmania, X)

## [1.4.0] - 2026-01-05

### Fixed
- 16-bit to 8-bit audio chain fixes
- Improved synthesis quality

## [1.3.0]

### Added
- Share to X
- Light Game Boy palette refresh
- iOS audio fixes
- Local font hosting

## [1.2.0]

### Added
- Short share links with dynamic previews
- Copy link button
- Improved MIDI source selection

## [1.1.0]

### Added
- MIDI search
- Game Boy-style generation and playback
- Basic progress bar

[1.6.0]: https://github.com/b1rdmania/motif/releases/tag/v1.6.0
[1.5.0]: https://github.com/b1rdmania/motif/compare/v1.5.0...v1.6.0
[1.4.0]: https://github.com/b1rdmania/motif/compare/v1.4.0...v1.5.0
