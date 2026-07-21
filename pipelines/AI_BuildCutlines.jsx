#target illustrator
#include "../utils/json2.jsx"
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step6_CreateCutlines.jsx"
#include "../illustrator/Step7A_DeepnestExport.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun:         false,
    suppressAlerts: false,
    logPath:        "", // resolved below

    // ── Step 6: Create Cutlines ──────────────────────────────────────────────
    // Source PSD resolution. Step 6 places the silhouette at this DPI so PSD pixels
    // map 1:1 to real-world size (pt/px = 72/sourceDPI). THIS is the governing print
    // scale — not workingAreaWidthMm, which is now only a QA safe-area bound.
    sourceDPI:           300,
    // Margin spec — single source of truth in aiUtils.MARGIN_SPEC (avoids drift).
    workingAreaWidthMm:  MARGIN_SPEC.workingAreaWidthMm,
    workingAreaHeightMm: MARGIN_SPEC.workingAreaHeightMm,
    cutlineStrokePt:     0.25,
    cutlinesLayerName:   "Cutlines",
    stickersLayerName:   "Sticker",

    // ── Caption text (native authoring, placed at Step 6 for artist review) ──
    captionFont:      "Kalam-Regular",
    captionSizePt:    8,
    captionTracking:  -20,
    captionTextGapMm: 3.0,   // text top sits this far below the element outline bottom (review pose)

    // ── Caption auto-warp (Step 6, WC only) — warp text to a curved art base ──
    // Conservative: warps ONLY a confidently smooth, symmetric, arc-like base; wavy/ambiguous
    // bases stay flat (artist warps by hand). See aiUtils._capBaseArcFit / warpTextToBaseArc.
    captionWarpEnabled:        true,
    captionWarpMaxResidFrac:   0.5,       // arc-like gate: max fit residual RMS as a fraction of text height
    captionWarpMinBowMm:       0.5,       // clear-dip backup: edge dips >= this across the caption -> round
    captionWarpTightRadiusFactor: 1.0,    // ⚠ ROUNDNESS: warp when the curve's circle radius <= factor ×
                                          //     element width (size-relative, scale-free). 1.0 = "circle no
                                          //     bigger than the sticker". Round bases here ≤0.75×, flat ≥1.5×.
    captionWarpMaxTiltDeg:     35,        // ⚠ TILT CAP: skip the warp when the base under the caption is
                                          //     steeper than this (chord angle, deg) — the caption would
                                          //     climb the side. Must stay <= maxSeatRotationDeg (75) so the
                                          //     seat can still rotate a warped tilted caption. First guess —
                                          //     tune on a genuinely tilted round SKU (tilt is logged per element).
    captionWarpMaxBend:        0.6,       // clamp on the applied Arc-warp bend fraction (-1..1)
    captionWarpBendCalib:      1.0,       // bend magnitude scale: 1.0 = caption radius matches the base
                                          //     (concentric); <1.0 = gentler. Tune on a real round SKU.

    // ── Half-cut (shared aiUtils helpers) ────────────────────────────────────
    // The half-cut is drawn at birth here and re-synced by Steps 7B/8b/9A so it
    // always tracks the caption seam.
    halfcutLayerName:    "Halfcut",
    halfcutStrokePt:     0.25,
    halfcutExtendMm:     1.0,
    halfcutSeamSteps:    16,

    // ── Caption vector seat (aiUtils.seatPlateToOutline) ─────────────────────
    // Authoritatively seats the plate against the TRACED outline (the cut's own vector)
    // before the Unite, so the overlap is real in the cut's space — fixes the flat/shallow
    // detachment the PS raster seat can't guarantee. Ported from Step3B's seatCaptionConform
    // (inner-edge endpoints → rotate to chord → kiss to depth), edge probe swapped to vector.
    seatOverlapMm:       0.1,    // ⚠ KEY KNOB: submerged depth d of the inner edge into the art.
                                 //     In vector space this is the REAL overlap (no trace inset to
                                 //     eat it), so it can be small — raise if a caption reads detached,
                                 //     lower if it sits too far in. 0.1mm validated with seatSampleSteps=24.
    captionSeatOverlapMm: 0,     // caption embed PAST two-point contact (mm). 0 = endpoints exactly
                                 // on the border. Raise to a hair (e.g. 0.1) only if a concave base
                                 // pinches the Unite. Separate from seatOverlapMm (the TAB embed).
    seatSampleSteps:     24,     // bezier→polygon density for the SEAT probe (per segment). THIS is the
                                 //     floor lever: a finer polygon lets the seat measure the true curve,
                                 //     so a shallow 0.1mm overlap lands accurately. (Do NOT raise
                                 //     halfcutSeamSteps for this — that only densifies the seam and
                                 //     overflows setEntirePath; the seam is decimated to <=400 anyway.)
    seatConform:         true,   // rotate the plate so its inner edge runs parallel to the outline
    seatRotationSign:    1,      // ⚠ flip to -1 if captions tilt the WRONG way in validation
                                 //     (hedges app.getRotationMatrix's direction; AI is y-up)
    maxSeatRotationDeg:  75,     // anti-degenerate cap: a chord tilt beyond this skips rotation + flags
    seatBaselineEpsPt:   0.5,    // pt: baselines shorter than this (circular/1-char pill) skip rotation
    seatShrinkFrac:      0.15,   // overhang + convex-bulge rescue: inset both inner-edge ends by this
                                 //     fraction along the REAL boundary (also trims a rising corner off the ends)
    captionMidProtrudeFrac: 0.25,// convex-bulge guard: if the art protrudes into the pill at the inner-edge
                                 //     midpoint by more than this·2r (= r/2), relieve with one shrink, else flag
    seatDebug:           false,  // true → verbose [seatdbg] per-element trace (E0/B0 + inArt)

    // Image Trace tuning — overrides applied on top of the "Silhouettes" preset so the
    // cutline HUGS the silhouette edge. The preset is built to *simplify* (clean solid
    // shapes), which rounds concave detail and sits the line loose; these push it back
    // toward faithful edge-following. Modern Image Trace scale is 0-100:
    //   tracePathFidelity   higher = path follows the pixel edge more tightly
    //   traceCornerFidelity higher = sharper corners kept (less rounding of points)
    //   traceNoiseFidelity  the "Noise" control in px — LOWER keeps small features
    //                       (the notches between petals etc.); the preset runs higher
    //   traceThreshold      0-255 B&W cutoff = where the edge falls (tune to pull the
    //                       line in/out); null = keep the preset's value
    // Set any value to null to keep the preset default for that knob. The run logs each
    // as "[step6] trace opt | name: <preset> -> <applied>" so you can see what took
    // effect and tune from there. ⚠️ If concavities are still rounded after this,
    // traceNoiseFidelity is the prime suspect — lower it; if lowering makes it WORSE,
    // your build inverts the property (treats it as a fidelity %) so raise it instead.
    tracePathFidelity:   90,    // 0-100, higher = tighter hug
    traceCornerFidelity: 80,    // 0-100, higher = sharper corners
    traceNoiseFidelity:  5,     // px, lower = keep small detail (preset is higher)
    traceThreshold:      null,  // 0-255, or null to keep preset (tune for edge placement)

    // ── Cutline smoothing (corner-aware, post-trace) ─────────────────────────
    // Reproduces what the artist does by hand (Object>Path>Simplify): flatten the
    // trace's ruggedness while KEEPING intended sharp corners. Runs on the traced
    // outline in Step 6, BEFORE the caption warp/seat/half-cut derive from it, so
    // the whole cutline inherits the smoothed shape (a raster smooth in PS can't:
    // the later trace re-interprets it, and it's corner-blind — it rounds real
    // corners). Two knobs that INTERACT (see Step 6 / simplifyPathItem in aiUtils):
    //   simplifyToleranceMm    how far the cut may stray from the trace = how much
    //                          wobble it flattens. ~half the ~1.7mm white edge, so
    //                          the cut can never visibly leave the (white) rim.
    //                          UP = smoother but more shape drift; DOWN = more faithful.
    //   simplifyCornerAngleDeg turns sharper than this stay HARD corners; gentler
    //                          ones smooth. Sits between gentle curvature (~10-25deg
    //                          after thinning) and real corners (45deg+). If smoothed
    //                          curves look FACETED, raise it; if real corners get
    //                          ROUNDED, lower it.
    // Per-element before->after point counts are logged so you can see what took effect.
    simplifyCutline:        true,
    // ── SMOOTHNESS DIAL — the one number the artist tunes ─────────────────────────────
    // Max outward drift of the cut, as a PERCENT of the white edge. This is BOTH the smoothness
    // control and the safety cap, because smoothing == letting the cut drift outward to flatten
    // wobble: HIGHER = smoother (cut may move further off the white to round out bigger waves),
    // LOWER = more faithful to the traced edge. It is a HARD per-element guarantee — Step 6 gives
    // each element the MOST smoothing whose drift stays at/under this, backing that element's own
    // tolerance off until it fits (or leaving it un-smoothed if even minimal smoothing can't).
    // So NO cut ever leaves more than this fraction of the white margin, on any element or any SKU.
    // Drift is measured in BOTH directions (_maxDriftMm): inward — the direction that actually eats
    // the white band and approaches the art — counts against this budget exactly like outward. It
    // did not until 2026-07-17: the check discarded every inward point, so inward silently ran past
    // the cap (0.66mm vs 0.56mm at sm33) and thinned the white to ~1.03mm of 1.69mm.
    // 100% would put the cut at the outer white edge — stay well under. Artist workflow: set this,
    // run Pipeline 2, eyeball, adjust. Everything below is fixed internal tuning.
    smoothnessPct:          33,     // 20 tight/faithful .. 50 balanced .. 70 aggressive
                                    // 33 calibrated against the artist's Slovakia Simplify output
                                    // (2026-07-17): matches their node density to +0.30 nodes/path
                                    // (23.61 vs 23.30) at 0.084mm mean / 0.67mm max deviation — half
                                    // the gap of 30, at no cost in drift. 34+ overshoots (22.74).
                                    // NOTE this is the ONLY knob that moves the result: a sweep of
                                    // cornerAngleDeg 20..45 was INERT on that SKU (23.70..23.78
                                    // nodes) because a white-edged silhouette has no real corners
                                    // (max tangent break measured: 19deg). Do not conclude the corner
                                    // knob is dead — STAMPS (ST) skip the white edge in Step 2B, so
                                    // they keep genuine corners and it should matter there. Untested.
    whiteEdgeMm:            1.69,   // physical white-edge width (PS whiteEdgePx 20 @ 300dpi) — the budget base
    simplifyMaxToleranceMm: 0.85,   // ceiling the per-element adaptive search starts from and backs off
    simplifyCornerAngleDeg: 35,     // tangent break (deg) at/above which an anchor stays a hard corner
    simplifySampleSteps:    16,     // bezier sampling density (curve-aware; higher = more faithful)

    // Trace-junk filters. Image Trace on the whole sheet can emit spurious paths
    // beyond the real elements: a whole-sheet background compound (frame + every
    // outline) and tiny stray fragments. Drop them before they get named/grouped,
    // else they become ghost cutline groups (see Step 6 _collectTracedPaths).
    traceBackgroundAreaFrac: 0.5,   // path bbox >= this x full-sheet bbox -> background, drop
    traceMinElementAreaFrac: 0.15,  // matched path bbox < this x element bbox -> fragment, drop

    // ── Step 7A: Deepnest Export ─────────────────────────────────────────────
    // Extent ratio threshold: paths >= this are "regular" (90° rotation in Deepnest).
    // Tune on first real SKU run — every path's ratio is logged.
    deepnestRectThreshold: 0.82,

    // ── Default peel tab (Pipeline 1 rough placement for uncaptioned elements) ──
    // Resolved to File objects below (after _root). peelHereTabWidthMm is the authored width of
    // the PEEL HERE tab; when the chosen edge >= that + the fit margin, use PEEL HERE, else the
    // semi-circle. straightTolerance generalises the old horizontal-only edge search.
    peelHereTabWidthMm:              17.3,   // measured cutline width of Peel_Tab_B.ai (PEEL HERE)
    peelTabEdgeFitMarginMm:          2.0,
    peelTabEdgeStraightToleranceDeg: 8,
    peelTabPlacementGapMm:           2.0,    // gap the tab sits OUTSIDE the art edge (room to seat in)
    peelTabCategories:               ["MP", "TL"],  // self-labelled cats → peel tab, not caption
                                             //   MP=Maps, TL=Location Names
                                             //   (LM=Landmarks, TR=Transport, IC/FD stay captioned)
    peelTabEdgeSampleSteps:          12
};

