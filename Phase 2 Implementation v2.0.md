# Wario Synth v2: Phase 2 Implementation Plan

**Project:** Wario Synthesis Engine v2  
**Owner:** Andy @ birdmania  
**Status:** Implementation Phase  
**Target:** Game Boy-authentic MIDI conversion with enhanced polyphony  
**Repository:** https://github.com/b1rdmania/motif

---

## Project Overview

Build a Game Boy-authentic synthesis engine (v2) that captures the true DMG-CPU sound chip character while preserving v1's "any MIDI works" philosophy. The v2 engine will be hosted separately and won't intrude on v1's functionality.

**Key Architecture Decision:** 8-channel "Super Game Boy" setup (4 pulse, 2 wave, 2 noise) instead of authentic 4-channel limitation. This preserves GB sound character while handling complex MIDI files gracefully.

---

## Critical Constraint: v1 Isolation

**v1 MUST remain completely untouched and functional throughout v2 development.**

### What stays UNTOUCHED (v1):

- `src/synthesis/SynthesisEngine.ts` - current engine, no changes
- `src/core/MotifEngine.ts` - current orchestration, no changes
- All existing files in `src/` - completely untouched
- `index.html`, `play.html`, `embed.html` - no modifications
- Live site at wario.style continues to work exactly as today

### What gets CREATED (v2):

- Brand new directory: `src-v2/` - entirely separate codebase
- New entry point: `v2.html` - doesn't touch existing HTML files
- Separate Vite build config if needed
- Could become separate repo later if desired

### What v2 CAN import (read-only):

- `src/midi/MIDIParser.ts` - reuse existing MIDI parsing
- Shared types from `src/types/index.ts` if compatible
- Nothing else - all synthesis code is fresh

### Benefits of this approach:

1. Develop v2 while v1 stays live and stable
2. If v2 has issues, v1 is completely unaffected
3. A/B test with simple URL switch (`/` vs `/v2`)
4. Rollback is trivial - just don't deploy v2 code
5. Can eventually merge or keep separate forever

---

## Repository Structure

```
/Users/andy/MOTIF/
├── src/                          # v1 (current, unchanged)
│   ├── core/MotifEngine.ts
│   ├── synthesis/SynthesisEngine.ts
│   └── ...
├── src-v2/                       # v2 (NEW - separate tree)
│   ├── audio/
│   │   ├── apu/
│   │   │   ├── APU.ts           # Main 8-channel coordinator
│   │   │   ├── PulseChannel.ts  # GB pulse with duty cycles
│   │   │   ├── WaveChannel.ts   # 4-bit wavetable
│   │   │   ├── NoiseChannel.ts  # LFSR noise
│   │   │   └── Mixer.ts         # Stereo mixing
│   │   ├── synthesis/
│   │   │   ├── DutyCycle.ts     # 4 GB duty patterns
│   │   │   ├── LFSR.ts          # Noise generator
│   │   │   ├── WaveTable.ts     # 4-bit quantization
│   │   │   └── FrequencyCalc.ts # GB frequency formulas
│   │   └── midi/
│   │       ├── TrackAnalyzer.ts # Analyze MIDI structure
│   │       ├── ChannelMapper.ts # Assign tracks to 8 channels
│   │       └── Arpeggiator.ts   # Convert chords to arps
│   ├── core/
│   │   └── GameBoyPlayer.ts     # Main v2 entry point
│   └── types/
│       └── index.ts             # v2-specific types
├── public/
│   └── v2/                       # v2 UI assets
└── v2.html                       # v2 demo page
```

---

## Phase 1: Core Sound Engine (Week 1-2)

**Goal:** Implement authentic GB sound generation with Web Audio API

### 1.1 Duty Cycle Implementation

Create `src-v2/audio/synthesis/DutyCycle.ts`:

- Define 4 GB duty patterns (12.5%, 25%, 50%, 75%)
- Convert patterns to `PeriodicWave` for Web Audio
- Pattern format: 8-step arrays `[0,0,0,0,0,0,0,1]` etc

