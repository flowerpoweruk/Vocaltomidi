/**
 * Pure music-theory + chord-generation logic for the Chord Palette extension.
 *
 * This module has no dependency on the Extensions SDK so it can be reasoned
 * about and tested in isolation. The extension entry point feeds it a spec
 * (key, scale, progression, voicing settings) and writes the resulting notes
 * into a MIDI clip.
 *
 * Chords are built by stacking diatonic thirds within the chosen scale, so the
 * generated harmony always stays in key — the same approach popularised by
 * chord-suggestion plugins.
 */

export interface ScaleDef {
  id: string;
  name: string;
  /** Semitone offsets from the root, one per scale degree. */
  intervals: number[];
}

/** Built-in scales. `intervals` are semitone offsets from the root note. */
export const SCALES: ScaleDef[] = [
  { id: "major", name: "Major (Ionian)", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", name: "Natural Minor (Aeolian)", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "harmonicMinor", name: "Harmonic Minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: "melodicMinor", name: "Melodic Minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: "dorian", name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "phrygian", name: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: "lydian", name: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "mixolydian", name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "locrian", name: "Locrian", intervals: [0, 1, 3, 5, 6, 8, 10] },
];

export const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

export type ChordTypeId =
  | "triad"
  | "7"
  | "9"
  | "6"
  | "sus2"
  | "sus4"
  | "add9";

/**
 * Chord tones expressed as scale-step offsets from the chord's root degree.
 * Because the offsets index into the scale, the resulting chord quality
 * (major / minor / diminished …) follows the scale automatically.
 */
export const CHORD_STEP_OFFSETS: Record<ChordTypeId, number[]> = {
  triad: [0, 2, 4],
  "7": [0, 2, 4, 6],
  "9": [0, 2, 4, 6, 8],
  "6": [0, 2, 4, 5],
  sus2: [0, 1, 4],
  sus4: [0, 3, 4],
  add9: [0, 2, 4, 8],
};

export type Voicing = "close" | "open" | "spread";

/** A single step in a progression. */
export interface ChordSpec {
  /** Scale degree, 1-based (1 = tonic). */
  degree: number;
  type: ChordTypeId;
}

export interface GenerateSettings {
  /** Root pitch class, 0 = C … 11 = B. */
  rootNote: number;
  /** Scale degree intervals in semitones. */
  intervals: number[];
  /** MIDI octave for the chord roots (rootMidi = rootNote + 12 * baseOctave). */
  baseOctave: number;
  /** Length of each chord in beats. */
  chordBeats: number;
  /** How many times the whole progression repeats. */
  repeats: number;
  /** Base MIDI velocity, 1–127. */
  velocity: number;
  voicing: Voicing;
  /** Add the chord root an octave below for a bigger low end. */
  addBass: boolean;
  /** Strum offset between chord tones, in beats (0 = block chord). */
  strumBeats: number;
  /** Humanize amount, 0–100 (jitters velocity and timing). */
  humanize: number;
}

export interface GeneratedNote {
  pitch: number;
  startTime: number;
  duration: number;
  velocity: number;
}

export interface GenerateResult {
  notes: GeneratedNote[];
  lengthBeats: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** MIDI pitch of a scale step (may be negative or beyond one octave). */
function scalePitch(intervals: number[], rootMidi: number, step: number): number {
  const n = intervals.length;
  const octave = Math.floor(step / n);
  const idx = mod(step, n);
  return rootMidi + intervals[idx]! + 12 * octave;
}

/**
 * The voiced MIDI pitches for one chord, before strum/humanize.
 * `rootMidi` is the MIDI pitch of scale degree 1 at the chosen octave.
 */
export function chordPitches(
  intervals: number[],
  rootMidi: number,
  chord: ChordSpec,
  voicing: Voicing,
  addBass: boolean,
): number[] {
  const rootStep = chord.degree - 1;
  const offsets = CHORD_STEP_OFFSETS[chord.type];
  const rootPitch = scalePitch(intervals, rootMidi, rootStep);

  let pitches = offsets.map((o) => scalePitch(intervals, rootMidi, rootStep + o));
  pitches.sort((a, b) => a - b);

  // Open voicing: lift the second-lowest tone an octave to spread the chord.
  if (voicing !== "close" && pitches.length >= 2) {
    pitches[1] = pitches[1]! + 12;
    pitches.sort((a, b) => a - b);
  }

  // Spread / add-bass: drop the chord root an octave below the voicing.
  if (voicing === "spread" || addBass) {
    pitches.unshift(rootPitch - 12);
  }

  return pitches.map((p) => clamp(Math.round(p), 0, 127));
}

/** Builds the full note list for a progression. */
export function generateNotes(
  progression: ChordSpec[],
  settings: GenerateSettings,
  /** Injectable RNG for deterministic tests. */
  rng: () => number = Math.random,
): GenerateResult {
  const rootMidi = settings.rootNote + 12 * settings.baseOctave;
  const repeats = Math.max(1, Math.floor(settings.repeats));
  const notes: GeneratedNote[] = [];
  let t = 0;

  for (let r = 0; r < repeats; r++) {
    for (const chord of progression) {
      const pitches = chordPitches(
        settings.intervals,
        rootMidi,
        chord,
        settings.voicing,
        settings.addBass,
      );

      pitches.forEach((pitch, i) => {
        const strum = i * settings.strumBeats;
        const timeJitter =
          settings.humanize > 0 ? (rng() * 2 - 1) * settings.humanize * 0.002 : 0;
        const velJitter =
          settings.humanize > 0
            ? Math.round((rng() * 2 - 1) * settings.humanize * 0.3)
            : 0;
        const startTime = Math.max(0, t + strum + timeJitter);
        const duration = Math.max(0.1, settings.chordBeats - strum);

        notes.push({
          pitch,
          startTime,
          duration,
          velocity: clamp(settings.velocity + velJitter, 1, 127),
        });
      });

      t += settings.chordBeats;
    }
  }

  return { notes, lengthBeats: t };
}

/** Finds the index of a built-in scale matching the given intervals, or -1. */
export function findScaleByIntervals(intervals: number[]): number {
  return SCALES.findIndex(
    (s) =>
      s.intervals.length === intervals.length &&
      s.intervals.every((v, i) => v === intervals[i]),
  );
}
