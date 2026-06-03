# Installing & Running Chord Palette in Ableton Live

This guide takes you from nothing to generating chords in Live. Chord Palette is
built with the **Ableton Extensions SDK**, which is currently a **public beta**.

There are two ways to use it:

- **A. Developer mode** (`extensions-cli run`) — best while testing/iterating.
- **B. Install a package** (`.ablx`) — best for everyday use or sharing.

---

## 1. Prerequisites

| Requirement | Notes |
| --- | --- |
| **Ableton Live 12 Suite — Beta, 12.4.5 or later** | Extensions are **not** available in Standard, Intro, or Lite, and not in stable releases yet. |
| **Ableton Beta Program membership** | Join at the Ableton Beta site (Centercode), then download and install **Live Beta**. |
| **The Extensions SDK download** | A `.zip` from Centercode containing the SDK, CLI, examples, and docs. |
| **Node.js** | Version **24.14.1 or newer** (the CLI requires it). Get it from nodejs.org. |
| **Git** (optional) | To clone this repository. |

> Tip: enabling Extensions in Live may require turning the feature on in
> **Live → Settings → (Library/Features)**. If you don't see Extensions options,
> confirm you're on a Beta build that includes them.

---

## 2. Get the project

Clone the repo (or download it) and open a terminal in this folder:

```sh
git clone https://github.com/flowerpoweruk/vocaltomidi.git
cd vocaltomidi/extensions/chord-palette
```

---

## 3. Add the SDK packages (`vendor/`)

The SDK **cannot be redistributed**, so it is not included in this repo. Copy
these two files out of your Extensions SDK download into the `vendor/` folder:

```
vendor/ableton-extensions-sdk-1.0.0-beta.0.tgz
vendor/ableton-extensions-cli-1.0.0-beta.0.tgz
```

`package.json` already points at `file:./vendor/…`, so no edits are needed as
long as the filenames match. (If your SDK version differs, update the two
`file:` paths in `package.json` to match the filenames you have.)

---

## 4. Install dependencies

```sh
npm install
```

This installs the SDK, CLI, esbuild, tsx, and TypeScript locally.

---

## 5. Point the CLI at Live's Extension Host

`extensions-cli run` needs to know where Live's **Extension Host** lives. It
reads the `EXTENSION_HOST_PATH` environment variable (or a `.env` file in this
folder), which points at Live's `ExtensionHostNodeModule.node`.

You have two options:

**Easiest — let the SDK's project creator detect Live for you.** In a scratch
folder, run the bundled creator once; it auto-detects Live on macOS/Windows and
writes the correct `EXTENSION_HOST_PATH` into a `.env`. Copy that value here:

```sh
# from anywhere, using the creator .tgz from your SDK download
npx file:/path/to/ableton-create-extension-1.0.0-beta.0.tgz
# answer the prompts, then copy EXTENSION_HOST_PATH from the generated .env
```

**Manual — create a `.env` in this folder:**

```sh
# extensions/chord-palette/.env   (this file is gitignored)
EXTENSION_HOST_PATH=/path/to/Ableton Live 12 Suite/.../ExtensionHostNodeModule.node
```

The exact location of `ExtensionHostNodeModule.node` inside the Live application
is described in the **SDK's bundled documentation** (`docs/`); it lives inside
the Live app bundle/install directory. You can also pass it per-run with
`--live` instead of using `.env` (see step 6).

---

## 6. Option A — Run in developer mode

With Live (Beta) open:

```sh
npm run start
# = build the extension, then `extensions-cli run`
```

or, overriding the host path explicitly:

```sh
npx tsx build.ts
npx extensions-cli run --live "/path/to/.../ExtensionHostNodeModule.node"
```

Then, in Live:

1. **Right-click a Session-view clip slot** (empty or holding a MIDI clip), or
   **right-click an existing MIDI clip**.
2. Choose **"Generate chord progression…"**.
3. In the picker: pick a **Key** and **Scale** (or click **Use Live's scale**),
   click chords from the palette (or load a **preset**), tweak
   octave/length/voicing/strum/humanize, and click **Write to Clip**.
4. The chords appear in the clip as a single undo step. Press play.

Leave `extensions-cli run` running while you work; stop it (Ctrl-C) when done.

To attach a debugger, add `--inspect` and use VS Code's "attach" config.

---

## 7. Option B — Build a `.ablx` and install it

For everyday use without the CLI running:

```sh
npm run package
# = production build, then `extensions-cli package` → a .ablx archive
```

This produces a **`.ablx`** file (path shown in the output; control it with
`-o`). Then in Live:

1. Open **Live → Settings**, find the **Extensions** section.
2. **Install / add** the `.ablx` file.
3. Enable it. The **"Generate chord progression…"** action now appears on
   clip-slot and MIDI-clip right-click menus — no terminal needed.

Share the same `.ablx` with collaborators (it doesn't require the SDK to use,
only Live 12 Suite Beta 12.4.5+).

---

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `npm install` fails on the `file:` deps | The two `.tgz` aren't in `vendor/`, or the filenames don't match the `file:` paths in `package.json`. |
| `extensions-cli run` can't find the host | `EXTENSION_HOST_PATH` is unset/wrong. Set it in `.env` or pass `--live`. Point it at `ExtensionHostNodeModule.node`. |
| Right-click menu item missing | Make sure the extension is running (Option A) or installed+enabled (Option B), and that you're on Live 12 **Suite Beta 12.4.5+**. |
| "Generate" does nothing on a slot with a non-MIDI clip | Run it on an **empty slot** or a **MIDI** clip; audio clips aren't supported. |
| Node errors about version | Use Node.js **24.14.1+**. |
| Chords land in the wrong octave | Adjust the **Octave** slider in the picker (it maps to the chord-root MIDI octave). |

---

## 9. Updating

After changing the source:

- **Developer mode:** just re-run `npm run start` (it rebuilds).
- **Installed `.ablx`:** re-run `npm run package` and re-install the new `.ablx`
  in Live's Settings.

---

### Community & docs

- SDK documentation: <https://ableton.github.io/extensions-sdk/>
- Discuss on the Ableton Discord: `#extensions`, `#extensions-sdk`,
  `#extensions-gallery`.
