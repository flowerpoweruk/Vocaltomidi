/* =============================================================================
   Vocal Stem -> In-Key Chords
   Self-contained, zero-dependency DSP + music engine.

   This file runs in BOTH the browser (attaches helpers to window via the UI
   section guarded by `typeof window`) and Node (module.exports at the bottom,
   for the test harness). All pure-DSP functions are environment-agnostic.

   Pipeline:
     decode -> mono+resample 16k -> YIN pitch track -> median filter + gate
     -> note segmentation -> key detection (Krumhansl-Schmuckler)
     -> rule-based diatonic harmonization (voice-leading aware)
     -> Web Audio playback + MIDI export
   ============================================================================= */
(function (root) {
  'use strict';

  // ---- Constants -----------------------------------------------------------
  const SR = 16000;            // working sample rate (SwiftF0 convention)
  const HOP = 256;             // 16 ms hop (SwiftF0 convention)
  const FRAME = 1024;          // YIN integration window
  const FMIN = 46.875;         // detection range low (SwiftF0)
  const FMAX = 2093.75;        // detection range high (SwiftF0)
  const YIN_THRESH = 0.15;     // YIN absolute threshold
  const CONF_GATE = 0.55;      // voicing confidence gate (YIN clarity)
  const MEDIAN_WIN = 5;        // median filter taps (odd)
  const PITCH_TOL = 0.7;       // semitones: new-note trigger
  const MIN_NOTE_S = 0.09;     // minimum note duration (s)

  // ===========================================================================
  // AUDIO PREPROCESSING
  // ===========================================================================

  // Downmix interleaved/planar channels (array of Float32Array) to mono.
  function toMono(channels) {
    const n = channels[0].length;
    const out = new Float32Array(n);
    const c = channels.length;
    for (let ch = 0; ch < c; ch++) {
      const data = channels[ch];
      for (let i = 0; i < n; i++) out[i] += data[i];
    }
    if (c > 1) for (let i = 0; i < n; i++) out[i] /= c;
    return out;
  }

  // Linear resample mono signal from srIn to srOut.
  function resample(mono, srIn, srOut) {
    if (srIn === srOut) return mono.slice(0);
    const ratio = srIn / srOut;
    const outLen = Math.floor(mono.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const a = mono[i0] || 0;
      const b = mono[i0 + 1] || a;
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  // ===========================================================================
  // PITCH DETECTION (YIN)
  // ===========================================================================

  // Estimate f0 (Hz) and clarity (0..1) for a single frame using YIN.
  function yinFrame(frame, sr) {
    const tauMax = Math.min(Math.floor(sr / FMIN), (frame.length >> 1) - 1);
    const tauMin = Math.max(2, Math.floor(sr / FMAX));
    const yin = new Float32Array(tauMax + 1);

    // Difference function
    for (let tau = tauMin; tau <= tauMax; tau++) {
      let sum = 0;
      const lim = frame.length - tau;
      for (let j = 0; j < lim; j++) {
        const d = frame[j] - frame[j + tau];
        sum += d * d;
      }
      yin[tau] = sum;
    }

    // Cumulative mean normalized difference
    yin[0] = 1;
    let running = 0;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      running += yin[tau];
      yin[tau] = running > 0 ? yin[tau] * tau / running : 1;
    }

    // Absolute threshold: first dip below YIN_THRESH that is a local min
    let tauEst = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (yin[tau] < YIN_THRESH) {
        while (tau + 1 <= tauMax && yin[tau + 1] < yin[tau]) tau++;
        tauEst = tau;
        break;
      }
    }
    // Fallback: global minimum
    if (tauEst === -1) {
      let best = Infinity;
      for (let tau = tauMin; tau <= tauMax; tau++) {
        if (yin[tau] < best) { best = yin[tau]; tauEst = tau; }
      }
    }
    if (tauEst <= 0) return { f0: 0, clarity: 0 };

    // Parabolic interpolation around tauEst
    const x0 = tauEst > tauMin ? yin[tauEst - 1] : yin[tauEst];
    const x1 = yin[tauEst];
    const x2 = tauEst < tauMax ? yin[tauEst + 1] : yin[tauEst];
    let betterTau = tauEst;
    const denom = (x0 + x2 - 2 * x1);
    if (denom !== 0) betterTau = tauEst + (x0 - x2) / (2 * denom);

    const f0 = sr / betterTau;
    const clarity = Math.max(0, Math.min(1, 1 - x1));
    if (f0 < FMIN || f0 > FMAX) return { f0: 0, clarity: 0 };
    return { f0, clarity };
  }

  // Full pitch track over the signal. Returns array of {t, f0, clarity}.
  function pitchTrack(signal, sr) {
    const frames = [];
    // Frame RMS to suppress silence (relative to signal peak RMS).
    let maxRms = 1e-9;
    const rmsArr = [];
    for (let start = 0; start + FRAME <= signal.length; start += HOP) {
      let s = 0;
      for (let j = 0; j < FRAME; j++) { const v = signal[start + j]; s += v * v; }
      const rms = Math.sqrt(s / FRAME);
      rmsArr.push(rms);
      if (rms > maxRms) maxRms = rms;
    }
    let idx = 0;
    for (let start = 0; start + FRAME <= signal.length; start += HOP, idx++) {
      const t = start / sr;
      const rms = rmsArr[idx];
      if (rms < maxRms * 0.06 || rms < 1e-4) { // silence gate
        frames.push({ t, f0: 0, clarity: 0 });
        continue;
      }
      const frame = signal.subarray(start, start + FRAME);
      const { f0, clarity } = yinFrame(frame, sr);
      frames.push({ t, f0, clarity });
    }
    return frames;
  }

  // ===========================================================================
  // CONTOUR CLEANING
  // ===========================================================================

  const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
  const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Median filter f0 (in MIDI domain over voiced frames) + confidence gate.
  function cleanContour(frames) {
    // Convert to midi, gate unvoiced
    const midi = frames.map(f =>
      (f.f0 > 0 && f.clarity >= CONF_GATE) ? hzToMidi(f.f0) : NaN);
    const half = MEDIAN_WIN >> 1;
    const out = frames.map((f, i) => {
      if (isNaN(midi[i])) return { t: f.t, midi: NaN, clarity: 0 };
      const win = [];
      for (let k = -half; k <= half; k++) {
        const v = midi[i + k];
        if (!isNaN(v)) win.push(v);
      }
      win.sort((a, b) => a - b);
      const med = win[win.length >> 1];
      return { t: f.t, midi: med, clarity: f.clarity };
    });
    return out;
  }

  // ===========================================================================
  // NOTE SEGMENTATION
  // ===========================================================================

  // Group cleaned contour frames into discrete note events.
  // Returns [{start, dur, midi, pitch, clarity}] (pitch = rounded MIDI int).
  function segmentNotes(contour, hop, sr) {
    const dt = hop / sr;
    const notes = [];
    let cur = null; // {startIdx, frames:[], sumPitch, sumClar, n}

    const close = (endIdx) => {
      if (!cur) return;
      const dur = (endIdx - cur.startIdx) * dt;
      if (dur >= MIN_NOTE_S) {
        const mean = cur.sumPitch / cur.n;
        notes.push({
          start: cur.startIdx * dt,
          dur,
          midi: mean,
          pitch: Math.round(mean),
          clarity: cur.sumClar / cur.n
        });
      }
      cur = null;
    };

    for (let i = 0; i < contour.length; i++) {
      const c = contour[i];
      if (isNaN(c.midi)) { close(i); continue; }
      if (!cur) {
        cur = { startIdx: i, sumPitch: c.midi, sumClar: c.clarity, n: 1 };
      } else {
        const mean = cur.sumPitch / cur.n;
        if (Math.abs(c.midi - mean) > PITCH_TOL) {
          close(i);
          cur = { startIdx: i, sumPitch: c.midi, sumClar: c.clarity, n: 1 };
        } else {
          cur.sumPitch += c.midi; cur.sumClar += c.clarity; cur.n++;
        }
      }
    }
    close(contour.length);
    return notes;
  }

  // ===========================================================================
  // KEY DETECTION (Krumhansl-Schmuckler)
  // ===========================================================================

  const KS_MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
  const KS_MINOR = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  function pitchClassHistogram(notes) {
    const h = new Float32Array(12);
    for (const n of notes) {
      const pc = ((Math.round(n.midi) % 12) + 12) % 12;
      h[pc] += n.dur * Math.max(0.01, n.clarity);
    }
    return h;
  }

  function pearson(a, b) {
    const n = a.length;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    const den = Math.sqrt(da * db);
    return den === 0 ? 0 : num / den;
  }

  // Returns {tonic, mode, name, score, ranked:[...]}.
  function detectKey(notes) {
    const hist = pitchClassHistogram(notes);
    const candidates = [];
    for (let tonic = 0; tonic < 12; tonic++) {
      const maj = new Array(12), min = new Array(12);
      for (let i = 0; i < 12; i++) {
        maj[i] = KS_MAJOR[(i - tonic + 12) % 12];
        min[i] = KS_MINOR[(i - tonic + 12) % 12];
      }
      candidates.push({ tonic, mode: 'major', score: pearson(hist, maj) });
      candidates.push({ tonic, mode: 'minor', score: pearson(hist, min) });
    }
    candidates.sort((a, b) => b.score - a.score);
    candidates.forEach(c => {
      c.name = NOTE_NAMES[c.tonic] + (c.mode === 'major' ? ' major' : ' minor');
    });
    const best = candidates[0];
    return { tonic: best.tonic, mode: best.mode, name: best.name,
             score: best.score, ranked: candidates, hist };
  }

  // ===========================================================================
  // HARMONIZATION (rule-based, modular — see spec note)
  // ===========================================================================

  const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
  const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor
  // Diatonic triad qualities by scale degree:
  const MAJOR_QUAL = ['maj','min','min','maj','maj','min','dim'];
  const MINOR_QUAL = ['min','dim','maj','min','min','maj','maj'];
  const MAJOR_7TH  = ['maj7','min7','min7','maj7','7','min7','m7b5'];
  const MINOR_7TH  = ['min7','m7b5','maj7','min7','min7','maj7','7'];
  // Roman numerals for display
  const MAJOR_ROMAN = ['I','ii','iii','IV','V','vi','vii°'];
  const MINOR_ROMAN = ['i','ii°','III','iv','v','VI','VII'];
  // Functional preference weight per degree (tonic/subdominant/dominant common)
  const MAJOR_PREF = [1.0, 0.55, 0.5, 0.85, 0.9, 0.8, 0.3];
  const MINOR_PREF = [1.0, 0.4, 0.6, 0.8, 0.7, 0.85, 0.75];

  const CHORD_INTERVALS = {
    maj:[0,4,7], min:[0,3,7], dim:[0,3,6], aug:[0,4,8],
    maj7:[0,4,7,11], min7:[0,3,7,10], '7':[0,4,7,10],
    m7b5:[0,3,6,10], dim7:[0,3,6,9]
  };
  const QUAL_SUFFIX = {
    maj:'', min:'m', dim:'dim', aug:'aug',
    maj7:'maj7', min7:'m7', '7':'7', m7b5:'m7b5', dim7:'dim7'
  };

  // Build the 7 diatonic chords for a key.
  function diatonicChords(tonic, mode, useSevenths) {
    const scale = mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
    const qual = useSevenths
      ? (mode === 'major' ? MAJOR_7TH : MINOR_7TH)
      : (mode === 'major' ? MAJOR_QUAL : MINOR_QUAL);
    const roman = mode === 'major' ? MAJOR_ROMAN : MINOR_ROMAN;
    const pref = mode === 'major' ? MAJOR_PREF : MINOR_PREF;
    const chords = [];
    for (let d = 0; d < 7; d++) {
      const rootPc = (tonic + scale[d]) % 12;
      const q = qual[d];
      const intervals = CHORD_INTERVALS[q];
      const pcs = intervals.map(iv => (rootPc + iv) % 12);
      chords.push({
        degree: d,
        rootPc,
        quality: q,
        pcs,
        name: NOTE_NAMES[rootPc] + QUAL_SUFFIX[q],
        roman: roman[d],
        pref: pref[d]
      });
    }
    return chords;
  }

  // Melody pitch-class weights within [t0, t1).
  function windowPcWeights(notes, t0, t1) {
    const w = new Float32Array(12);
    for (const n of notes) {
      const s = Math.max(n.start, t0);
      const e = Math.min(n.start + n.dur, t1);
      const overlap = e - s;
      if (overlap <= 0) continue;
      const pc = ((Math.round(n.midi) % 12) + 12) % 12;
      w[pc] += overlap * Math.max(0.05, n.clarity);
    }
    return w;
  }

  // Pick a voicing (MIDI notes) for a chord near a target register, choosing
  // the inversion that minimizes movement from prevVoicing (voice leading).
  function voiceChord(chord, prevVoicing) {
    const baseOct = 4; // root around C4..B4 region
    const rootMidi = chord.rootPc + 12 * baseOct; // e.g. C4 = 60
    const intervals = CHORD_INTERVALS[chord.quality];
    // Candidate voicings: inversions, shifted to a sensible octave band.
    const candidates = [];
    for (let inv = 0; inv < intervals.length; inv++) {
      const v = [];
      for (let i = 0; i < intervals.length; i++) {
        let note = rootMidi + intervals[i];
        if (i < inv) note += 12; // raise the lowest `inv` voices an octave
        v.push(note);
      }
      v.sort((a, b) => a - b);
      // Center the voicing in playback range 52..76
      let avg = v.reduce((s, x) => s + x, 0) / v.length;
      while (avg < 55) { for (let i = 0; i < v.length; i++) v[i] += 12; avg += 12; }
      while (avg > 72) { for (let i = 0; i < v.length; i++) v[i] -= 12; avg -= 12; }
      candidates.push(v);
    }
    if (!prevVoicing) return candidates[0];
    // Choose candidate with minimal total semitone movement.
    let best = candidates[0], bestCost = Infinity;
    for (const c of candidates) {
      let cost = 0;
      const m = Math.min(c.length, prevVoicing.length);
      for (let i = 0; i < m; i++) cost += Math.abs(c[i] - prevVoicing[i]);
      if (cost < bestCost) { bestCost = cost; best = c; }
    }
    return best;
  }

  // Score how well a chord fits the melody weights of a slot.
  function scoreChord(chord, weights, prevChord) {
    let total = 0, covered = 0;
    let strongPc = -1, strongW = -1;
    for (let pc = 0; pc < 12; pc++) {
      total += weights[pc];
      if (weights[pc] > strongW) { strongW = weights[pc]; strongPc = pc; }
      if (chord.pcs.includes(pc)) covered += weights[pc];
    }
    const coverRatio = total > 0 ? covered / total : 0;
    let score = coverRatio * 2.0 + chord.pref * 0.6;
    // Big bonus if the strongest melody note is a chord tone (esp. root/3rd).
    if (strongW > 0 && chord.pcs.includes(strongPc)) {
      const role = chord.pcs.indexOf(strongPc);
      score += role === 0 ? 0.9 : (role === 1 ? 0.7 : 0.4);
    }
    // Smooth root motion bonus (avoid distant root leaps when equal).
    if (prevChord) {
      const diff = Math.min((chord.rootPc - prevChord.rootPc + 12) % 12,
                            (prevChord.rootPc - chord.rootPc + 12) % 12);
      score += (diff === 5 || diff === 7) ? 0.25 : (diff === 0 ? -0.1 : 0.05);
    }
    return score;
  }

  // Build chord progression. opts: {bpm, beatsPerBar, chordsPerBar, sevenths, variant}
  // variant>0 picks the Nth-best candidate per slot ("reroll").
  function harmonize(notes, key, opts) {
    const o = Object.assign({ bpm: 120, beatsPerBar: 4, chordsPerBar: 1,
                              sevenths: false, variant: 0 }, opts || {});
    const chords = diatonicChords(key.tonic, key.mode, o.sevenths);
    const secPerBeat = 60 / o.bpm;
    const barLen = secPerBeat * o.beatsPerBar;
    const slotLen = barLen / o.chordsPerBar;
    const endT = notes.length
      ? Math.max(...notes.map(n => n.start + n.dur)) : barLen;
    const nSlots = Math.max(1, Math.ceil(endT / slotLen));

    const prog = [];
    let prevChord = null, prevVoicing = null;
    for (let s = 0; s < nSlots; s++) {
      const t0 = s * slotLen, t1 = t0 + slotLen;
      const w = windowPcWeights(notes, t0, t1);
      const hasMelody = w.some(x => x > 0);
      const ranked = chords
        .map(c => ({ c, score: scoreChord(c, w, prevChord) }))
        .sort((a, b) => b.score - a.score);
      // If no melody in slot, prefer tonic (degree 0).
      let chosen;
      if (!hasMelody) {
        chosen = chords[0];
      } else {
        const pick = Math.min(o.variant, ranked.length - 1);
        chosen = ranked[pick].c;
      }
      const voicing = voiceChord(chosen, prevVoicing);
      prog.push({
        slot: s, t0, t1, dur: slotLen,
        chord: chosen, name: chosen.name, roman: chosen.roman,
        voicing
      });
      prevChord = chosen; prevVoicing = voicing;
    }
    return { progression: prog, slotLen, barLen, opts: o };
  }

  // ===========================================================================
  // MIDI FILE WRITER (Standard MIDI File, hand-rolled bytes)
  // ===========================================================================
  const PPQ = 480;

  function varLen(value) {
    const bytes = [value & 0x7f];
    value >>= 7;
    while (value > 0) { bytes.unshift((value & 0x7f) | 0x80); value >>= 7; }
    return bytes;
  }
  function pushU32(arr, v) { arr.push((v>>>24)&0xff,(v>>>16)&0xff,(v>>>8)&0xff,v&0xff); }
  function pushU16(arr, v) { arr.push((v>>>8)&0xff, v&0xff); }
  function strBytes(s) { return Array.from(s).map(c => c.charCodeAt(0)); }

  // events: [{tick, type:'on'|'off', note, vel}] -> track bytes (with meta).
  function buildTrack(events, bpm, addTimeSig) {
    const body = [];
    // Tempo meta
    const usPerBeat = Math.round(60000000 / bpm);
    body.push(0x00, 0xFF, 0x51, 0x03,
      (usPerBeat>>16)&0xff, (usPerBeat>>8)&0xff, usPerBeat&0xff);
    if (addTimeSig) body.push(0x00, 0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);
    // Program (acoustic grand)
    body.push(0x00, 0xC0, 0x00);

    events.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));
    let last = 0;
    for (const e of events) {
      const delta = e.tick - last; last = e.tick;
      body.push(...varLen(delta));
      if (e.type === 'on') body.push(0x90, e.note & 0x7f, e.vel & 0x7f);
      else body.push(0x80, e.note & 0x7f, 0x40);
    }
    body.push(0x00, 0xFF, 0x2F, 0x00); // end of track

    const track = [];
    track.push(...strBytes('MTrk'));
    pushU32(track, body.length);
    track.push(...body);
    return track;
  }

  function eventsFromProgression(prog, bpm) {
    const ticksPerBeat = PPQ;
    const secToTick = (s) => Math.round(s / (60 / bpm) * ticksPerBeat);
    const ev = [];
    for (const slot of prog.progression) {
      const on = secToTick(slot.t0);
      const off = secToTick(slot.t1) - 4; // tiny gap
      for (const note of slot.voicing) {
        ev.push({ tick: on, type: 'on', note, vel: 80 });
        ev.push({ tick: Math.max(on + 1, off), type: 'off', note, vel: 0 });
      }
    }
    return ev;
  }

  function eventsFromMelody(notes, bpm) {
    const ticksPerBeat = PPQ;
    const secToTick = (s) => Math.round(s / (60 / bpm) * ticksPerBeat);
    const ev = [];
    for (const n of notes) {
      const on = secToTick(n.start);
      const off = Math.max(on + 1, secToTick(n.start + n.dur) - 2);
      ev.push({ tick: on, type: 'on', note: n.pitch, vel: 90 });
      ev.push({ tick: off, type: 'off', note: n.pitch, vel: 0 });
    }
    return ev;
  }

  function assembleSMF(tracks) {
    const out = [];
    out.push(...strBytes('MThd'));
    pushU32(out, 6);
    pushU16(out, 1);              // format 1
    pushU16(out, tracks.length);
    pushU16(out, PPQ);
    for (const t of tracks) out.push(...t);
    return new Uint8Array(out);
  }

  function chordsMidi(prog, bpm) {
    const ev = eventsFromProgression(prog, bpm);
    return assembleSMF([buildTrack(ev, bpm, true)]);
  }
  function melodyMidi(notes, bpm) {
    const ev = eventsFromMelody(notes, bpm);
    return assembleSMF([buildTrack(ev, bpm, true)]);
  }

  // ===========================================================================
  // FULL ANALYSIS (pure, given a mono signal at SR)
  // ===========================================================================
  function analyzeSignal(signal, sr) {
    const sig = (sr === SR) ? signal : resample(signal, sr, SR);
    const frames = pitchTrack(sig, SR);
    const contour = cleanContour(frames);
    const notes = segmentNotes(contour, HOP, SR);
    const key = detectKey(notes);
    return { frames, contour, notes, key, sr: SR };
  }

  // ---- Public API ----------------------------------------------------------
  const API = {
    SR, HOP, FRAME, FMIN, FMAX, CONF_GATE, MIN_NOTE_S,
    NOTE_NAMES,
    toMono, resample, yinFrame, pitchTrack, cleanContour, segmentNotes,
    hzToMidi, midiToHz,
    pitchClassHistogram, detectKey, pearson,
    diatonicChords, harmonize, voiceChord, scoreChord, windowPcWeights,
    chordsMidi, melodyMidi, assembleSMF, buildTrack,
    eventsFromProgression, eventsFromMelody,
    analyzeSignal
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.VTM = API;

})(typeof window !== 'undefined' ? window : globalThis);
