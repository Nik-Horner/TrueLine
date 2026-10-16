# TrueLine demo video

Revision 7 is a 1 minute 26 second demonstration of free, open-source tracing software for makers. It follows one illustrated L-shaped mounting plate from reference to usable CAD, with a complete manual-tracing route followed by a quick automatic-outline route. It retains the Inter typography and light presentation.

## Files

- `output/trueline-cac-demo-v7.mp4`: current 1920×1080 H.264 video at 30 fps.
- `output/trueline-demo-poster.jpg`: opening reference-part versus finished-CAD comparison.
- `output/trueline-demo.srt` and `output/trueline-demo-transcript.txt`: current captions and transcript.
- `output/part-reference.png` and `output/part-cad-outline.png`: the illustrated reference and actual application result used in the opening.
- `output/sample-mounting-plate.png`: original raster reference illustration generated for this demo.
- `output/sample-mounting-plate.trueline.json`: actual completed project.
- `output/exports/untitled.dxf`: actual downloaded part outline.
- `output/auto-outline-preview.jpg`: actual automatic detection preview of the same mounting plate.
- `output/capture-manifest.json` and `output/video-metadata.json`: checks and encoded media details.

The separate 600×800 application cover in `../cover/` retains TrueLine's original logo.

## Workflow

The part has an asymmetric outer profile with rounded corners, three mounting holes and an adjustment slot. The app imports its reference illustration, and the video traces the outer profile, each bolt hole and the slot with actual pointer input. Each stroke passes through the real fitting preview and acceptance controls. The image underlay is removed to inspect the completed CAD, the drawing is scaled to a known 80 mm height, and the actual export UI downloads a DXF.

The opening compares the reference part with that completed result. The part is an original illustration, not a photograph or a claim of a manufactured part. Camera crops and edited timing are presentation choices; this is not a speed benchmark. Verify independent physical measurements before fabrication.

After the manual workflow, the demo introduces a second route: take an overhead photo, import it, run Auto-trace, review and accept the outline. The screen demonstration uses the original part illustration as the photo stand-in; no physical tablet or camera was filmed. Automatic detection uses pretrained MobileSAM and ONNX Runtime; no custom-training claim is made. The video also identifies Nik Horner, purpose/audience, JavaScript, HTML/CSS, Canvas and Electron. It discloses that AI wrote most of the code using Codex and Claude Code, and that AI assisted video production.

## Reproduce

Use the TrueLine source from PR 4, including its bundled Inter font, install dependencies, and run from the repository root:

```sh
node submission/cac-2026/demo/render-demo.mjs
```

Requires Chromium (`CHROME_BIN`, default `/usr/bin/chromium`), ffmpeg and ffprobe. The script runs the actual app locally, clears its generated frame/export directories, and replaces the selected output files. Only the selected deliverables are tracked; raw frames and earlier edits are ignored. The video remains silent with burned-in captions; nothing has been uploaded or submitted.

## Verified output

The app accepted five closed CAD entities: the outer profile, three circles and the slot. The calibrated height is 80 mm within floating-point precision. The actual downloaded DXF was read back and contained those five closed entities without parser warnings. The app produced no uncaught page errors. Automatic outline detection also found and accepted five contours. The full 86-second video decoded without errors, and the reference, tracing, finished outline, scale and export captures were inspected.

The opening manual instruction is “Lay the part on a drawing pad and begin tracing.” Long static holds around trace acceptance, review, scaling and export have been shortened. Editorial timing omits processing waits; it does not promise instant inference.
