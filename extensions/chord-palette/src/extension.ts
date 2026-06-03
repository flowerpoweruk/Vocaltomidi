/**
 * Chord Palette — generate diatonic chord progressions directly into a Live
 * MIDI clip, with a Scaler-style picker UI.
 *
 * Right-click a Session clip slot or a MIDI clip → "Generate chord progression…"
 * to open the picker. Choose a key + scale (or pull the current scale from
 * Live), build a progression from the diatonic palette or a genre preset, tweak
 * voicing/octave/strum/humanize, then write it into the clip.
 */
import {
  initialize,
  type ActivationContext,
  type Handle,
  type NoteDescription,
  DataModelObject,
  ClipSlot,
  MidiClip,
} from "@ableton-extensions/sdk";

import {
  generateNotes,
  findScaleByIntervals,
  SCALES,
  NOTE_NAMES,
  type ChordSpec,
  type GenerateSettings,
} from "./theory.js";

// esbuild inlines the picker UI as a string (see build.ts loader config).
import pickerInterface from "./interface.html";

const COMMAND_ID = "chordPalette.generate";

/** Shape of the JSON the picker posts back when the user clicks "Write". */
interface PickerResult {
  action: "write" | "cancel";
  clipName: string;
  settings: GenerateSettings;
  progression: ChordSpec[];
}

/** Defaults injected into the picker HTML, including Live's current scale. */
interface PickerDefaults {
  scales: { id: string; name: string; intervals: number[] }[];
  noteNames: string[];
  live: {
    available: boolean;
    rootNote: number;
    intervals: number[];
    name: string;
    matchedScaleId: string | null;
  };
}

export function activate(activation: ActivationContext): void {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand(COMMAND_ID, (firstArg: unknown) => {
    // Fire-and-forget: the command callback signature is synchronous, so we
    // kick off an async flow and surface failures to the console.
    void run(firstArg as Handle).catch((err) => {
      console.error("[Chord Palette] failed:", err);
    });
  });

  async function run(handle: Handle): Promise<void> {
    const target = context.getObjectFromHandle(handle, DataModelObject);

    // Resolve the MIDI clip we'll write into (creating one if a slot is empty).
    let clip: MidiClip<"1.0.0">;
    let createdLengthGetter: ((beats: number) => Promise<MidiClip<"1.0.0">>) | null =
      null;

    if (target instanceof MidiClip) {
      clip = target;
    } else if (target instanceof ClipSlot) {
      const existing = target.clip;
      if (existing instanceof MidiClip) {
        clip = existing;
      } else if (existing) {
        console.error("[Chord Palette] clip slot already holds a non-MIDI clip.");
        return;
      } else {
        // Defer creation until we know the progression length.
        createdLengthGetter = (beats) => target.createMidiClip(Math.max(1, beats));
        clip = null as unknown as MidiClip<"1.0.0">;
      }
    } else {
      console.error("[Chord Palette] unsupported target for chord generation.");
      return;
    }

    // Show the picker, seeded with Live's current scale where possible.
    const defaults = buildDefaults();
    const html = pickerInterface.replace(
      "/*__DEFAULTS__*/null",
      JSON.stringify(defaults),
    );
    const raw = await context.ui.showModalDialog(
      `data:text/html,${encodeURIComponent(html)}`,
      720,
      560,
    );

    const result = JSON.parse(raw) as PickerResult;
    if (result.action !== "write" || result.progression.length === 0) {
      return;
    }

    const { notes, lengthBeats } = generateNotes(result.progression, result.settings);

    if (createdLengthGetter) {
      clip = await createdLengthGetter(lengthBeats);
    }

    // Group the write into a single undo step.
    context.withinTransaction(() => {
      clip.notes = notes as NoteDescription[];
      if (result.clipName) {
        clip.name = result.clipName;
      }
    });
  }

  /** Reads Live's current scale (if any) to pre-fill the picker. */
  function buildDefaults(): PickerDefaults {
    let live: PickerDefaults["live"] = {
      available: false,
      rootNote: 0,
      intervals: SCALES[0]!.intervals,
      name: "",
      matchedScaleId: null,
    };

    try {
      const song = context.application.song;
      const intervals = song.scaleIntervals;
      if (Array.isArray(intervals) && intervals.length > 0) {
        const matchIdx = findScaleByIntervals(intervals);
        live = {
          available: true,
          rootNote: song.rootNote,
          intervals,
          name: song.scaleName,
          matchedScaleId: matchIdx >= 0 ? SCALES[matchIdx]!.id : null,
        };
      }
    } catch {
      // Scale info unavailable — fall back to defaults.
    }

    return {
      scales: SCALES.map((s) => ({ id: s.id, name: s.name, intervals: s.intervals })),
      noteNames: NOTE_NAMES,
      live,
    };
  }

  // Offer the action wherever a chord progression makes sense.
  void context.ui.registerContextMenuAction(
    "ClipSlot",
    "Generate chord progression…",
    COMMAND_ID,
  );
  void context.ui.registerContextMenuAction(
    "MidiClip",
    "Generate chord progression…",
    COMMAND_ID,
  );
}
