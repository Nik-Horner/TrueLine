# Congressional App Challenge cover

Upload **`trueline-cover-600x800.jpg`** to the application's cover-photo field. It is a 600×800-pixel portrait JPEG (3:4), matching the portal's preferred dimensions and format.

As requested by the entrant, the cover uses **TrueLine's existing logo** from `build/icon.png`, centered on its matching dark brand background (`#0b0e13`). The original artwork is displayed at 400×400 pixels without redrawing, extra text, or generated artwork. The final JPEG has been visually inspected.

## Reproduce

From the repository root, with dependencies installed:

```sh
node submission/cac-2026/cover/capture-cover.mjs
```

Requires Chromium at `/usr/bin/chromium`, or set `CHROME_BIN`. The script displays the original PNG in a local HTML page, captures the 600×800 JPEG, and records source dimensions and SHA-256 in `capture-manifest.json`. It does not modify the logo or production application, publish anything, or submit the application.

Superseded app-screenshot covers and source captures are excluded from version control.
