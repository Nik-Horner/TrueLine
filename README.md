# TrueLine

Trace physical parts or photos into CAD outlines for CNC, fabrication, and pattern making.
Free, open source, and offline. Export DXF, SVG, or a PDF at true scale.

[![Download for Windows](https://img.shields.io/badge/Download-Windows-2ea44f?style=for-the-badge&logo=windows)](https://github.com/Nik-Horner/TrueLine/releases/latest/download/TrueLine-Setup.exe)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-222222?style=for-the-badge&logo=apple)](https://github.com/Nik-Horner/TrueLine/actions/runs/37725118532/artifacts/11527617534)
[![MIT License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

**Windows:** stable installer. **macOS 12+:** unsigned preview for Apple Silicon and Intel;
GitHub sign-in is required to download. Unzip the download, open the `arm64` DMG for
Apple Silicon or `x64` DMG for Intel, then drag TrueLine into Applications.
[Latest development builds](https://github.com/Nik-Horner/TrueLine/actions/workflows/desktop-build.yml).

![TrueLine tracing a sketch into CAD geometry](assets/demo.gif)

## Get started

1. **Trace or upload.** Draw with a mouse or pen tablet, or choose **File → Upload image**
   and **Auto-trace image outline**. Photograph one flat part against a contrasting background.
2. **Review and correct.** Check the preview and use **Edit outline** to adjust points or openings.
3. **Set scale and export.** Click **Set scale**, measure a known feature, enter its real length,
   and export DXF, SVG, or PDF.

Automatic photo outlines need review, especially around shadows, glare, and obscured edges.
Calibrate with a known measurement and verify dimensions before fabrication.

## Features

- **Editable photo outlines:** local AI-assisted tracing, crop, point correction, and opening edits.
- **Drawing and cleanup:** lines, circles, arcs, fitted freehand curves, trim, offset, fillet, and chamfer.
- **Accurate setup:** snapping, layers, dimensions, photo perspective correction, and calibration.
- **Tablet and Mac controls:** customizable shortcuts, pen buttons, Retina rendering, and trackpad navigation.
- **Save and export:** DXF import/export, SVG, PDF, native projects, autosave, and recovery history.

## Learn more

- [User guide](docs/guide.md) — tracing, photo setup, assembly, and outline correction.
- [Development](docs/development.md) — builds, tests, model evaluation, and releases.
- [Changelog](CHANGELOG.md)

## Run from source

Requires Node.js 22.12+; Node 24 is recommended.

```bash
npm ci
npm start
```

## License

[MIT](LICENSE). Bundled fonts use the [SIL Open Font License](fonts/OFL.txt).
[MobileSAM](models/mobile-sam/NOTICE) uses Apache 2.0;
[ONNX Runtime](js/vendor/onnx/LICENSE) uses MIT.
