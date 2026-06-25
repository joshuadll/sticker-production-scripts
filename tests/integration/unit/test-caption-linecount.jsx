// test-caption-linecount.jsx -- Unit tests for caption line-count detection in
// photoshop/Step3B_CaptionWhite.jsx (_countCaptionLines / _isMultiLineText).
//
// Run directly in Photoshop (File > Scripts > Browse) or via run-test-caption-linecount.sh.
// NO open document required -- _countCaptionLines is pure (string in, int out). The DOM
// accessor _textContents (textItem.contents) is the only PS-bound piece and is validated
// in-app, not here.
//
// Regression guard for the "straight two-line caption gets a CURVED pill" bug:
// captions are POINT text (Step3A), so the White pill's spine is fitted to per-column ink
// centres. A two-line caption whose second line is narrower makes the end columns see only
// line 1 -> the quad fit lifts the pill's ends into the art (a "false frown"). The straight-
// spine override is supposed to suppress that, but the OLD _isMultiLineText probed a thin
// +/-5%-height band at the bounding-box vertical centre for ink -- and a caption like
// "Name\r(translation)" defeats it when its two lines have unequal vertical extents (line 1
// without descenders, line 2 with parentheses / accents / descenders push the bbox centre
// off the inter-line gap onto line-2 ink -> reads "single line" -> override skipped).
// The fix reads the line count from the text content, the authoritative source: 2+ lines
// forces a straight spine; a genuine single line (incl. an ARCED food caption) keeps its curve.

#target photoshop

var CONFIG = {
    suppressAlerts: true,
    logPath:        Folder.desktop.fsName + "/test-caption-linecount.log"
};

#include "../../../utils/psUtils.jsx"
#include "../../../photoshop/Step3B_CaptionWhite.jsx"

// --- TEST HARNESS -------------------------------------------------------------

var _passed = 0;
var _failed = 0;
var _logPath = CONFIG.logPath;

var _clearFile = new File(_logPath);
_clearFile.open("w");
_clearFile.close();

function testLog(msg) {
    $.writeln(msg);
    var f = new File(_logPath);
    f.encoding = "UTF-8";   // write all chars; default encoding silently drops some
    f.lineFeed = "Unix";    // \n terminators so the runner's line-based grep counts right
    f.open("a");
    f.writeln(msg);
    f.close();
}

function assert(description, actual, expected) {
    var a = String(actual), e = String(expected);
    if (a === e) {
        testLog("[linecount-test] PASS | " + description);
        _passed++;
    } else {
        testLog("[linecount-test] FAIL | " + description);
        testLog("  expected: " + e);
        testLog("  actual:   " + a);
        _failed++;
    }
}

// A top-level try/catch turns an uncaught error (e.g. the function not existing yet, the
// expected RED state) into a logged FAIL so the runner reports it instead of going silent.
try {
    testLog("[linecount-test] --- _countCaptionLines (pure) ---");
    assert("empty string -> 0",          _countCaptionLines(""), 0);
    assert("null -> 0",                  _countCaptionLines(null), 0);
    assert("single line -> 1",           _countCaptionLines("Slovak Paradise National Park"), 1);

    // The bug case. Accents in the real caption ("Dom Svatej Alzbety" carries o-acute /
    // a-umlaut) are irrelevant to line counting, so ASCII stand-ins keep this runner
    // independent of how the engine decodes the .jsx file.
    assert("two lines (CR)   -> 2",      _countCaptionLines("St Elizabeth's Cathedral\r(Dom Svatej Alzbety)"), 2);
    assert("two lines (LF)   -> 2",      _countCaptionLines("Line A\nLine B"), 2);
    assert("two lines (CRLF) -> 2",      _countCaptionLines("Line A\r\nLine B"), 2);
    assert("three lines -> 3",           _countCaptionLines("A\rB\rC"), 3);
    assert("trailing break -> 1",        _countCaptionLines("Solo line\r"), 1);
    assert("collapsed blank lines -> 2", _countCaptionLines("A\r\r\rB"), 2);
    assert("all whitespace -> 0",        _countCaptionLines("   \r  \r "), 0);

    testLog("[linecount-test] --- override decision (>= 2 lines => force a straight spine) ---");
    // These two encode the exact bug and its regression guard, at the decision boundary
    // _isMultiLineText uses (_countCaptionLines(contents) >= 2).
    assert("St Elizabeth's two-liner IS multi-line (gets straightened)",
        (_countCaptionLines("St Elizabeth's Cathedral\r(Dom Svatej Alzbety)") >= 2), true);
    assert("arced single-line food caption is NOT multi-line (keeps its curve)",
        (_countCaptionLines("Bryndzove halusky") >= 2), false);
} catch (e) {
    testLog("[linecount-test] FAIL | uncaught: " + e.message + " (line " + (e.line || "?") + ")");
    _failed++;
}

testLog("[linecount-test] === " + _passed + " passed, " + _failed + " failed ===");

if (!CONFIG.suppressAlerts) {
    alert(_passed + " passed, " + _failed + " failed.\nLog: " + _logPath);
}
