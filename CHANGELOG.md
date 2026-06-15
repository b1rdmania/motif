# Changelog

All notable changes to [Wario Synth](https://www.wario.style/) are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
