# Ableton Extensions SDK — Reference

In-repo reference distilled from the official **Extensions SDK `1.0.0-beta.0`**
package (dated 2026-06-02). This summarizes the package layout, how an Extension
is structured, the tooling, and the API surface. For the plain-language "what is
it" overview, see [`../ableton-extensions.md`](../ableton-extensions.md).

> The SDK is in beta and **not published to npm**. It's distributed as a zip
> (from Centercode) containing the SDK, CLI, a project generator, examples, and
> rendered documentation.

## Package layout

The distribution zip contains:

| Item | What it is |
| --- | --- |
| `ableton-extensions-sdk-1.0.0-beta.0.tgz` | `@ableton-extensions/sdk` — the TypeScript SDK (typed Live data model + APIs). |
| `ableton-extensions-cli-1.0.0-beta.0.tgz` | `@ableton-extensions/cli` — the `extensions-cli` for running/packaging Extensions. |
| `ableton-create-extension-1.0.0-beta.0.tgz` | `@ableton-extensions/create-extension` — project scaffolder. |
| `examples/` | Seven runnable example Extensions (see below). |
| `api/` | Generated HTML API reference (TypeDoc). |
| `docs/` | Rendered documentation site (Astro). |
| `LICENSE.md` | Ableton Extensions SDK License. |

## Anatomy of an Extension

An Extension is a project folder containing:

- **`manifest.json`** — metadata read by Live:
  ```json
  {
    "name": "Context Menu",
    "author": "Ableton",
    "entry": "dist/extension.js",
    "version": "0.0.1",
    "minimumApiVersion": "1.0.0"
  }
  ```
- **`src/extension.ts`** — your source, written in TypeScript.
- **`build.ts`** — an esbuild build that bundles `src/extension.ts` into the
  single CommonJS file named by `manifest.entry` (`bundle: true`,
  `format: "cjs"`, `platform: "node"`).
- **`package.json`** — depends on `@ableton-extensions/sdk` (and the CLI as a
  dev dependency); typical scripts:
  ```json
  "build": "tsc --noEmit && tsx build.ts",
  "start": "tsx build.ts && extensions-cli run"
  ```

## Programming model

Export an `activate(context)` entry point, initialize the API, and register
behavior. Minimal example (the bundled `context-menu` Extension):

```ts
import { initialize, type ActivationContext } from "@ableton-extensions/sdk";

export function activate(context: ActivationContext) {
  const api = initialize(context, "1.0.0");

  api.commands.registerCommand("myClipSlotAction", () => {
    console.log("You right-clicked on a ClipSlot!");
  });

  api.ui.registerContextMenuAction(
    "ClipSlot",
    "Process this ClipSlot",
    "myClipSlotAction",
  );
}
```

- `initialize(context, apiVersion)` returns the `api` object.
- `api.commands.registerCommand(id, handler)` registers an action.
- `api.ui.registerContextMenuAction(scope, label, commandId)` puts it on the
  right-click menu for items of that `scope` (e.g. `"ClipSlot"`).
- Extensions can use Node's `fs` for file access (the `strip-silence` example
  reads/decodes audio from disk).

## Tooling

### `extensions-cli` (`@ableton-extensions/cli`)

> CLI for developing, running, and packaging Ableton Live extensions.

```
extensions-cli run [dir]       Run the extension in Live's Extension Host
                                 --live <path>              override EXTENSION_HOST_PATH
                                 --storage-directory <path>
                                 --temp-directory <path>
                                 --inspect                  attach VS Code debugger
extensions-cli package [dir]   Build a .ablx archive
                                 -o, --output <path>
                                 -i, --include <p...>
```

- `run` reads `EXTENSION_HOST_PATH` from the environment or a `.env` file; it
  points at Live's `ExtensionHostNodeModule.node` (the Extension Host).
- `package` produces a distributable **`.ablx`** archive.

### `create-extension` (`@ableton-extensions/create-extension`)

Scaffolds a new project. Run the bundled `.tgz` with `npx`:

```sh
mkdir my-ext && cd my-ext
npx file:/path/to/extracted/ableton-create-extension-<version>.tgz
```

Prompts for **Extension name**, **Author**, **Path to Ableton Live**
(auto-detected on macOS/Windows), and whether to include a **UI** (a Vite
webview scaffold). It writes `EXTENSION_HOST_PATH` to a gitignored `.env`,
installs dependencies, and — if VS Code is on `PATH` — adds `.vscode/launch.json`
and `tasks.json` for one-keystroke (F5) debugging.

## Runtime requirements

- SDK package engine: **Node.js ≥ 22.11.0**. The CLI README states **Node.js ≥
  24.14.1**; use the newer to be safe.
- `manifest.minimumApiVersion` declares the minimum Extensions API the Extension
  needs (e.g. `1.0.0`).
- Runs in Live's **Extension Host** (Node-based), inside **Live 12 Suite Beta
  12.4.5+**.

## API surface

Typed access to Live's data model and host APIs (from the generated `api/`
docs).

**Classes**

`Application`, `Song`, `Track`, `AudioTrack`, `MidiTrack`, `TrackMixer`,
`Clip`, `AudioClip`, `MidiClip`, `ClipSlot`, `Scene`, `TakeLane`, `CuePoint`,
`Device`, `RackDevice`, `DrumRack`, `DrumChain`, `Simpler`, `Chain`,
`ChainMixer`, `DeviceParameter`, `Sample`, `Commands`, `Ui`, `Resources`,
`Environment`, `DataModelObject`.

**Enums**

`WarpMode`, `GridQuantization`.

**Interfaces**

`ActivationContext`, `ExtensionContext`, `ArrangementSelection`,
`ClipSlotSelection`, `ClipLoopSettings`, `DeviceParameterValueItem`,
`WarpMarker`, `Handle`.

**Types**

`ContextMenuScope`, `NoteDescription`.

**Functions**

`initialize`.

## Bundled example Extensions

| Example | Demonstrates |
| --- | --- |
| `context-menu` | Registering a command + a right-click context-menu action on a `ClipSlot`. |
| `strip-silence` | Reading/decoding audio with Node `fs`, computing silence ranges, editing clips. |
| `warpMode` | Setting clip warp modes (uses the `WarpMode` enum). |
| `audio-clips` | Working with audio clips. |
| `arrangementselection` | Reading/acting on the arrangement selection. |
| `modal-dialog` | Showing a modal dialog (includes an HTML/webview UI). |
| `progress-dialog` | Showing progress while a long task runs. |

## License (summary)

**Ableton Extensions SDK License** (Ableton AG) — free, royalty-free,
non-exclusive, non-transferable. You may develop applications that communicate
with Ableton products and publish/sell them under your own brand. You may **not**
sell, sub-license, redistribute, or reverse-engineer the SDK itself, and must
follow Ableton's branding/UI guidelines. Provided **"as is,"** without warranty;
liability is limited. See the package's `LICENSE.md` for the full text.
