# MOTIF — Aims, Scope, and Guidelines (for AI agents)

## Aims (what we’re trying to achieve)
- **Primary aim (MVP)**: Let a user search any song name, find real MIDI files online, **load one**, and **play it back in-browser** in a way that feels like a proper MIDI performance.
- **Secondary aim (next step)**: From the same MIDI, generate a **similar-but-different** “Motif” version and play that.
- **Future aim (later)**: Add stylistic transforms (“more ominous”, “dance/remix”), controls, and improved musical intelligence.

## Scope (what is in-bounds right now)
- **Search + ranking** of MIDI candidates from multiple sources
- **Fetch + validate + cache** MIDI bytes via the backend
- **Parse** MIDI and show basic metadata (duration, track count, issues)
- **Playback of the fetched MIDI** (this is the current priority)
- Keep Motif generation working, but don’t block MVP playback on it

## Non-scope (avoid for now)
- Perfect matching/similarity, chord/key analysis, advanced arrangement
- Big infra (DB/CDN/monitoring/analytics), large refactors
- New features unrelated to search/fetch/parse/playback reliability

## Guidelines (how to work in this repo)
- **Bias toward real MIDI**: don’t silently replace real results with synthetic/mock in the default user path.
- **Make degradation explicit**: if mock/synthetic is used, it must be clearly indicated (UI/logs).
- **Keep changes incremental**: prioritize reliable end-to-end playback over architecture rewrites.
- **Respect browser audio constraints**: playback must work with autoplay policies (user gesture → resume AudioContext).
- **Add practical observability**: when fixing issues, add minimal logs/errors that explain which step failed (search vs fetch vs parse vs playback).
- **Definition of done for any PR**:
  - Search returns results for common queries
  - Selecting a result fetches bytes successfully (or shows a clear error)
  - Playback starts/stops reliably without breaking subsequent plays

## “Done means demo-able”
A change is successful if someone can:
- search “Hotel California”
- select a result
- hit Play and hear it
- hit Stop and try another result