Create `src-v2/audio/apu/PulseChannel.ts`:

- Pre-create all 4 duty waveforms on init
- `playNote(midiNote, duration, velocity)` method
- Use GB frequency formula (not standard MIDI)
- Simple envelope (fast attack, quick release)
- Return `{ osc, gain }` for cleanup

**Success Criteria:** Each duty cycle sounds distinctly different when tested

### 1.2 GB Frequency Formulas

Create `src-v2/audio/synthesis/FrequencyCalc.ts`:

- `calculatePulseFrequency(midiNote)` → Hz
  - Formula: `131072 / (2048 - registerValue)`
  - Convert MIDI → standard freq → register → GB freq
- `calculateWaveFrequency(midiNote)` → Hz
  - Formula: `65536 / (2048 - registerValue)`
- `calculateNoiseFrequency(pitch, mode)` → Hz
  - Formula: `524288 / divisor / 2^(shift+1)`

**Success Criteria:** Frequencies are slightly "off" from standard tuning (GB characteristic)

### 1.3 LFSR Noise Generator

Create `src-v2/audio/synthesis/LFSR.ts`:

- Implement 15-bit LFSR (default mode)
- Implement 7-bit LFSR (tonal mode)
- `clock()` method returns 0 or 1
- XOR bits 0 and 1, shift right, set bit 14

Create `src-v2/audio/apu/NoiseChannel.ts`:

- `playNoise(duration, frequency, velocity)` method
- Generate buffer with LFSR output
- Clock LFSR at calculated rate
- Apply envelope to buffer playback

**Success Criteria:** Noise sounds crunchy/metallic, not smooth white noise

### 1.4 Wave Channel with 4-bit Quantization

Create `src-v2/audio/synthesis/WaveTable.ts`:

- Store 32 samples × 4-bit (0-15 values)
- `quantize(value)` rounds to 4-bit
- Presets: `generateBass()`, `generatePad()`, `generateLead()`
- `createBuffer(audioContext)` converts to AudioBuffer

Create `src-v2/audio/apu/WaveChannel.ts`:

- Load wavetable on construction
- `playNote(midiNote, duration, velocity)` method
- Use `BufferSource` with looping
- Set playback rate for pitch
- Volume levels: 0, 100%, 50%, 25% (bit-shift style)

**Success Criteria:** Wave channel has audible digital "staircase" effect

### 1.5 Testing Phase 1

Create `src-v2/audio/test/soundTest.ts`:

- Test all 4 duty cycles sequentially
- Test wave channel with bass preset
- Test both noise modes (7-bit and 15-bit)
- Play test sequence: duty sweeps, bass note, drum hits

---

## Phase 2: Channel Manager & 8-Channel APU (Week 2-3)

**Goal:** Coordinate 8 independent GB channels with mixing

### 2.1 APU Coordinator

Create `src-v2/audio/apu/APU.ts`:

- Initialize 4 pulse, 2 wave, 2 noise channels
- Channel IDs: `p1-p4`, `w1-w2`, `n1-n2`
- Master gain connected to destination
- Per-channel gain nodes for mixing
- `scheduleNote(note: ChannelNote)` routes to appropriate channel
- Track which channels are busy (`channelBusy` map)
- `isChannelFree(channelId, atTime)` for voice allocation

**Key Methods:**

- `scheduleNote({ channel, midiNote, startTime, duration, velocity })`
- `schedulePulseNote()`, `scheduleWaveNote()`, `scheduleNoiseNote()`
- `setChannelPan(channelId, pan)` for stereo

### 2.2 Channel Gain & Mixing

In `src-v2/audio/apu/APU.ts`:

- Each channel connects to individual `GainNode`
- Individual gains connect to master gain
- Master gain at ~0.7 to prevent clipping
- Per-channel volumes match role importance

