# TrueLine submission validation

Validation targets the TrueLine source used for the demo, commit `9d5a35f70a84434fdf48692031761f4b2bff21d4`. [Pull request 4](https://github.com/Nik-Horner/TrueLine/pull/4) contains the fixes and submission materials. These changes require a new release before they appear in published Windows and Mac downloads.

## Bugs addressed

- **Invalid scale input:** reject zero, negative, and non-finite real lengths before changing geometry or stored calibration.
- **SVG names and labels:** escape XML characters in layer names, colors, and text so punctuation cannot break the export.
- **Exported text bounds:** include labels in SVG/PDF page bounds and account for text rotation, preventing labels outside the part from being clipped.

## Completed checks

- Baseline `npm test`: passed before changes.
- `npm run verify:models`: bundled ONNX model checksums and inference runtime assets passed.
- `DISPLAY=:99 npm run test:desktop`: native Electron startup, undo/redo, and 26 production checks passed, including drawing, editing, project round-trip, and DXF/SVG/PDF export.
- `CHROME_BIN=/usr/bin/chromium npm run test:mac`: menu/lifecycle checks and simulated Mac shortcut, focused-text, and Retina rendering checks passed. This Linux run is not a native macOS installer test.
- `npm test` passed after the final fixes.
- `CHROME_BIN=/usr/bin/chromium npm run test:scale-export` passed after the final fixes: invalid inputs leave geometry/history intact, valid scaling survives undo/redo, exported XML parses with punctuation, and SVG/PDF preserve rotated labels outside the drawing.
- `DISPLAY=:99 npm run test:desktop` passed again after the final fixes: all 26 production checks.
- Auto-trace and outline-editor UI suites passed during the audit.
- `git diff --check` passed before the code commit.
- Final demo output: 86 seconds, H.264 at 1920×1080 and 30 fps, with Inter typography and matching captions. It traces a complete illustrated mounting plate by hand, including three mounting holes and a slot, then demonstrates optional automatic outline detection.
- Actual app checks: five CAD entities, three bolt-hole circles, one closed outer profile and one closed slot; calibrated part height 80.0000017372436 mm. The downloaded DXF parses into the same five closed entities without warnings. The automatic route also found and accepted five contours. No uncaught page errors.
- The full video decoded without errors. Reference, tracing, finished outline, scale and export frames were inspected for readability and cropping.
- Cover output: 600×800-pixel portrait JPEG using TrueLine's existing logo, as requested.

## Scope

The demo uses an original illustrated sample part to show the workflow. It is not evidence of dimensional accuracy on a manufactured part. Real photos require review and physical measurements.

## Desktop CI

[Desktop Builds run 38848173932](https://github.com/Nik-Horner/TrueLine/actions/runs/38848173932) completed successfully on Windows, Apple Silicon macOS, and Intel macOS. All three jobs ran the new calibration/export regression. Windows installer construction and both Mac candidate builds passed; both Mac jobs also passed installed-package checks. These are CI candidate artifacts, not a published release.

The Inter typography change passed the auto-trace UI suite at four viewport sizes and the calibration/export browser regression. The updated [Desktop Builds run 38850991003](https://github.com/Nik-Horner/TrueLine/actions/runs/38850991003) also passed on Windows, Apple Silicon macOS, and Intel macOS, including packaging checks.