var _root = $.fileName
    ? new File($.fileName).parent.parent.fsName
    : Folder.desktop.fsName;

CONFIG.logPath = _root + "/pipelines/AI_BuildCutlines.log";
CONFIG.peelTabAssetPathPeelHere   = _root + "/assets/Peel_Tab_B.ai";
CONFIG.peelTabAssetPathSemiCircle = _root + "/assets/Peel_Tab_A.ai";

// ─── SHARED: Step 7A export ───────────────────────────────────────────────────

function _runExportForNesting(doc, traceTuning) {
    log("[pipeline] --- Step 7A: Deepnest export ---");
    log("[pipeline] threshold: " + CONFIG.deepnestRectThreshold);
    var filesFolder = null;
    try { filesFolder = doc.fullName.parent.fsName; } catch (eFolder) {}

    var result = runDeepnestExport(doc);

    if (!result) {
        scriptAlert("❌ Step 7A failed — Cutlines layer not found.\n\n"
            + "Make sure Step 6 has been run on this document.\n\n"
            + "Send this to Josh:\n" + copyLogBeside(filesFolder, "Noteworthie_ERROR.log"));
        return { ok: false, phase: "step7a", error: "Cutlines layer not found" };
    }

    var svgsOk = !!(result.regularPath && result.irregularPath);

    log("[pipeline] === AI_BuildCutlines done ===");

    if (!CONFIG.dryRun) {
        var _prevUI = app.userInteractionLevel;
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        if (result.regularPath)   { _reopenFresh(result.regularPath); }
        if (result.irregularPath) { _reopenFresh(result.irregularPath); }
        app.userInteractionLevel = _prevUI;
    }

    var baseHint = "{name}";
    try { if (doc.fullName) baseHint = doc.fullName.name.replace(/\.ai$/i, ""); } catch (eName) {}

    // Surface a silent trace-tuning no-op at the alert level (not just the log): if
    // some knobs didn't take effect the cutlines fell back to the loose preset.
    var tuneWarn = "";
    if (traceTuning && traceTuning.requested > 0 && traceTuning.failed && traceTuning.failed.length > 0) {
        tuneWarn = "WARNING — trace tuning: only " + traceTuning.applied + "/" + traceTuning.requested
            + " knob(s) took effect (not honored: " + traceTuning.failed.join(", ") + ").\n"
            + "Cutlines may be looser than intended — see log.\n\n";
    }

    scriptAlert("✅ SVGs exported.\n\n" + tuneWarn
        + "  Regular   (" + result.regular   + " paths): " + (result.regularPath   || "—") + "\n"
        + "  Irregular (" + result.irregular + " paths): " + (result.irregularPath || "—") + "\n\n"
        + "Review both SVGs now open in Illustrator.\n"
        + "Move any misclassified paths between files, then File > Save each.\n\n"
        + "Then import each SVG into Deepnest:\n"
        + "  Regular   → 90° increments, gap 1mm\n"
        + "  Irregular → free rotation, gap 1.5mm\n\n"
        + "NEXT — after nesting:\n"
        + "  1. Save each Deepnest result next to this file, named ending in\n"
        + "     \"_nested.svg\"  (e.g. " + baseHint + "_regular_nested.svg).\n"
        + "  2. Bring the working .ai to the front and run AI_ImportNesting.jsx.");

    return {
        ok:           svgsOk,
        phase:        "step7a",
        regular:      result.regular,
        irregular:    result.irregular,
        regularPath:  result.regularPath  || null,
        irregularPath: result.irregularPath || null,
        error:        svgsOk ? null : "SVG export failed (see log)"
    };
}

