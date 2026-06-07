#target illustrator
#include "../utils/aiUtils.jsx"
#include "../utils/json2.jsx"
#include "../illustrator/Step7B_NestingImport.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun:   false,

    // For automated testing only — suppresses alert() dialogs for headless runs.
    suppressAlerts: false,

    logPath: "", // resolved below

    // ── Layer names ──────────────────────────────────────────────────────────
    cutlinesLayerName: "Cutlines",
    stickersLayerName: "Sticker",

    // ── Art sizing ───────────────────────────────────────────────────────────
    // Source PSD resolution. Placed artwork is sized by the PSD→AI factor
    // (pt/px = 72/sourceDPI) so it lands at the element's true physical size
    // instead of being fitted to the traced cutline height. MUST match
    // AI_BuildCutlines.jsx (Step 6 places the silhouette at the same DPI).
    sourceDPI: 300,

    // ── Area-based fallback matching ─────────────────────────────────────────
    // Max area ratio for accepting a match when names don't agree.
    // 1.1 = within 10% area difference. Raise only if elements are extremely
    // similar in size. Lower to force more exact area agreement.
    areaMatchTolerance: 1.1
};

var _root = $.fileName
    ? new File($.fileName).parent.parent.fsName
    : Folder.desktop.fsName;

CONFIG.logPath = _root + "/pipelines/AI_ImportNesting.log";

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
    if ($.global.__noteworthieSetup) return;
    try {

        log("[pipeline] === AI_ImportNesting start ===");
        log("[pipeline] dryRun: " + CONFIG.dryRun);

        // ── Resolve the working document ────────────────────────────────────
        // Pipeline 2 ends by re-opening the exported SVGs, so the ACTIVE document
        // is usually an SVG — not the working .ai. Don't blindly trust
        // activeDocument: find the open doc that carries a Cutlines layer (Step 6's
        // output). SVGs have no such layer, so this also gives a clear error
        // instead of the misleading "run Step 6" message when an SVG is in front.
        var resolved = _resolveWorkingDoc();
        if (!resolved.doc) {
            log("[pipeline] cannot resolve working doc | " + resolved.error);
            scriptAlert(resolved.error + "\n\nLog: " + CONFIG.logPath);
            return;
        }
        var doc = resolved.doc;
        log("[pipeline] document: " + doc.name);

        // ── Select Deepnest SVG file(s) ────────────────────────────────────
        var svgFiles = _selectSvgFiles(doc);
        if (!svgFiles || svgFiles.length === 0) {
            log("[pipeline] cancelled — no SVG file(s) selected.");
            return;
        }
        var f;
        for (f = 0; f < svgFiles.length; f++) {
            log("[pipeline] SVG: " + svgFiles[f].fsName);
        }

        // ── Select element art folder ──────────────────────────────────────
        var artFolder = _selectArtFolder(doc);
        if (!artFolder) {
            log("[pipeline] cancelled — no art folder selected.");
            return;
        }
        log("[pipeline] art folder: " + artFolder.fsName);

        // ── Read elements sidecar (required — for absolute art sizing) ─────
        // The {base}_elements.json sidecar (psdWidth) gives the PSD→AI scale used to
        // size artwork. Pipeline 2 writes it next to the working file alongside the
        // element art folder, so if the art folder resolved above, this is present too.
        // Treat it as required: without it we can't size art correctly, and silently
        // guessing (the old height-fit) is the very bug this pipeline fixed.
        var elementsData = _readElementsSidecar(doc);
        if (!elementsData) {
            log("[pipeline] no elements sidecar found next to the working file.");
            scriptAlert("Couldn't find the elements sidecar ({name}_elements.json) next to your\n"
                + "working file — it's needed to size the artwork. It's written by Pipeline 2\n"
                + "beside the element art folder; make sure both sit next to the .ai.\n\n"
                + "Log: " + CONFIG.logPath);
            return;
        }
        log("[pipeline] elements sidecar: " + elementsData.elements.length
            + " element(s), psdWidth=" + elementsData.psdWidth);

        // ── Run import ─────────────────────────────────────────────────────
        log("[pipeline] --- importing Deepnest layout ---");
        var result = runNestingImport(doc, svgFiles, artFolder, elementsData);

        if (!result) {
            scriptAlert("Import failed — Cutlines layer not found.\n"
                + "Make sure Step 6 has been run on this document.\n"
                + "Log: " + CONFIG.logPath);
            return;
        }

        // ── Completion ─────────────────────────────────────────────────────
        log("[pipeline] === AI_ImportNesting done ===");

        var msg = "Done.\n\n"
            + "  Placed:     " + result.matched   + " element(s) at nested positions\n"
            + "  Unmatched:  " + result.unmatched  + " element(s) — see log\n"
            + "  Layout:     regular rotated -90° at artboard top-left;\n"
            + "              irregular auto-rotated below with 2 mm gap\n"
            + "  Art placed: " + result.artPlaced  + " PNG(s) in Stickers layer\n\n";

        if (result.unmatched > 0) {
            msg += "WARNING: " + result.unmatched + " element(s) could not be matched.\n"
                + "Check the log for their names and positions. If Deepnest\n"
                + "renamed them, either rename the SVG paths to match the\n"
                + "element display names, or position those cutlines manually.\n\n";
        }

        msg += "Review the cutline layout, then run AI_RefineCutlines to continue.\n\n"
            + "Log: " + CONFIG.logPath;

        scriptAlert(msg);

    } catch (e) {
        log("[pipeline] FATAL | line " + e.line + ": " + e.message);
        scriptAlert("AI_ImportNesting failed.\nLine " + e.line + ": " + e.message
            + "\nLog: " + CONFIG.logPath);
    }
}

