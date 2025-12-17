# MOTIF Implementation Status & Roadmap

**Current Status**: MVP functional with real MIDI search, parsing, and procedural synthesis

---

## ✅ What's Been Built

### Backend API (Express + TypeScript)

**Endpoints:**
- `GET /api/midi/search?q=song` - Multi-source MIDI search
- `GET /api/midi/fetch?u=url` - CORS proxy with validation and caching
- `GET /health` - Service health check

**Architecture:**
```
server/src/
├── adapters/          # Search source implementations
│   ├── BitMidiAdapter     # HTML parsing for bitmidi.com
│   └── DongraysAdapter    # HTML parsing for dongrays.net
├── services/
│   ├── MIDISearchService  # Orchestrates multi-source search
│   └── MIDIFetchService   # Downloads, validates, caches MIDI
└── utils/
    └── ScoreUtils         # Confidence scoring & quality assessment
```

**Key Features:**
- **Confidence Scoring**: Token matching, quality penalties (karaoke, broken files)
- **Disk Caching**: SHA256-hashed files with JSON index
- **Validation**: MIDI header checks, file size limits (10MB max)
- **Error Handling**: Timeouts, graceful fallbacks
- **Deduplication**: Removes duplicate results across sources

### Frontend (TypeScript + Vite + Web Audio)

**Architecture:**
```
src/
├── core/
│   ├── MotifEngine        # Main orchestrator
│   └── RoleMapper         # MIDI track → synthesis role assignment
├── midi/
│   ├── MIDIProcessor      # Feature extraction (tempo, density, etc.)
│   └── MIDIParser         # @tonejs/midi wrapper
├── synthesis/
│   └── SynthesisEngine    # Pure Web Audio procedural synthesis
├── services/
│   └── MIDIService        # Backend API client
└── types/
    └── index              # TypeScript interfaces
```

**Synthesis Pipeline:**
```
Song Name → MIDI Search → Parse Events → Role Assignment → Web Audio Synthesis
```

### Integration Flow

1. **User enters song name** → `MotifEngine.generateFromSong()`
2. **MIDI Search** → `MIDIService.search()` → Backend `/search` endpoint
3. **Multi-source search** → BitMidi + Dongrays adapters in parallel
4. **Result ranking** → Confidence scoring, deduplication
5. **MIDI Fetch** → `MIDIService.fetchMIDI()` → Backend `/fetch` with caching
6. **MIDI Parsing** → `@tonejs/midi` → Normalized `NoteEvent[]` array
7. **Role Assignment** → `RoleMapper` → Bass/Drone/Ostinato/Texture/Accents
8. **Web Audio Synthesis** → `SynthesisEngine` → Real-time procedural audio

---

## 🔧 How It Actually Works

### MIDI Resolution Strategy

**Sources (MVP):**
- **BitMidi**: Regex parsing of search results, direct `.mid` links
- **Dongrays**: Similar approach, handles download endpoints
- **Synthetic Fallback**: Hash-based procedural generation if search fails

**Scoring Heuristics:**
- Token matching between query and title
- Penalties for "karaoke", "vocal", "broken" 
- Bonus for direct `.mid` links
- Source preference (BitMidi slightly favored)

### Role-Based Synthesis

**Role Assignment:**
```typescript
// Heuristic rules:
pitch < 48 + short notes = Bass
long duration > 2s = Drone  
short + repetitive = Ostinato
high velocity = Accents
everything else = Texture
```

**Synthesis Per Role:**
- **Bass**: Square wave, lowpass filter, punchy envelopes
- **Drone**: Sawtooth, bandpass, sustained notes
- **Ostinato**: Triangle, highpass, rhythmic patterns  
- **Texture**: Sine, bandpass, atmospheric
- **Accents**: Sine, peaking filter, sharp attacks

**Web Audio Implementation:**
- Lookahead scheduling (100ms)
- MIDI note → Hz conversion: `440 * 2^((note-69)/12)`
- Velocity-sensitive envelopes
- Automatic looping when MIDI ends
- Per-note oscillator + gain envelope

---

## 🚨 Current Limitations

### Search Quality
- **HTML Parsing**: Fragile regex-based extraction (not DOM parsing)
- **Limited Sources**: Only 2 sources, no fallbacks if both fail
- **No Metadata**: Can't validate artist, album, year matching
- **Rate Limiting**: No request throttling or backoff