// Opens an exported SVG, first closing any already-open document with the same
// path. Without this, a re-run finds the file already open from the previous run
// and app.open() just re-activates the STALE in-memory tab instead of reloading
// the regenerated file from disk — the artist sees old geometry.
function _reopenFresh(svgPath) {
    var target = new File(svgPath);
    var i;
    for (i = app.documents.length - 1; i >= 0; i--) {
        var d = app.documents[i];
        try {
            if (d.fullName && d.fullName.fsName === target.fsName) {
                d.close(SaveOptions.DONOTSAVECHANGES);
            }
        } catch (e) { /* untitled/no fullName — ignore */ }
    }
    app.open(target);
}

// ─── ENTRY POINT: BridgeTalk from PSAI_BuildAndExportCutlines.jsx ───────────────────────

// Serialises a status object to a JSON string for return across the BridgeTalk
// boundary. PSAI's bt.onResult parses this so its completion alert reflects the
// real outcome of the Illustrator half (instead of always saying "Done").
function _status(obj) { return JSON.stringify(obj); }

// Builds the working document from scratch (no template file), runs Step 6, saves,
// and (when fully matched) runs Step 7A. Returns a JSON status string describing the
// outcome — see _status. Also alerts in Illustrator for the artist looking at that app.
function buildDocAndImport(silhPngPath, elementsFilePath) {
    log("[ai-pipeline] === AI_BuildCutlines start ===");
    log("[ai-pipeline] silhouette PNG: " + silhPngPath);
    log("[ai-pipeline] elements file:  " + elementsFilePath);

    var doc = buildWorkingDocument();
    log("[ai-pipeline] working document built: " + doc.name);

    // Artist's job folder (where the sidecars live) — failure logs land HERE so they're
    // easy to find, not in the hidden ~/Library path. _fail() drops the log beside the
    // files and returns the status PS surfaces (errorLog → the PS dialog points the artist
    // straight to it, and carries the SPECIFIC reason instead of a bare "returned null").
    var artistFolderFs = null;
    try { artistFolderFs = new File(elementsFilePath).parent.fsName; } catch (eF) {}
    function _fail(reason) {
        var errLog = copyLogBeside(artistFolderFs, "Noteworthie_ERROR.log");
        log("[ai-pipeline] FAIL | " + reason + " | log -> " + errLog);
        return _status({ ok: false, phase: "step6", error: reason, errorLog: errLog });
    }

    var result;
    try {
        result = runCreateCutlines(doc, silhPngPath, elementsFilePath);
    } catch (e) {
        return _fail("Step 6 error (line " + e.line + "): " + e.message);
    }

    if (!result || result.error) {
        return _fail(result && result.error ? result.error : "Step 6 produced no result");
    }

    log("[ai-pipeline] step 6 complete | named: " + result.named
        + " | unmatched: " + result.unmatched);

    // Save the working document next to the incoming sidecars. buildWorkingDocument()
    // returns an unsaved "Untitled" doc; without a real fullName, Step 7A resolves its
    // SVG output path to "/Untitled-1_regular.svg" (filesystem root) and the export is
    // cancelled. Saving as {name}.ai beside {name}_elements.json lets Step 7A export
    // {name}_regular.svg / {name}_irregular.svg next to the PSD, where AI_ImportNesting
    // expects them. Done before the unmatched halt so the re-run path also has a saved doc.
    if (!CONFIG.dryRun) {
        var elemFile      = new File(elementsFilePath);
        var baseName      = elemFile.name.replace(/_elements\.json$/i, "").replace(/\.json$/i, "");
        var workingAiPath = elemFile.parent.fsName + "/" + baseName + ".ai";
        var _prevSaveUI   = app.userInteractionLevel;
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        doc.saveAs(new File(workingAiPath), new IllustratorSaveOptions());
        app.userInteractionLevel = _prevSaveUI;
        log("[ai-pipeline] working document saved: " + workingAiPath);
    }

    if (result.unmatched > 0) {
        log("[ai-pipeline] HALT | " + result.unmatched
            + " unmatched path(s) — rename before export.");
        var unmatchedLog = copyLogBeside(artistFolderFs, "Noteworthie_ERROR.log");
        scriptAlert("Cut lines created — but " + result.unmatched
            + " path(s) could not be named automatically.\n\n"
            + "Rename them in the Cutlines layer (each name must match its element's display name exactly).\n\n"
            + "When done, re-run this script directly (File → Scripts → Browse → AI_BuildCutlines.jsx)"
            + " to export SVGs for Deepnest.\n\n"
            + "Details: " + unmatchedLog);
        return _status({ ok: false, phase: "step6", named: result.named,
                         unmatched: result.unmatched, traceTuning: result.traceTuning,
                         errorLog: unmatchedLog,
                         error: result.unmatched + " cut shape(s) couldn't be matched to an element" });
    }

    // Pipeline 1 ends here: cut traced + native caption text placed. The artist reviews/reshapes
    // the captions in Illustrator, then runs Pipeline 2 (AI_BuildAndExportCutlines) to build the
    // pills + cut + half-cut and export for Deepnest. (Deepnest export moved to Pipeline 2.)
    if (!CONFIG.suppressAlerts) {
        scriptAlert("✅ Cut traced + captions placed.\n\n"
            + "Processed " + result.named + " element(s).\n\n"
            + "Review/reshape the caption text in Illustrator (move, shorten, curve to follow the art),\n"
            + "then run Pipeline 2 (Build and Export Cutlines).");
    }
    return _status({ ok: true, phase: "step6", named: result.named,
                     unmatched: result.unmatched, traceTuning: result.traceTuning });
}

