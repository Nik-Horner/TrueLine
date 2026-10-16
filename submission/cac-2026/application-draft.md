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

That experience inspired TrueLine: a free tool focused on tracing, reviewing the outline, and setting its scale before exporting it. I built and refined the tracing functionality and tested it with parts.

## Technical challenge and response

One challenge was turning a traced curve into useful CAD geometry. An arc should stay an arc, rather than becoming thousands of tiny line segments. I built and refined the tracing functionality to fit suitable strokes as lines, circles, and arcs, with smoothing and a preview before acceptance.

Earlier image-processing approaches also struggled with more complicated parts. Using my machine-learning knowledge, I helped move the image-tracing approach to a small pretrained neural network. The app now uses MobileSAM with local inference, followed by edge processing and editable outlines. I tested the results and refined the tracing behavior; users still need to review the outline and verify measurements.

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

I used Codex and Claude Code for implementation, debugging, and testing assistance; AI generated much of the app's code. My direct work focused on building and refining the tracing functionality, especially representing curves as CAD arcs rather than many short line segments. I also used my machine-learning knowledge to help choose a small neural-network approach when earlier image processing struggled with complicated parts, and tested and refined the results.

TrueLine uses the existing pretrained MobileSAM model through ONNX Runtime Web for local image segmentation; I did not train that model. Codex also helped with bug fixes, tests, demo production, and drafting these submission materials.

## Links

- Source and downloads: https://github.com/Nik-Horner/TrueLine
- Windows installer: https://github.com/Nik-Horner/TrueLine/releases/latest/download/TrueLine-Setup.exe
- Mac preview instructions: https://github.com/Nik-Horner/TrueLine#readme
- Public Vimeo demo: https://vimeo.com/1236443371.

## Private information to enter in the contest portal

Confirm the entrant name and any teammates, grade, school, eligible district, account, and contact details directly in the portal. Keep home addresses, parent contact information, and account credentials out of this public repository.
