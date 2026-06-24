# Native-Caption Rewrite — Validation Record (2026-06-25)

Branch `feature/illustrator-native-rewrite`. Plan: `docs/superpowers/plans/2026-06-24-native-captions-wiring.md`.
All in-app runs driven via `osascript … do javascript file` (alerts neutralised, `DONTDISPLAYALERTS`),
**run 2× for determinism**; goldens are log lines / structural counts (blind to pixels).

## Validated (in Adobe, deterministic)

| Task | What | Evidence |
|---|---|---|
| 1 | `buildCaption` native print | 3 cases: ok, fused cut (cutSubpaths=1), half-cut, **textMember=yes, pillVisible=true**, note `WC\|1\|a<area>`; visual confirmed by artist |
| 2 | Step 6 places native text; Pipeline 1 stops | 26 named, 0 unmatched, 24 text frames + 24 named outlines, **0 groups/pills/halfcuts** (built later), no SVGs |
| 3 | Pipeline 2 build + export | 24 built, **groups=24 pillsVisible=24 textMembers=24 halfcuts=24**, both SVGs; visual full-sheet confirmed |
| 5 | Step 8b normalise | scaled element 529→895 px² → reset to **529 (0% err)**; **idempotent** (pass2/3: reset=0, atSpec=24) |
| 6 | Step 7B caption rides group | caption text + pill stay rigid to the cut across a 37° rotation + translation |
| 7 | Step 10 gathers caption | clip group = [path mask, caption text, pill]; per-element PNG renders the caption; cut-path drill-down fix |
| 4 | Pipeline 1 PS restructure | 26 grouped, **slim sidecar (0 caption fields)**, 26 art PNGs, 0 caption PNGs, no plate (WC), silhouette written |
| 9 | **WC end-to-end** (real PS artifacts → AI) | slim sidecar + real silhouette → `named=26, unmatched=0` → Pipeline 2 `built=24, 0 failed`, groups/pills/text/halfcuts=24, both SVGs; **2× byte-identical** |

Three real bugs were caught + fixed by these validations: a stale `styleCode` reference (Step 8b),
the scale reference (switched bbox-height → rotation-invariant pill **area**, which the seat's tilt
doesn't corrupt), and the group-wrapped cut mask (Pathfinder Unite wraps the cut in a group; Step 10
now drills to the inner path).

## NOT yet validated — follow-ups (need environments unavailable headless)

1. **GC-LM SKU end-to-end.** The GC plate path is implemented (`exportCaptionPlatePng` in PS;
   `_placeCaptionPlateRaster` in `buildCaption`) but **unvalidated** — no test SKU with a
   `Caption_Plate.psd` was available. Needs a GC SKU to confirm the plate PNG exports, places behind
   the native text, scales to the caption, and leaves the cut = outline+pill. Tune `plateHeightMm` /
   `plateWidthPadMm`.
2. **Full combine→white-edge→handoff (literal BridgeTalk).** Pipeline 1's combine (Step 1/2/2B) was
   not re-run here — it's unchanged by this work and depends on the source PSDs + the *White edges*
   PS action. The end-to-end above started from the post-2B fixture's real PS artifacts, so the slim
   sidecar → AI data contract is proven; the literal PS→AI BridgeTalk transport is verbatim-ported
   from the (working) PSAI handoff. Confirm on the artist's machine with the PS action loaded.
3. **Golden re-baselining.** `tests/integration/expected/ps-build-elements-expected.txt` (and any
   caption-touching AI goldens) encode pre-rewrite behavior (e.g. `[step3A]` lines) and are stale.
   They need regeneration via the formal runners on the artist's PS environment — do NOT hand-author.
   The PSAI runner + golden were removed (PSAI is deleted).
