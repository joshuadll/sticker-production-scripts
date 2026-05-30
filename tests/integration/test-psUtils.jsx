// test-psUtils.jsx — Unit tests for psUtils.jsx pure functions.
// Run directly in Photoshop (File > Scripts > Browse). No open document required.
// Results are written to Desktop/test-psUtils.log and shown in a final alert.
//
// Tests: parseLayerName, getTargetPx, needsCaption, longestEdge, scalePercent

#target photoshop

// Minimal CONFIG — only what psUtils.jsx functions need during tests.
var CONFIG = {
    suppressAlerts: true,
    logPath:        Folder.desktop.fsName + "/test-psUtils.log",
    sizeTable: {
        "TL": 900,
        "LM": 690,
        "MP": 570,
        "TR": 570,
        "IC": 540,
        "FD": 525,
        "ST": 450
    }
};

#include "../../utils/psUtils.jsx"

// ─── TEST HARNESS ─────────────────────────────────────────────────────────────

var _passed = 0;
var _failed = 0;
var _logPath = Folder.desktop.fsName + "/test-psUtils.log";

// Clear log from any previous run.
var _clearFile = new File(_logPath);
_clearFile.open("w");
_clearFile.close();

function testLog(msg) {
    $.writeln(msg);
    var f = new File(_logPath);
    f.open("a");
    f.writeln(msg);
    f.close();
}

function assert(description, actual, expected) {
    var a = String(actual);
    var e = String(expected);
    if (a === e) {
        testLog("[psUtils-test] PASS | " + description);
        _passed++;
    } else {
        testLog("[psUtils-test] FAIL | " + description);
        testLog("  expected: " + e);
        testLog("  actual:   " + a);
        _failed++;
    }
}

// ─── parseLayerName ───────────────────────────────────────────────────────────

testLog("[psUtils-test] --- parseLayerName ---");

var r = parseLayerName("Horseshoe Bend [WC-LM]");
assert("WC-LM: displayName",   r && r.displayName, "Horseshoe Bend");
assert("WC-LM: styleCode",     r && r.styleCode,   "WC");
assert("WC-LM: catCode",       r && r.catCode,     "LM");

r = parseLayerName("Key Lime Pie [WC-FD]");
assert("WC-FD: displayName",   r && r.displayName, "Key Lime Pie");
assert("WC-FD: catCode",       r && r.catCode,     "FD");

r = parseLayerName("NEMO Museum [GC-LM]");
assert("GC-LM: styleCode",     r && r.styleCode,   "GC");

r = parseLayerName("Arizona [WC-TL]");
assert("WC-TL: catCode",       r && r.catCode,     "TL");

r = parseLayerName("Orlando Stamp [ST]");
assert("ST: displayName",      r && r.displayName, "Orlando Stamp");
assert("ST: styleCode",        r && r.styleCode,   "ST");
assert("ST: catCode is null",  r && String(r.catCode), "null");

assert("no code: returns null",      String(parseLayerName("Background")),  "null");
assert("Guide layer: returns null",  String(parseLayerName("Guide")),       "null");
assert("empty string: returns null", String(parseLayerName("")),            "null");
assert("spaces only: returns null",  String(parseLayerName("   ")),         "null");

// Multi-word display name with brackets in the right place
r = parseLayerName("Golden Gate Bridge [WC-LM]");
assert("multi-word name: displayName", r && r.displayName, "Golden Gate Bridge");

// ─── getTargetPx ──────────────────────────────────────────────────────────────

testLog("[psUtils-test] --- getTargetPx ---");

assert("TL = 900", getTargetPx(parseLayerName("Arizona [WC-TL]")),             900);
assert("LM = 690", getTargetPx(parseLayerName("Horseshoe Bend [WC-LM]")),      690);
assert("MP = 570", getTargetPx(parseLayerName("Arizona Map [WC-MP]")),         570);
assert("TR = 570", getTargetPx(parseLayerName("Cable Car [WC-TR]")),           570);
assert("IC = 540", getTargetPx(parseLayerName("Liberty Bell [WC-IC]")),        540);
assert("FD = 525", getTargetPx(parseLayerName("Key Lime Pie [WC-FD]")),        525);
assert("ST = 450", getTargetPx(parseLayerName("Orlando Stamp [ST]")),          450);

assert("GC-LM = 690", getTargetPx(parseLayerName("NEMO Museum [GC-LM]")),     690);

assert("unrecognised catCode: null",
    String(getTargetPx(parseLayerName("Something [WC-XX]"))),  "null");
assert("null input: null",
    String(getTargetPx(null)),                                  "null");

// ─── needsCaption ─────────────────────────────────────────────────────────────

testLog("[psUtils-test] --- needsCaption ---");

assert("WC = true",   needsCaption(parseLayerName("Horseshoe Bend [WC-LM]")), true);
assert("GC = true",   needsCaption(parseLayerName("NEMO Museum [GC-LM]")),   true);
assert("ST = false",  needsCaption(parseLayerName("Orlando Stamp [ST]")),    false);
assert("null = false", needsCaption(null),                                   false);

// ─── longestEdge ──────────────────────────────────────────────────────────────

testLog("[psUtils-test] --- longestEdge ---");

assert("landscape: width wins",  longestEdge([0, 0, 800, 600]), 800);
assert("portrait: height wins",  longestEdge([0, 0, 300, 900]), 900);
assert("square: equal",          longestEdge([0, 0, 500, 500]), 500);
assert("offset origin",          longestEdge([100, 50, 900, 650]), 800);
assert("zero bounds",            longestEdge([0, 0, 0, 0]), 0);

// ─── scalePercent ─────────────────────────────────────────────────────────────

testLog("[psUtils-test] --- scalePercent ---");

assert("scale up 500->900",   scalePercent(500, 900),  180);
assert("scale down 1000->500", scalePercent(1000, 500), 50);
assert("no change 690->690",  scalePercent(690, 690),  100);
assert("LM exact: 500->690",  scalePercent(500, 690),  138);

// ─── Summary ──────────────────────────────────────────────────────────────────

var summary = "psUtils tests: " + _passed + " passed, " + _failed + " failed.";
testLog("[psUtils-test] " + summary);

if (_failed > 0) {
    alert(summary + "\n\nSee log for details:\n" + _logPath);
} else {
    alert(summary + "\n\nLog: " + _logPath);
}
