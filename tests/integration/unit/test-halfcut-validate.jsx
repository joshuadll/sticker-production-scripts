// Unit test for the PURE half-cut end-reach check (utils/aiUtils.jsx).
// No document needed — exercises _halfcutEndsReachCut with plain arrays.
// Writes [halfcut-validate] PASS|/FAIL| lines to the log the runner polls.
#include "../../../utils/aiUtils.jsx"

var LOG = new File(Folder("~/Desktop").fsName + "/test-halfcut-validate.log");
function out(s) { LOG.open("a"); LOG.writeln(s); LOG.close(); }
function check(name, got, want) {
    out("[halfcut-validate] " + (got === want ? "PASS" : "FAIL") + " | " + name
        + " got=" + got + " want=" + want);
}

LOG.open("w"); LOG.writeln("=== test-halfcut-validate ==="); LOG.close();

// A 40x40 pt square cut contour centred at origin (0,0)..(40,40).
var sq = [ {x:0,y:0}, {x:40,y:0}, {x:40,y:40}, {x:0,y:40} ];
var mm1 = mmToPoints(1);   // ~2.83pt

// Both ends outside the contour → ok.
check("both-outside",
    _halfcutEndsReachCut([{x:-5,y:20},{x:45,y:20}], sq, mm1).reason, null);
// One end deep inside (20pt from every edge >> 1mm) → undershoot.
check("one-deep-inside",
    _halfcutEndsReachCut([{x:-5,y:20},{x:20,y:20}], sq, mm1).reason, "undershoot");
// One end just inside by < 1mm (0.5pt from the right edge) → ok (slop).
check("inside-under-1mm",
    _halfcutEndsReachCut([{x:-5,y:20},{x:39.5,y:20}], sq, mm1).reason, null);
// One end inside by > 1mm (10pt from nearest edge) → undershoot.
check("inside-over-1mm",
    _halfcutEndsReachCut([{x:-5,y:20},{x:30,y:20}], sq, mm1).reason, "undershoot");
// Fewer than 2 endpoints → undershoot (cannot connect two ends).
check("too-few-points",
    _halfcutEndsReachCut([{x:-5,y:20}], sq, mm1).reason, "undershoot");

// collectSeatReviewNames: parseNote must treat "WC|1|a10|R" as review, "WC|1|a10" as not.
check("note-R-is-review",   parseNote("WC|1|a10|R").needsReview, true);
check("note-noR-not-review", parseNote("WC|1|a10").needsReview,   false);
