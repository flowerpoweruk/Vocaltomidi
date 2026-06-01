# Vocal Stem → In-Key Chords

A zero-dependency, fully client-side mobile web tool. Upload an isolated **vocal
stem**, and it detects the sung melody, works out the key, builds a diatonic
chord progression that fits the melody, plays it back, and exports MIDI you can
drag straight into FL Studio.

Everything runs **in the browser** — no backend, no API keys, no uploads. The
whole app is a single static folder (`index.html` + `app.js`).

## How it works

1. **Decode** the audio (Web Audio `decodeAudioData`), downmix to mono, resample to 16 kHz.
2. **Pitch tracking** — an in-browser **YIN** detector (16 kHz, 256-sample hop,
   detection range 46.875–2093.75 Hz, matching the SwiftF0 conventions). A
   silence gate + confidence gate + median filter clean the contour.
3. **Note segmentation** — stable pitch runs become note events (≥90 ms, new
   note on >0.7-semitone moves), with vibrato smoothed rather than chopped.
4. **Key detection** — duration×confidence pitch-class histogram correlated
   against **Krumhansl-Schmuckler** major/minor profiles (24 candidates). A
   one-tap dropdown overrides the detected key and re-harmonizes.
5. **Harmonization** — per chord slot (1 or 2 per bar), pick a **diatonic**
   chord containing the strongest melody note, ranked by harmonic function and
   **smooth voice-leading** from the previous chord. *Reroll* picks the next-best
   candidates. Optional 7th chords.
6. **Export** — hand-rolled Standard MIDI File (format 1, 480 PPQ). Chords MIDI
   is the deliverable; Melody MIDI is a bonus single line.

> The harmonizer is deliberately rule-based and **modular** (`harmonize()` in
> `app.js`) so it can later be swapped for a serverless LLM harmonizer without
> touching the rest of the pipeline.

## Note on SwiftF0

The spec preferred SwiftF0 (ONNX). The build environment blocked the model/CDN
hosts, and an ONNX-runtime path adds a runtime CDN dependency that can break the
"static link that always works" requirement. So this ships the spec's sanctioned
**robust JS fallback** (YIN) — entirely self-contained, no CDN, no CORS, works
offline. Pitch accuracy was verified on synthetic vocals (exact melody recovery)
and via a full headless-browser end-to-end test.

## Run locally

Because it's fully static you can open `index.html` directly, or serve it:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Tests

```bash
node test.js          # pure DSP pipeline (pitch, key, harmony, MIDI validity)
# headless browser E2E lives in browser_test.js (needs a chromium binary)
```

## Deploy / redeploy (GitHub Pages)

The app is the repo root. To publish:

1. **Settings → Pages** → *Build and deployment* → Source: **Deploy from a branch**.
2. Branch: **`claude/vocal-stem-chords-tool-SLiS2`**, folder: **`/ (root)`** → **Save**.
3. Wait ~1 minute. Your live link will be:
   **https://flowerpoweruk.github.io/Vocaltomidi/**

To redeploy after edits: just commit and push to the same branch — Pages
rebuilds automatically.