// ─── DIALOGS ──────────────────────────────────────────────────────────────────

// Resolves the working document. Returns { doc: Document|null, error: String|null }.
// The working file is identified by having a Cutlines layer (Step 6's output);
// SVGs opened by Pipeline 2 do not, so this avoids operating on the wrong doc.
function _resolveWorkingDoc() {
    if (app.documents.length === 0) {
        return { doc: null, error: "No document open.\nOpen your working .ai file first." };
    }

    // Prefer the active document when it is itself the working file.
    var active = app.activeDocument;
    if (active && findLayer(active, CONFIG.cutlinesLayerName)) {
        return { doc: active, error: null };
    }

    // Otherwise look for the single open doc that has a Cutlines layer.
    var candidates = [];
    var i;
    for (i = 0; i < app.documents.length; i++) {
        if (findLayer(app.documents[i], CONFIG.cutlinesLayerName)) {
            candidates.push(app.documents[i]);
        }
    }

    if (candidates.length === 1) {
        app.activeDocument = candidates[0];
        log("[pipeline] active doc was not the working file; switched to: "
            + candidates[0].name);
        return { doc: candidates[0], error: null };
    }
    if (candidates.length > 1) {
        return { doc: null, error: "Multiple open documents have a Cutlines layer.\n"
            + "Click the working .ai you want to nest, then run this script again." };
    }

    return { doc: null, error: "The front document has no Cutlines layer — it looks like an "
        + "SVG, not your working .ai.\n\nBring the working .ai (the file Step 6 created the cut "
        + "lines in) to the front, then run this script again." };
}

// Confirm dialog that auto-accepts under suppressAlerts (headless test runs).
function _confirm(msg) {
    if (CONFIG.suppressAlerts) return true;
    return confirm(msg);
}

