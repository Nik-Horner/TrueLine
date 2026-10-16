# TrueLine third party credits

TrueLine is distributed under the MIT License. These acknowledgments describe bundled components and development assistance; they do not claim that the student authored the components below.

| Component | Role | License and source |
| --- | --- | --- |
| Electron | Desktop application shell | MIT; https://github.com/electron/electron |
| Node.js | Desktop JavaScript runtime and development tooling | Node.js license and third-party notices; https://github.com/nodejs/node/blob/main/LICENSE |
| MobileSAM | Pretrained local image segmentation | Apache 2.0; https://github.com/ChaoningZhang/MobileSAM; bundled notice in `models/mobile-sam/NOTICE` |
| ONNX Runtime Web | Local model execution | MIT and bundled third-party notices in `js/vendor/onnx/` |
| Inter, Chakra Petch and IBM Plex Mono | Application typography | SIL Open Font License 1.1; `fonts/OFL.txt` and `fonts/Inter-OFL.txt` |
| Codex and Claude Code | Most application code; current Codex fixes, tests, demo, and writing | Disclosed in `application-draft.md`; creator identified both tools |

MobileSAM incorporates Segment Anything and TinyViT components acknowledged in its bundled notice. TrueLine does not claim to have trained or fine-tuned this model. The exact bundled weights and checksums are documented in `models/mobile-sam/manifest.json`.

The demo uses an original illustrated sample mounting plate created for this submission. It is not presented as a real photograph or a dimensional accuracy benchmark. No third-party music or real customer part data is needed for the demo.
