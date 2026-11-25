# Changelog

All notable changes to [Wario Synth](https://www.wario.style/) are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- Guide page links moved from the home page footer into the FAQ under "More".

### Fixed
- Search box on phones: it was squeezed to about 50px wide. The search row now wraps on its own, so the box takes the full row and the buttons sit below it. Desktop is unchanged.
- `/models` lab page no longer scrolls sideways on phones.
- Hover effects now apply only to a mouse or trackpad, so a tap no longer leaves a button stuck in its hover look.
- On touch screens every button and link is at least 44px, including the FAQ button, Version History, footer links, guide page links, the /play buttons, the progress bar, the embed controls and the 404 page. Desktop sizes are unchanged.
- Links and table rows show press feedback on tap.

## [2.1.0] - 2026-11-25

### Added
- **Top played this month** on the home page: the ten songs with the most plays in the last 30 days. Click a song to load it. The chart shows when at least three songs have plays, and it is cached for 10 minutes.
- **Usage stats.** The site counts searches (with the number of results), plays, WAV saves, shares (Copy link or X) and opens from shared links or the chart. Events go to `POST /api/e` and are stored in the Cloudflare D1 database `wario-stats`. `GET /api/top` serves the chart. Run `npm run stats` (or `npm run stats -- 7`) to see top songs, top searches, searches with no results and most shared songs.
- FAQ entry "What do you count?".

### Privacy
- No accounts, cookies or IP addresses. Each event has a visitor key: an HMAC of IP and user agent, keyed with a secret and the UTC day. The key changes every day, so it cannot link a visitor across days. Uploaded files are counted as plays, without a name.
- A play counts once per visitor, per song, per day, so replays and reloads do not move the chart.
- The Worker accepts events only from the site's own origin. A failed event never affects the player.

### Changed
- Hosting moved from Vercel to Cloudflare Workers. Short share links moved from Redis to Workers KV. The MIDI proxy now checks every redirect hop against the SSRF rules.
- `.html` page URLs and `/v2` now permanently redirect (301) to their clean URLs. `/v2` is removed from the sitemap.
- Updated MIDI converter and online synth pages for the current player and 30-second WAV exports.
- Added a Game Boy music-maker guide, internal links and sitemap entry.

## [2.0.0] - 2026-10-12

### Changed
- Unified Wario Synth at `/`: Game Boy synthesis with the existing search, local upload, original MIDI preview, and player interface.
- Replaced the engine tabs and Generate step with “Play 8-bit version”.
- New shares open the unified player. `/v2` and `/v2.html` preserve query parameters when redirecting; existing `/play`, short links, and embeds retain their original engine.
- Audio downloads are explicitly labelled as up-to-30-second WAV clips. MIDI export has been removed from the main page.
- Main production typechecking now covers the imported Game Boy engine.

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

[2.1.0]: https://github.com/b1rdmania/motif/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/b1rdmania/motif/releases/tag/v2.0.0