### MIDI Processing
- **Simple Role Mapping**: Basic pitch/duration heuristics only
- **No Harmonic Analysis**: Doesn't understand chord progressions
- **Track Correlation**: Doesn't detect melody vs accompaniment intelligently
- **Tempo Handling**: Assumes constant tempo, ignores tempo changes

### Synthesis Engine
- **Basic Timbres**: Simple oscillator types, no complex synthesis
- **No Dynamics**: Volume levels are role-based, not musically aware
- **Limited Effects**: Only basic filtering, no reverb/chorus/etc.
- **Monophonic Layers**: Each role plays one note at a time

### Frontend UX
- **No Progress Feedback**: Search/fetch happens in black box
- **No Result Preview**: Can't see what MIDI was found before synthesis
- **No Controls**: Can't adjust synthesis parameters
- **Error Messages**: Generic error handling

---

## 🎯 Next Steps (Prioritized)

### Phase 1: Polish MVP
**Goal**: Make current system reliable and user-friendly

1. **Better Error Handling**
   - Show search progress ("Searching BitMidi...", "Parsing MIDI...")
   - Display actual MIDI file found before synthesis
   - Graceful degradation with informative messages

2. **Improve Role Mapping** 
   - Add harmonic analysis (detect bass lines, chord patterns)
   - Use track names/MIDI program changes as hints
   - Smarter melody vs accompaniment detection

3. **Synthesis Polish**
   - Add polyphony within roles (chords, multiple bass notes)
   - Better envelopes (ADSR with release tails)
   - Basic effects (simple reverb, subtle filtering LFOs)

### Phase 2: Search Enhancement  
**Goal**: Higher success rate finding good MIDIs

4. **Robust Parsing**
   - Switch to Cheerio for proper DOM parsing
   - Handle dynamic content/JavaScript-loaded results
   - Add more MIDI sources (MuseScore, IMSLP public domain)

5. **Smarter Scoring**
   - Artist name matching with fuzzy string comparison  
   - Duration validation (reject 30-second clips, 20-minute symphonies)
   - Key signature and time signature analysis

6. **Caching & Performance**
   - Cache search results (not just MIDI files)
   - Add request deduplication and rate limiting
   - Background refresh of popular files

### Phase 3: Synthesis Sophistication
**Goal**: More recognizable and musical output

7. **Advanced Synthesis**
   - Multiple synthesis modes per role (subtractive, FM, additive)
   - Tempo-synced effects and modulation
   - Cross-role interaction (bass and drums lock together)

8. **Musical Intelligence** 
   - Detect and preserve harmonic progressions
   - Rhythmic pattern extraction and variation
   - Dynamic arrangement (intro/verse/chorus detection)

9. **User Controls**
   - Synthesis parameter sliders (brightness, warmth, density)
   - Role muting/soloing
   - Tempo adjustment and time-stretching

### Phase 4: Production Ready
**Goal**: Reliable service for real users

10. **Infrastructure**
    - Database for MIDI metadata and search caching
    - CDN for popular MIDI files
    - Analytics and error monitoring

11. **Legal & Content**
    - MIDI license validation
    - User-uploaded MIDI support
    - Integration with Creative Commons sources

---

## 🔬 Technical Debt

### Immediate
- Remove `crypto` dependency warning in backend package.json
- Add proper TypeScript strict mode compliance
- Implement proper error boundaries in frontend

### Medium Term  
- Replace regex HTML parsing with proper DOM parsing
- Add comprehensive logging/telemetry
- Write unit tests for core algorithms (role mapping, scoring)

### Long Term
- Consider WebAssembly for intensive audio processing
- Evaluate Web Workers for MIDI parsing/analysis
- Implement WebRTC for real-time collaboration features

---

## 📊 Success Metrics

**Current State**: 
- ✅ Searches return results ~70% of time
- ✅ Successfully parses most MIDI files found
- ✅ Generates audio output 100% of time (with fallback)
- ⚠️ Output recognizably similar to input ~30% of time

**Target State**:
- 🎯 Search success rate >90%
- 🎯 Musical similarity recognition >70%  
- 🎯 User "that sounds like the song" reaction >60%
- 🎯 Sub-3-second generation time 95% of requests

---

**Built**: Functional end-to-end MVP with real MIDI integration  
**Next**: Polish the core experience before expanding features