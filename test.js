/* Node test harness: synthesize a vocal-like melody, run the full pipeline,
   assert pitch tracking, key detection, harmonization, and MIDI validity. */
const VTM = require('./app.js');

const SRC_SR = 44100; // simulate a real decoded file sample rate
let failures = 0;
function check(name, cond, extra) {
  const ok = !!cond;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
}

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Synthesize a sung melody in C major: C4 E4 G4 E4 F4 D4 G4 C4 (1 note / 0.5s)
// with vibrato, harmonics, a little noise, and short rests — vocal-ish.
function synth(melodyMidi, noteDur, sr) {
  const total = melodyMidi.length * noteDur;
  const n = Math.floor(total * sr);
  const out = new Float32Array(n);
  let phase = 0; // integrate instantaneous frequency (correct FM synthesis)
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const idx = Math.floor(t / noteDur);
    const local = t - idx * noteDur;
    const m = melodyMidi[idx];
    const vib = 0.3 * Math.sin(2 * Math.PI * 5.5 * t); // ±0.3 semitone vibrato
    const fInst = (m == null) ? 0 : midiToHz(m + vib);
    phase += 2 * Math.PI * fInst / sr;
    if (m == null) continue;
    if (local > noteDur * 0.85) continue; // short rest at note tail
    const env = Math.min(1, local * 20) * Math.min(1, (noteDur - local) * 8);
    // fundamental + a couple harmonics (voice timbre)
    let s = Math.sin(phase)
          + 0.5 * Math.sin(2 * phase)
          + 0.25 * Math.sin(3 * phase);
    s += (Math.random() * 2 - 1) * 0.01; // light noise
    out[i] = env * s * 0.3;
  }
  return out;
}

// C4=60 E4=64 G4=67 E4=64 F4=65 D4=62 G4=67 C4=60
const melody = [60, 64, 67, 64, 65, 62, 67, 60];
const signal = synth(melody, 0.5, SRC_SR);
console.log(`Synthesized ${(signal.length / SRC_SR).toFixed(2)}s @ ${SRC_SR}Hz\n`);

const res = VTM.analyzeSignal(signal, SRC_SR);

// --- Pitch / notes ---
check('produced voiced frames',
  res.contour.filter(c => !isNaN(c.midi)).length > 20,
  `voiced=${res.contour.filter(c => !isNaN(c.midi)).length}`);

check('segmented ~8 notes', res.notes.length >= 6 && res.notes.length <= 10,
  `got ${res.notes.length}`);

const detectedPitches = res.notes.map(n => n.pitch);
console.log('  detected note pitches:', detectedPitches.join(' '));
// Count how many detected notes match the intended sequence within ±0 (octave-tolerant)
let pitchHits = 0;
for (const p of detectedPitches) {
  const pc = ((p % 12) + 12) % 12;
  if (melody.some(m => (m % 12) === pc)) pitchHits++;
}
check('detected pitch-classes are in {C,D,E,F,G}',
  pitchHits >= detectedPitches.length - 1,
  `${pitchHits}/${detectedPitches.length}`);

// --- Key ---
console.log('  key ranked top3:',
  res.key.ranked.slice(0, 3).map(k => `${k.name}(${k.score.toFixed(2)})`).join('  '));
check('detected key is C major', res.key.name === 'C major', res.key.name);

// --- Harmonization ---
const harm = VTM.harmonize(res.notes, res.key, { bpm: 120, chordsPerBar: 1, sevenths: false });
console.log('  progression:', harm.progression.map(p => p.name).join(' | '));
check('progression has chords', harm.progression.length >= 1);

// every chord must be diatonic to C major
const diat = VTM.diatonicChords(res.key.tonic, res.key.mode, false).map(c => c.name);
check('all chords diatonic to key',
  harm.progression.every(p => diat.includes(p.name)),
  'allowed: ' + diat.join(','));

// melody note in each slot should be a chord tone where melody present
let chordToneOk = 0, chordToneTotal = 0;
for (const slot of harm.progression) {
  const w = VTM.windowPcWeights(res.notes, slot.t0, slot.t1);
  let strongPc = -1, sw = -1;
  for (let pc = 0; pc < 12; pc++) if (w[pc] > sw) { sw = w[pc]; strongPc = pc; }
  if (sw > 0) {
    chordToneTotal++;
    if (slot.chord.pcs.includes(strongPc)) chordToneOk++;
  }
}
check('strongest melody note is a chord tone in most slots',
  chordToneOk >= Math.ceil(chordToneTotal * 0.75),
  `${chordToneOk}/${chordToneTotal}`);

// reroll gives a (possibly) different but still valid progression
const harm2 = VTM.harmonize(res.notes, res.key, { bpm: 120, chordsPerBar: 1, variant: 1 });
check('reroll stays diatonic',
  harm2.progression.every(p => diat.includes(p.name)));

// --- Voice leading sanity: consecutive voicings move modestly ---
let maxMove = 0;
for (let i = 1; i < harm.progression.length; i++) {
  const a = harm.progression[i - 1].voicing, b = harm.progression[i].voicing;
  let mv = 0; for (let j = 0; j < Math.min(a.length, b.length); j++) mv += Math.abs(a[j]-b[j]);
  maxMove = Math.max(maxMove, mv);
}
check('voice-leading movement bounded', maxMove <= 24, `maxMove=${maxMove}`);

// --- MIDI validity ---
function validateSMF(bytes, label) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag !== 'MThd') return check(label + ': MThd header', false);
  const hlen = dv.getUint32(4);
  const fmt = dv.getUint16(8);
  const ntrk = dv.getUint16(10);
  const div = dv.getUint16(12);
  check(label + ': header len=6', hlen === 6);
  check(label + ': format 1', fmt === 1);
  check(label + ': division=480', div === 480);
  // walk tracks
  let pos = 14, tracks = 0;
  while (pos < bytes.length) {
    const ttag = String.fromCharCode(bytes[pos], bytes[pos+1], bytes[pos+2], bytes[pos+3]);
    if (ttag !== 'MTrk') break;
    const len = dv.getUint32(pos + 4);
    pos += 8 + len;
    tracks++;
  }
  check(label + ': all tracks parsed, count matches', tracks === ntrk && pos === bytes.length,
    `tracks=${tracks}/${ntrk} pos=${pos}/${bytes.length}`);
}

const chMidi = VTM.chordsMidi(harm, 120);
const melMidi = VTM.melodyMidi(res.notes, 120);
validateSMF(chMidi, 'chordsMIDI');
validateSMF(melMidi, 'melodyMIDI');
check('chords MIDI non-trivial size', chMidi.length > 30, `${chMidi.length}B`);
check('melody MIDI non-trivial size', melMidi.length > 30, `${melMidi.length}B`);

// --- Override re-harmonization works for a different key ---
const aMinorKey = { tonic: 9, mode: 'minor', name: 'A minor' };
const harmAm = VTM.harmonize(res.notes, aMinorKey, { bpm: 120 });
const diatAm = VTM.diatonicChords(9, 'minor', false).map(c => c.name);
check('override re-harmonizes diatonically (A minor)',
  harmAm.progression.every(p => diatAm.includes(p.name)),
  harmAm.progression.map(p=>p.name).join(' '));

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