// ─── MAIN: direct run after fixing unmatched paths ───────────────────────────

function main() {
    try {
        if (app.documents.length === 0) {
            scriptAlert("No document open.\nOpen the working .ai file first.");
            return;
        }

        var doc = app.activeDocument;
        var filesFolder = null;
        try { filesFolder = doc.fullName.parent.fsName; } catch (eFolder) {}

        log("[pipeline] === AI_BuildCutlines (nesting export) start ===");
        log("[pipeline] dryRun: " + CONFIG.dryRun);
        log("[pipeline] document: " + doc.name);

        _runExportForNesting(doc);

    } catch (e) {
        log("[pipeline] FATAL | line " + e.line + ": " + e.message);
        scriptAlert("❌ Couldn't export the SVGs.\n\n"
            + "Reason (line " + e.line + "): " + e.message + "\n\n"
            + "Send this to Josh:\n" + copyLogBeside(filesFolder, "Noteworthie_ERROR.log"));
    }
}

// Dispatch. When invoked through the BridgeTalk handoff (or the integration test),
// the caller sets $.global.__aiBuildCutlinesHandoff = true BEFORE evaluating this
// file, then calls buildDocAndImport() itself — so main() (the direct re-run path)
// must NOT auto-fire. Read-and-clear makes it a one-shot signal: $.global persists
// for the whole Illustrator session, so without clearing it a later direct
// double-click re-run would be wrongly suppressed.
var _viaHandoff = $.global.__aiBuildCutlinesHandoff;
$.global.__aiBuildCutlinesHandoff = false;
if (!_viaHandoff) { main(); }
