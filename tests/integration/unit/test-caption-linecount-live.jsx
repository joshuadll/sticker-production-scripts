// test-caption-linecount-live.jsx -- LIVE DOM validation of the multi-line caption fix in
// photoshop/Step3B_CaptionWhite.jsx, on the real St Elizabeth's Cathedral geometry.
//
// The unit test (test-caption-linecount.jsx) covers the pure decision logic. This exercises
// the DOM-bound path the unit test can't: reading textItem.contents off a real text layer,
// the old vs new detector on the SAME two-line geometry, and the straight-spine override
// actually producing a straight spine from createWhiteFromText.
//
// Opens the committed fixture, edits ONE caption in memory (St Elizabeth's: split the
// translation onto a second line, as the artist does), asserts, and CLOSES WITHOUT SAVING
// -- the fixture on disk is never modified.

#target photoshop

var CONFIG = {
    suppressAlerts:          true,
    logPath:                 Folder.desktop.fsName + "/test-caption-linecount-live.log",
    whiteSliceStepPx:        12,
    whitePenPadPx:           20,
    whiteStraightSnapPx:     6,
    whiteCurvedHeightPctile: 0.9
};

#include "../../../utils/psUtils.jsx"
#include "../../../photoshop/Step3B_CaptionWhite.jsx"

// --- TEST HARNESS -------------------------------------------------------------

var _passed = 0, _failed = 0;
var _logPath = CONFIG.logPath;
var _cf = new File(_logPath); _cf.open("w"); _cf.close();

function testLog(msg) {
    $.writeln(msg);
    var f = new File(_logPath);
    f.encoding = "UTF-8"; f.lineFeed = "Unix";
    f.open("a"); f.writeln(msg); f.close();
}
function assert(description, actual, expected) {
    var a = String(actual), e = String(expected);
    if (a === e) { testLog("[linecount-live] PASS | " + description); _passed++; }
    else { testLog("[linecount-live] FAIL | " + description); testLog("  expected: " + e); testLog("  actual:   " + a); _failed++; }
}

// The DELETED +/-5%-centre-band detector, replicated VERBATIM here ONLY to demonstrate the
// bug against the real geometry (old: misses it -> new: catches it). Do NOT reintroduce.
function _oldCentreBandProbe(doc, textLayer) {
    var b = layerBoundsPx(textLayer);
    var w = b[2] - b[0], h = b[3] - b[1];
    if (w <= 0 || h <= 0) return false;
    var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    var halfW = w * 0.25, halfBand = h * 0.05;
    var prevActive = doc.activeLayer;
    loadLayerTransparency(textLayer);
    var inked = true;
    try {
        doc.selection.select(
            [[cx - halfW, cy - halfBand], [cx + halfW, cy - halfBand],
             [cx + halfW, cy + halfBand], [cx - halfW, cy + halfBand]],
            SelectionType.INTERSECT, 0, false);
        doc.selection.bounds;
    } catch (e) { inked = false; }
    try { doc.selection.deselect(); } catch (e2) {}
    try { doc.activeLayer = prevActive; } catch (e3) {}
    return !inked;
}

// Collect every text layer (recursively through groups) as { layer, contents }.
function collectTextLayers(container, out) {
    var i;
    for (i = 0; i < container.artLayers.length; i++) {
        var al = container.artLayers[i];
        if (al.kind === LayerKind.TEXT) {
            var c = ""; try { c = al.textItem.contents; } catch (e) {}
            out.push({ layer: al, contents: c });
        }
    }
    for (i = 0; i < container.layerSets.length; i++) collectTextLayers(container.layerSets[i], out);
    return out;
}

// --- RUN ----------------------------------------------------------------------

var fixturePath = new File($.fileName).parent.parent.fsName + "/fixtures/elements-captioned-ungrouped.psd";
var doc = null;
try {
    var fx = new File(fixturePath);
    if (!fx.exists) {
        testLog("[linecount-live] FAIL | fixture not found: " + fixturePath);
        _failed++;
    } else {
        // Close any already-open copy so we load pristine from disk.
        for (var d = app.documents.length - 1; d >= 0; d--) {
            try {
                var nm = app.documents[d].name;
                if (nm && nm.indexOf("elements-captioned-ungrouped") >= 0)
                    app.documents[d].close(SaveOptions.DONOTSAVECHANGES);
            } catch (eC) {}
        }
        doc = app.open(fx);

        // Match on an apostrophe-free, accent-free substring so PS smart-quote conversion
        // (straight ' -> curly) can't defeat the search.
        var texts = collectTextLayers(doc, []);
        var tl = null;
        for (var ti = 0; ti < texts.length; ti++) {
            if (texts[ti].contents && texts[ti].contents.indexOf("Cathedral (D") >= 0) { tl = texts[ti].layer; break; }
        }
        if (!tl) {
            testLog("[linecount-live] info | " + texts.length + " text layer(s) in fixture; contents seen:");
            for (var td = 0; td < texts.length; td++) testLog("    [" + td + "] \"" + texts[td].contents + "\"");
        }
        assert("found St Elizabeth's caption text layer", (tl !== null), true);

        if (tl) {
            var orig = tl.textItem.contents;
            testLog("[linecount-live] info | original contents: \"" + orig + "\" (" + _countCaptionLines(orig) + " line)");

            // 1) Original single-line caption must NOT be flagged multi-line.
            assert("original (1 line) -> _isMultiLineText false", _isMultiLineText(tl), false);

            // 2) Split the translation onto a second line, exactly as the artist does.
            var two = orig.replace(/ \(/, "\r(");
            tl.textItem.contents = two;
            assert("edit produced a 2-line caption", _countCaptionLines(tl.textItem.contents), 2);

            // 3) THE BUG vs THE FIX on identical real geometry:
            //    old centre-band probe misses it; new content-based detector catches it.
            assert("OLD centre-band probe MISSES the 2-line caption (the bug)", _oldCentreBandProbe(doc, tl), false);
            assert("NEW content detector CATCHES the 2-line caption (the fix)", _isMultiLineText(tl), true);

            // 4) The override therefore fires -> createWhiteFromText returns a STRAIGHT spine
            //    (the _straightSpine override is a 2-point, flat polyline).
            try {
                var res = createWhiteFromText(doc, tl);
                assert("createWhiteFromText spine is 2-point (straight)", (res && res.spine ? res.spine.length : -1), 2);
                if (res && res.spine && res.spine.length === 2) {
                    assert("straight spine endpoints share a y (flat)", Math.abs(res.spine[0].y - res.spine[1].y) < 0.5, true);
                }
            } catch (eW) {
                testLog("[linecount-live] FAIL | createWhiteFromText threw: " + eW.message + " (line " + (eW.line || "?") + ")");
                _failed++;
            }
        }
    }
} catch (e) {
    testLog("[linecount-live] FAIL | uncaught: " + e.message + " (line " + (e.line || "?") + ")");
    _failed++;
} finally {
    if (doc) { try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (eX) {} }
}

testLog("[linecount-live] === " + _passed + " passed, " + _failed + " failed ===");