// Deepnest output convention: saved next to the working file named
// "{base}_regular_nested.svg" and "{base}_irregular_nested.svg".
// Returns matching File[] (may be empty if neither is found yet).
//
// Primary lookup STATS the convention names directly rather than enumerating the
// folder: Folder.getFiles() returns nothing on some macOS folders (e.g. /tmp) where
// directory listing is blocked by TCC, even though File.exists and app.open work.
// A getFiles() pass is kept as a fallback for non-standard names where listing is
// permitted.
function _findNestedSvgs(doc) {
    var out = [];
    var base, parent;
    try { base = doc.fullName.fsName.replace(/\.ai$/i, ""); parent = doc.fullName.parent; }
    catch (e) { return out; }
    if (!base) return out;

    var regular   = new File(base + "_regular_nested.svg");
    var irregular = new File(base + "_irregular_nested.svg");
    if (regular.exists)   out.push(regular);
    if (irregular.exists) out.push(irregular);
    var i;
    if (out.length > 0) return out;

    // Fallback: enumerate for any *_nested.svg (works where getFiles is allowed).
    if (parent) {
        var all = parent.getFiles("*.svg");
        if (all) {
            for (i = 0; i < all.length; i++) {
                if (all[i] instanceof File && (/_nested\.svg$/i).test(all[i].name)) {
                    out.push(all[i]);
                }
            }
        }
    }
    return out;
}

function _findElementsFolder(doc) {
    var base;
    try { base = doc.fullName.fsName.replace(/\.ai$/i, ""); } catch (e) { return null; }
    if (!base) return null;
    return new Folder(base + "_elements");
}

// Reads the {base}_elements.json sidecar next to the working file, or null if it is
// absent/unreadable/invalid. Same convention + parse as Step 6's _readElementsFile.
function _readElementsSidecar(doc) {
    var base;
    try { base = doc.fullName.fsName.replace(/\.ai$/i, ""); } catch (e) { return null; }
    if (!base) return null;

    var f = new File(base + "_elements.json");
    if (!f.exists) return null;

    f.encoding = "UTF-8";
    if (!f.open("r")) return null;
    var text = f.read();
    f.close();
    if (!text) return null;

    var data;
    try { data = JSON.parse(text); }
    catch (e) {
        log("[pipeline] WARN | elements sidecar is not valid JSON: " + e.message);
        return null;
    }
    if (!data || !data.psdWidth || !data.elements) return null;
    return data;
}

function _selectSvgFiles(doc) {
    // Happy path: auto-discover {…}_nested.svg next to the working file.
    var found = _findNestedSvgs(doc);
    if (found.length > 0) {
        var names = [];
        var n;
        for (n = 0; n < found.length; n++) names.push(found[n].name);
        if (_confirm("Found " + found.length + " Deepnest SVG(s) next to your file:\n  "
                + names.join("\n  ") + "\n\nImport these?   (No = pick manually)")) {
            return found;
        }
    }

    // Manual fallback (multi-select via shift-click).
    if (CONFIG.suppressAlerts) return null; // headless: no dialog, treat as cancelled
    var files = File.openDialog(
        "Select Deepnest output SVG(s) — files ending in _nested.svg",
        "SVG:*.svg",
        true
    );
    if (!files) return null;
    if (files instanceof File) files = [files];

    // Guard: the pre-Deepnest Step 7A exports ({name}_regular.svg / _irregular.svg)
    // sit right next to the PSD and are easy to pick by mistake — importing them
    // would lay elements out UN-nested. Warn on anything not ending in _nested.svg.
    var suspect = [];
    var j;
    for (j = 0; j < files.length; j++) {
        if (!(/_nested\.svg$/i).test(files[j].name)) suspect.push(files[j].name);
    }
    if (suspect.length > 0) {
        if (!_confirm("These don't look like Deepnest output (expected names ending in "
                + "\"_nested.svg\"):\n  " + suspect.join("\n  ")
                + "\n\nThe pre-Deepnest cut-line SVGs place elements UN-nested.\n\n"
                + "Use the selected file(s) anyway?")) {
            return null;
        }
    }
    return files;
}

function _selectArtFolder(doc) {
    // Happy path: the per-element PNGs live in "{base}_elements" next to the file.
    var guess = _findElementsFolder(doc);
    if (guess && guess.exists) {
        if (_confirm("Use element art folder:\n  " + guess.fsName
                + "\n\nImport art from here?   (No = pick manually)")) {
            return guess;
        }
    }
    if (CONFIG.suppressAlerts) return null; // headless: no dialog, treat as cancelled
    return Folder.selectDialog(
        "Select the element art folder — the '{SKU}_elements' folder next to your PSD"
    );
}

main();
