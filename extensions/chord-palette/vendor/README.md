# vendor/

Place the two packages from your **Ableton Extensions SDK** download here:

- `ableton-extensions-sdk-1.0.0-beta.0.tgz`
- `ableton-extensions-cli-1.0.0-beta.0.tgz`

`package.json` references them via `file:./vendor/…`. The `.tgz` files are
**gitignored on purpose** — the Extensions SDK licence does not permit
redistributing the SDK, so it must not be committed to this repository. Each
developer copies them in from their own SDK download before running
`npm install`.