**Success Criteria:** Can play 8 simultaneous notes without clipping

### 2.3 Integration Test

Create `src-v2/audio/test/apuTest.ts`:

- Schedule notes on all 8 channels simultaneously
- Verify no audio glitches or pops
- Test channel busy/free logic
- Test master volume control

---

## Phase 3: MIDI Intelligence Layer (Week 3-4)

**Goal:** Smart track analysis and channel assignment for arbitrary MIDIs

### 3.1 Track Analyzer

Create `src-v2/audio/midi/TrackAnalyzer.ts`:

- `analyzeTrack(track)` returns `TrackAnalysis`
- Detect drums (channel 9 or percussive patterns)
- Calculate note range (min, max, avg pitch)
- Calculate note density (notes per second)
- Detect chords (simultaneous notes)
- Assign role: `drums`, `bass`, `lead`, `harmony`, `pad`, `fx`

**Analysis Logic:**

- Drums: channel 9 OR very short notes with low pitch variation
- Bass: average pitch < 48 (C3)
- Lead: high pitch (>72) with high density (>5 notes/sec)
- Pad: low density (<2 notes/sec), long notes
- Harmony: medium density with detected chords
- FX: very high density (>10 notes/sec)

### 3.2 Arpeggiator

Create `src-v2/audio/midi/Arpeggiator.ts`:

- `arpeggiate(notes, speed)` converts chords to fast note sequences
- Group notes by time (10ms tolerance)
- Single notes pass through unchanged
- Chords (2+ simultaneous notes) → fast arpeggio
- Default speed: 1/64 note
- Sort chord notes low-to-high
- Cycle through chord notes for full duration

**Success Criteria:** 3-note chord becomes smooth fast arpeggio

### 3.3 Channel Mapper

Create `src-v2/audio/midi/ChannelMapper.ts`:

- `mapTracks(midiTracks)` returns array of `ChannelAssignment`
- Analyze all tracks first
- Sort by priority (drums > bass > lead > harmony)
- Assign intelligently:
  - Drums → `n1`, `n2` (noise channels)
  - Bass → `w1` (wave bass preset)
  - Pads → `w2` (wave pad preset)
  - Lead → `p1`, `p2` (pulse with sweep, 50% duty)
  - Harmony → `p3`, `p4` (pulse, 25% duty, arpeggiated)
- Mark which tracks need arpeggiator
- Specify duty cycle per assignment

**Priority Calculation:**

- Drums +30 points
- Bass +25 points
- Lead +20 points
- Note density +up to 20 points
- Velocity +up to 10 points

**Success Criteria:** Mario theme maps melody to pulse, no bass assigned (no bass in song)

### 3.4 Integration Test

Create `src-v2/audio/test/mapperTest.ts`:

- Load test MIDI (simple melody + bass + drums)
- Run through analyzer and mapper
- Verify drum tracks → noise channels
- Verify bass → wave channel
- Verify melody → pulse channel
- Print channel assignments for inspection

---

## Phase 4: Main Player & Integration (Week 4)

**Goal:** Complete end-to-end MIDI → GB audio pipeline

### 4.1 Game Boy Player

Create `src-v2/core/GameBoyPlayer.ts`:

- Main entry point for v2 engine
- `async playMIDI(midiBuffer: ArrayBuffer)`
- Parse MIDI using existing `src/midi/MIDIParser.ts`
- Analyze tracks → assign channels → convert to GB notes
- Schedule all notes in APU
- `stop()` method resets APU
- Return playback info (duration, assignments for UI)

**Pipeline:**

1. Parse MIDI → `NoteEvent[]`
2. Analyze tracks → `TrackAnalysis[]`
3. Map to channels → `ChannelAssignment[]`
4. Apply arpeggiator where needed
5. Convert to `ChannelNote[]` format
6. Schedule in APU

### 4.2 V2 Types

Create `src-v2/types/index.ts`:

