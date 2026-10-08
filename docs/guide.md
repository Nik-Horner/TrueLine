# User guide

[Back to TrueLine](../README.md)

## Setting the scale (calibration)

The reliable way, and the default: **trace at any size, then click 📏 Set scale, click across one
feature you measured, and type its real size.** The whole drawing snaps to true scale and the DXF
exports dimensionally accurate. It works with any tablet because it depends on a real measurement,
not on the tablet's pixel mapping.

## Tracing and assembly workflows

The **Tracing** menu contains the new workflows. **Tracing mode** (Tab when the
canvas has focus) hides the dock and palette and expands the drawing area. Its
floating controls provide pan, trace, undo, trace acceptance, and assembly access.
Space-drag and middle-drag pan; scrolling zooms on Windows. On macOS, trackpad
scrolling pans, and pinch or Command+scroll zooms.
Bind **Finish / accept trace** to a pen barrel button or tablet express key in the
Tablet panel.

### Review the fitted outline

Tracing now previews the original stroke in orange and its fitted outline in cyan.
Adjust tolerance, corner detection, or Fit/Raw before committing. The options show
maximum and RMS distance from the sampled original stroke to the fitted geometry,
in millimeters. **Enter / Accept** commits; **Esc / Discard** removes the preview.
Turn off **Review** for immediate stroke acceptance. Preview geometry is not part
of an export or saved project until accepted.

### Assemble complex parts from separate pieces

1. Trace the first portion and identify three well-spaced shared marks on the part.
2. Choose **Tracing → Trace assembly piece**. Name the piece and pick the shared
   marks in the existing drawing. Two marks are optional, with less verification.
3. Reposition the physical part, then trace the new portion and its shared marks.
   New geometry on the piece's layer is captured as an independent piece.
4. Choose **Assemble active piece** and pick the same marks on the new piece, in
   the same order. Review the placement preview and reference error. Placement is
   blocked if the maximum error exceeds the current tracing tolerance.
5. Accept placement. The piece stays on its own layer and keeps its dimensions.
   **Assembly pieces** lets you select a placed piece or reassemble it later.

Alignment applies only translation and rotation: it never stretches a piece to
hide a mismatch. Connections and overlapping edges remain explicit. Trim overlap,
check the contours, and join only when the fit is satisfactory. Recheck dimensions
across the assembled part with an independent measurement; reference error is a
consistency check, not a guarantee of physical accuracy. Assembly metadata and
unfinished pieces are saved with the project, and placement can be undone.

### Set up a photo

Import an image underlay, then use **Rotate image**, **Correct photo perspective**,
and **Calibrate photo measurements** from the Tracing menu.

Perspective correction needs a known rectangle on the same flat plane as the part.
Pick top-left, top-right, bottom-right, and bottom-left, then enter real width and
height in millimeters. The corrected image covers that rectangle, so the whole
part must lie inside it. Rectification preserves aspect ratio at a maximum of
2048 pixels on either side; it cannot correct lens distortion or a non-flat part.
Undo restores the original image.

Photo calibration combines at least two known lengths using a uniform least-squares
scale and reports the RMS measurement error. It resizes only the image; existing
geometry retains its dimensions. Use features at different positions and verify
an additional length before tracing.

### Auto-trace a part photo

Choose **File → Upload image**, then **File → Auto-trace image outline**. TrueLine compares the
image with its border background and previews the largest separated part in cyan. Choose **Crop part** and drag a box
around one part with a background margin, adjust edge contrast if needed, then choose **Add outline**.
Circular profiles are fitted as circles; other profiles become closed polylines on the current layer.
Tiny or uncertain openings are filtered by default to suppress texture; enable **Keep small or
irregular openings** when these are real part features. Cancel leaves the drawing unchanged. The extraction runs locally; no model
download or network connection is needed. It works best with the whole part in frame, a visible
margin around it, and a plain background that contrasts with the part. Shadows, glare, texture, or
overlapping objects can change the detected edge, so inspect the selected contours and edit them
before export. The image starts at an assumed pixel scale; use a known measurement to set the true
size before making a dimensionally accurate DXF.

Choose **Edit outline** in the auto-trace popup to correct the preview before adding it:

- Drag polygon points; double-click an edge or use **Insert point** to add a handle.
- Use **Remove point** or **Remove outline** to remove extra detail or a false opening.
- Drag circle centers or radius handles; **Convert to points** allows an irregular shape.
- Use **Draw opening** to add a missing cutout, then **Finish opening** to close it.
- Use +/− to zoom; Shift-drag or **Pan view** moves the photo. On Mac, trackpad scrolling pans and pinch or Command+scroll zooms.
- Arrow keys nudge the selected handle (Shift moves 10 pixels). **Undo edit**, **Redo edit**
  and Ctrl/Cmd+Z work inside the preview; **Reset edits** restores the automatic result.

Corrections stay in the preview until **Add outline**. Cancel discards them. Automatic tracing
settings stay disabled while corrections exist so they cannot overwrite your work; reset edits
before changing the crop or contrast. Self-crossing or incomplete individual contours cannot be added.

The review popup keeps its actions visible in short windows, supports exact crop bounds by keyboard,
and processes the image in a cancellable worker. Full workshop scenes still require a crop. Strong
shadows can distort the silhouette, and touching objects are traced as one connected part.

### Check and join outlines

**Check contours** reports gaps within 0.5 mm, open endpoints, duplicate edges,
zero-length edges, branches, and intersections, including within polylines. Select an issue
to locate it, or show all problem marks. Checks use selected geometry or visible
geometry; the pre-export review covers all exported entities, including hidden
layers. Open paths may be intentional for engraving or annotation.

**Join contours** combines unbranched lines, arcs, and polylines. Its adjustable
millimeter tolerance determines which gaps receive explicit straight connectors;
existing arcs are preserved. Branches need manual repair. Joining stays within
layers unless you explicitly choose to join across layers onto the current layer.
The summary shows how many connectors will be added, and joins can be undone.

### Save files and recover work

Desktop **Save project** opens a native save dialog and clears the unsaved indicator
only after the file is successfully written. Canceling or a write failure leaves
the drawing unsaved. Browser previews start a download and keep the indicator
because browsers cannot confirm whether a download completed.

Autosave creates device-local recovery backups independently of project-file saves.
**Recovery history** lists up to 12 recent revisions, with a 64 MiB history budget
(the latest revision is always retained). IndexedDB supports image-heavy projects
that exceed localStorage's quota; localStorage keeps an additional latest-copy
fallback where possible. Restoring a revision marks the drawing unsaved. Save a
project file to preserve it outside this device. Desktop launches use a stable
local origin so recovery and tablet settings survive restarts.
