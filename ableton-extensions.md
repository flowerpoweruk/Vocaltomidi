# Ableton Live "Extensions" — What It Is

> Based on Ableton's announcement *["Introducing Extensions SDK: An experimental
> playground inside Live"](https://www.ableton.com/en/blog/introducing-extensions-sdk/)*
> (June 2026) and the official **Extensions SDK `1.0.0-beta.0`** package.

## In one sentence

**Extensions** are custom tools that run *inside* Ableton Live, built by users
and third-party developers with the free, open **Extensions SDK**. They let you
reach into a Live Set — tracks, clips, MIDI, devices, tempo and more — to
automate repetitive work, transform musical data, and connect Live to other
systems, all from inside the app.

It launched as a **public beta** alongside **Live 12.4.5**, with the SDK at
version `1.0.0-beta.0`. Ableton frames it as an *experimental playground*: an
open, feedback-driven program guided by community experimentation.

## What an Extension can do

An Extension can interact with the parts of a Live Set and act on them:

- **Automate** the repetitive parts of your workflow.
- **Transform musical data** — analyze, reorganize, or scramble clips and notes.
- **Analyze and visualize** what's in a project.
- **Spark or scramble ideas** — generative and randomizing tools.
- **Connect Live to new services and systems** — bridge to external apps/data.

Concrete examples shipped with the SDK include tools to strip silence from audio
clips, change warp modes in bulk, work with the arrangement selection, and show
modal/progress dialogs.

## How you use them in Live

Extensions surface through the **right-click context menu** on the relevant item
in your Set. If an Extension applies to the thing you clicked (a clip slot, a
track, a clip, etc.), it appears in that menu — click its name to run or edit
it. There's no separate window or plugin format to manage; the tools live where
the work happens.

## How they're built (technical foundation)

- **Language:** Extensions are written in **TypeScript** and bundled (via
  **esbuild**) into a single CommonJS entry script that runs on **Node.js**.
  Ableton's press described this loosely as "familiar web technologies," which
  also means AI coding assistants handle it well — if you can clearly describe
  your idea, you can often get to a working Extension with little or no prior
  coding experience.
- **Runtime:** Live runs Extensions in an **Extension Host** built on Node.js.
  (The SDK package targets Node ≥ 22.11; the CLI notes Node ≥ 24.14.)
- **Anatomy:** an Extension is a folder with a **`manifest.json`** (`name`,
  `author`, `entry`, `version`, `minimumApiVersion`) plus its bundled code.
- **Programming model:** you export an `activate(context)` function, call
  `initialize(context, "1.0.0")` to get the API, then register commands and
  context-menu actions and operate on the typed **data model** (Song, Track,
  Clip, Device, and more).
- **Tooling:** `@ableton-extensions/create-extension` scaffolds a new project,
  and `extensions-cli` runs your Extension in Live and packages it into a
  distributable **`.ablx`** archive.

For the full breakdown of the package, API surface, CLI, and examples, see
[`docs/extensions-sdk-reference.md`](docs/extensions-sdk-reference.md).

## Requirements & availability

- **Live 12 Suite, Beta build 12.4.5 or later.** Extensions are **not**
  available in Live Standard, Intro, or Lite.
- The **Extensions SDK is free**. Third-party developers may choose to **charge**
  for the Extensions they build.

## How to get it / install

1. Join the **Ableton Beta Program** (via Centercode) if you aren't already in
   it.
2. Download and install **Live Beta** (e.g. `12.4.5b3`).
3. Install Extensions you've built or downloaded from **Live's Settings**.
4. To build your own, download the **Extensions SDK** zip from Centercode — it
   contains the SDK, CLI, a project generator, examples, and rendered docs.

## License

The SDK is covered by the **Ableton Extensions SDK License** (Ableton AG). In
short: it's a free, royalty-free, non-exclusive, non-transferable license to
build applications that communicate with Ableton products, and to publish or
sell those applications under your own brand. You may **not** redistribute or
reverse-engineer the SDK itself. The SDK is provided **"as is,"** without
warranty.

## Community

Discussion and sharing happen on the **Ableton Discord**:

- `#extensions` — using Extensions in Live.
- `#extensions-sdk` — building Extensions / using the SDK.
- `#extensions-gallery` — sharing and discovering community Extensions.

## Sources

- [Introducing Extensions SDK — Ableton Blog](https://www.ableton.com/en/blog/introducing-extensions-sdk/)
- [Extensions SDK landing page — Ableton](https://www.ableton.com/en/live/extensions)
- [Extensions SDK documentation](https://ableton.github.io/extensions-sdk/)
- [Ableton Extensions FAQ — Ableton Help](https://help.ableton.com/hc/en-us/articles/27303428331420-Ableton-Extensions-FAQ)
- The official **Extensions SDK `1.0.0-beta.0`** package (provided directly).
- Press coverage: [CDM](https://cdm.link/ableton-extensions-beta/),
  [Sound on Sound](https://www.soundonsound.com/news/ableton-announce-extensions-sdk),
  [Attack Magazine](https://www.attackmagazine.com/news/ableton-extensions-sdk-turns-live-suite-into-an-experimental-development-platform/),
  [MusicRadar](https://www.musicradar.com/music-tech/after-seeing-it-in-action-im-convinced-that-abletons-extensions-is-going-to-change-how-music-makers-use-live-forever),
  [The FADER](https://www.thefader.com/2026/06/02/ableton-extensions-sdk).