- `ChannelNote` interface
- `ChannelAssignment` interface
- `TrackAnalysis` interface
- `ArpNote` interface
- GB-specific config types

### 4.3 Demo Page

Create `v2.html`:

- Simple test UI for v2 engine
- File upload input for MIDI
- Play/stop buttons
- Volume slider
- Display channel assignments
- Show which channels are active (visual)

Create `src-v2/main.ts`:

- Wire up UI to `GameBoyPlayer`
- Handle file uploads
- Display playback state
- Show assignment information

### 4.4 Integration Test

Test with reference MIDIs:

- **Mario theme:** Simple melody (should use p1)
- **Tetris theme:** Bass + lead (should use w1 + p1)
- **Pokémon theme:** Chords (should arpeggiate to p3/p4)
- **Hotel California:** Complex (use all 8 channels)

**Success Criteria:**

- All test MIDIs sound recognizable
- No audio glitches or pops
- Drums sound punchy (noise)
- Bass sounds solid (wave)
- Melody is clear (pulse)
- Chords arpeggiate smoothly

---

## Phase 5: Polish & Optimization (Week 5)

### 5.1 Performance Optimization

In `src-v2/audio/apu/APU.ts`:

- Limit simultaneous notes to 32 total
- Implement voice stealing (oldest note first)
- Add `onended` cleanup for oscillators
- Pre-create reusable nodes where possible

### 5.2 Browser Compatibility

In `src-v2/core/GameBoyPlayer.ts`:

- Add AudioContext resume on user interaction
- Handle Safari audio quirks
- Add mobile audio unlock
- Test on Chrome, Firefox, Safari

### 5.3 Advanced Features (Nice-to-Have)

- **Stereo Panning:** GB-style hard L/R/center per channel
- **Duty Cycle Switching:** Change duty mid-playback for variation
- **Custom Wavetables:** User-editable wave presets
- **Export to WAV:** Offline rendering to downloadable file

---

## Phase 6: Deployment Strategy

### 6.1 Alpha Testing (Week 6)

- Deploy v2 to staging URL (e.g., `v2.wario.style` or `wario.style/beta`)
- Keep v1 at main URL unchanged
- Test with small group (5-10 people)
- Gather feedback on authenticity
- Fix critical bugs

### 6.2 Beta Release (Week 7)

- Deploy to production behind feature flag
- Add "Try v2 Beta" button on main site
- A/B test user preferences (v1 vs v2)
- Monitor performance metrics
- Gradual rollout: 10% → 50% → 100%

### 6.3 Full Release (Week 8)

- Make v2 the default engine
- Keep v1 available as "Classic Mode"
- Update README and docs
- Social media announcement
- Monitor error rates and feedback

**Rollback Plan:**

- Feature flag can instantly revert to v1
- Maintain "problematic MIDI" database
- User preference saved in localStorage

---

## Technical Notes

### Web Audio Implementation

**Key Web Audio APIs:**

- `PeriodicWave` for duty cycles
- `OscillatorNode` for pulse channels
- `AudioBufferSourceNode` for wave/noise
- `GainNode` for volume/envelopes
- `audioContext.currentTime` for precise scheduling

**Memory Management:**

```typescript
source.onended = () => {
  source.disconnect()
  gain.disconnect()
}
```

**Latency Target:** <50ms from schedule to sound

### What Matters vs What Doesn't

**✅ CRITICAL (Implement):**

- Exact duty cycle patterns
- LFSR noise generation
- 4-bit wave quantization
- GB frequency formulas
- Fast arpeggios
- Simple envelopes

**❌ SKIP (Emulator minutiae):**

- Length counter edge cases
- DIV-APU timing sync
- Wave RAM corruption bugs
- Sweep overflow quirks
- DAC pop suppression
- High-pass filter modeling

---

## Testing Strategy

Testing follows a layered approach - technical specs for implementation correctness, community feedback for authenticity.

### Layer 1: Technical Sanity Checks (Automated, Quick)

