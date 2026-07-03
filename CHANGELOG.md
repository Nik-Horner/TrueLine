# Changelog

## 3.0.2
- **Smooth curves.** Freeform curves (waves, S-shapes, ellipses, spirals) now fit as
  tangent-continuous arc chains (biarcs) — they flow smoothly instead of looking faceted or
  kinked. Straight sides still fit as exact lines (a rounded rectangle = 4 lines + 4 arcs),
  circles and single arcs still snap to perfect primitives. Verified across the shape sweep
  and a rendered gallery.

## 3.0.1
- **Trace fitting reworked.** A traced circle now becomes one clean circle (was ~59 stray
  segments). Fit mode snaps clean lines, arcs, and circles to exact primitives, and turns
  organic shapes (ellipses, squiggles, spirals) into one smooth polyline that tracks the
  stroke tightly — "raw, but nice and smooth." Verified across 96 shape/noise cases.
- **Raw mode is now smooth.** Hand tremor is removed while curve detail is preserved,
  instead of a hard-angled simplification.
- **Set-scale / calibration fixed.** Leads with the reliable workflow: trace first, then
  click across a known feature and type its real size to lock the scale. Defaults to
  "Rescale drawing" when you already have geometry, hands you straight to the trace tool
  afterward, and confirms with a clear message. Tablet calibration is still there for
  digitizer boards.
- **Auto-update.** Installed copies now update themselves from a configured feed.

## 3.0.0
- Initial TrueLine release: pen-tablet tracing, full 2D CAD toolset, DXF/SVG/PDF export,
  layers, dimensions, editable keybinds (keyboard + tablet), portable build + installer.
