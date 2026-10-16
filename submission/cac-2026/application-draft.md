# TrueLine Congressional App Challenge application draft

TrueLine turns a traced part or part image into an editable 2D CAD outline that can be scaled using a known measurement and exported for fabrication. The responses below use the creator's description, testing example, and the current app. The creator confirmed that this is an independent project developed with Codex and Claude Code. Review the proposed future improvements before submission.

## App title

TrueLine

## App purpose

TrueLine is free, open-source tracing software that helps makers turn physical parts and part images into editable, scaled 2D CAD outlines for fabrication, repair, and pattern making.

## App description

TrueLine is a free, open-source desktop app for recreating a part when its original CAD drawing is unavailable. Users can trace with a mouse or pen tablet, or import an image and preview an automatically detected outline. They can correct the outline, set its scale from a known measurement, and export DXF, SVG, or a vector PDF. Projects can also be saved and reopened.

The app is intended for makers, students, hobbyists, and people working on repair or fabrication projects. Image processing runs locally, so part images do not need to be uploaded to a service. Users must inspect the detected edges and verify dimensions before fabrication; a photograph alone does not establish the part's true dimensions or reveal hidden features. TrueLine creates 2D outlines, not complete 3D solid models.

## Inspiration

My dad and I had a physical part but no CAD model for it. We needed a way to turn the part into a usable drawing. We tried taking a picture and tracing it in SolidWorks, but that did not work well for us. We also found a paid solution that cost about $1,500.

That experience inspired TrueLine: a free tool focused on tracing, reviewing the outline, and setting its scale before exporting it. I personally designed the interface and shaped the tracing experience through testing.

## Technical challenge and response

While testing the tracing workflow, I found that a curve could turn into far too many short edges. In CAD, an arc should be represented as an arc rather than thousands of tiny line segments. That made the way a trace was represented an important problem to solve.

We added smoothing to improve the tracing result. TrueLine's fitting workflow can represent suitable strokes as lines, circles, and arcs, and lets the user review the fitted outline before accepting it. My contribution was identifying the problem through use and testing the tracing experience; AI wrote most of the implementation. The goal was to produce cleaner geometry that follows the intended shape, rather than simply preserving every small movement from the input.

## Learning and biggest takeaway

The tracing problem taught me that more points and edges do not automatically produce a better CAD drawing. The geometry needs to represent the intended shape, and an arc should remain a usable arc. Testing the output helped me identify what needed to improve.

## Future version

Suggested product direction, for the creator to confirm:

I would improve the photo-tracing workflow for difficult lighting and backgrounds, make uncertain edges easier to review, and test it with a wider range of real parts. I would also make it easier for a new user to verify scale with a second known measurement before exporting.

## Tools and languages

- JavaScript, HTML, and CSS for the interface and application logic.
- Electron and Node.js for the desktop application.
- Canvas for interactive 2D drawing and rendering.
- The pretrained MobileSAM model with ONNX Runtime Web for local image segmentation. The model was not trained or fine-tuned by the student.
- Git and GitHub for source control; automated Node.js and Chromium tests for validation.
- Codex and Claude Code for AI coding assistance with most implementation; Codex also assisted the current bug fixes, testing, demo production, and application drafting.

## AI use and personal contribution disclosure

I used Codex and Claude Code extensively, and AI wrote most of TrueLine's code. My personal contributions were designing the interface and shaping the tracing experience through hands-on testing. The original need came from a project my dad and I were working on: recreating a physical part without a CAD model. Codex also assisted with submission preparation, including bug fixes, testing, demo production, and drafting these materials.

TrueLine additionally uses an existing pretrained MobileSAM model through ONNX Runtime Web to help detect part outlines locally. That is a feature of the app, separate from the AI tools used to develop it.

The live form explicitly allows AI use and asks for this disclosure; preserve it accurately in every submitted version. Judges assess the student's disclosed contributions under the contest rules.

## Links

- Source and downloads: https://github.com/Nik-Horner/TrueLine
- Windows installer: https://github.com/Nik-Horner/TrueLine/releases/latest/download/TrueLine-Setup.exe
- Mac preview instructions: https://github.com/Nik-Horner/TrueLine#readme
- Public YouTube or Vimeo demo URL: **not uploaded yet**.

## Private information to enter in the contest portal

Confirm the entrant name and any teammates, grade, school, eligible district, account, and contact details directly in the portal. Keep home addresses, parent contact information, and account credentials out of this public repository.