Quick checks that catch implementation bugs:

- **Waveform visualization** - view duty cycles in browser dev tools or canvas oscilloscope
- **LFSR sequence verification** - first 20 values match known GB sequence
- **Frequency spot-check** - play A4 (440Hz), verify it's slightly off (~438.5Hz due to GB register rounding)

Setup time: ~30 minutes. Run on every build.

### Layer 2: Reference MIDI Corpus (Manual, Essential)

Core QA loop with 5 test MIDIs:

| MIDI | What it tests |
|------|---------------|
| Mario Bros theme | Simple melody on pulse channels |
| Tetris theme | Bass + lead separation |
| Pokemon battle music | Chord arpeggiation |
| Any pop song with drums | Noise channel percussion |
| Hotel California | Complex multi-track mapping |

Process: Run each through v2, listen with headphones, note what sounds wrong.

### Layer 3: Community Vibe Check (Subjective, Final)

Post short clips to:

- r/chiptunes subreddit
- Chiptune Café Discord

Ask: "Does this sound like a Game Boy?"

Real chiptune people will identify specific issues ("duty cycles wrong", "noise too clean", etc.)

### What to Skip

- Automated audio comparison (too complex, diminishing returns)
- Cycle-accurate timing tests (emulator territory, not our goal)
- Formal A/B studies (overkill for this project)

### Success Metrics

- All Layer 1 checks pass
- All 5 reference MIDIs sound recognizable
- Community feedback: "yes, sounds like GB"
- Zero audio glitches or pops
- Works on Chrome, Firefox, Safari
- <100ms latency

---

## File Checklist

### Core Sound Engine (Phase 1)

- [ ] `src-v2/audio/synthesis/DutyCycle.ts`
- [ ] `src-v2/audio/synthesis/FrequencyCalc.ts`
- [ ] `src-v2/audio/synthesis/LFSR.ts`
- [ ] `src-v2/audio/synthesis/WaveTable.ts`
- [ ] `src-v2/audio/apu/PulseChannel.ts`
- [ ] `src-v2/audio/apu/WaveChannel.ts`
- [ ] `src-v2/audio/apu/NoiseChannel.ts`
- [ ] `src-v2/audio/test/soundTest.ts`

### APU & Mixing (Phase 2)

- [ ] `src-v2/audio/apu/APU.ts`
- [ ] `src-v2/audio/apu/Mixer.ts`
- [ ] `src-v2/audio/test/apuTest.ts`

### MIDI Intelligence (Phase 3)

- [ ] `src-v2/audio/midi/TrackAnalyzer.ts`
- [ ] `src-v2/audio/midi/Arpeggiator.ts`
- [ ] `src-v2/audio/midi/ChannelMapper.ts`
- [ ] `src-v2/audio/test/mapperTest.ts`

### Integration (Phase 4)

- [ ] `src-v2/core/GameBoyPlayer.ts`
- [ ] `src-v2/types/index.ts`
- [ ] `src-v2/main.ts`
- [ ] `v2.html`

### Documentation

- [ ] `docs/GB_SOUND_SPECS.md` (technical reference)
- [ ] `docs/V2_ARCHITECTURE.md` (system overview)
- [ ] `CHANGELOG_V2.md` (version history)

---

## Future Enhancements (v3+)

**Short Term:**

- User-adjustable duty cycles via UI
- Custom wavetable editor
- Real-time parameter tweaking
- Oscilloscope visualizer
- MIDI file upload (not just search)

**Medium Term:**

- Frequency sweep on pulse channels
- Vibrato effects
- Echo/delay using note repeats
- Better envelope shaping (ADSR editor)
- Recording/export to WAV

**Long Term:**

- Full tracker-style sequencer
- Multiple retro chips (NES APU, C64 SID)
- VST plugin version
- Mobile app with touch controls
- Collaborative editing

---

**Document Version:** 2.0  
**Last Updated:** January 2026  
**Status:** Ready for implementation
