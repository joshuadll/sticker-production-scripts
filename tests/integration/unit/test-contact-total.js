// Pure-geometry unit test for _contactRunsTotal in aiUtils.jsx: total welded edge length between
// a sampled plate polygon and the art, summing every plate edge whose BOTH endpoints lie inside
// the art. This is the fix for the old tip-to-tip farthest-pair span criterion, which scored two
// hairline welds the same as two solid ones — see spec amendment 2. The critical case here is
// #3 vs #4: two disjoint tiny hairline contacts, far apart (large tip-to-tip span), must score
// SMALL total contact, while two deep/solid contacts at the same far-apart locations must score
// large total contact.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name){var re=new RegExp('function '+name+'\\s*\\([\\s\\S]*?\\n}');var m=src.match(re);if(!m)throw new Error('could not extract '+name);return m[0];}
eval(extract('pointInPolygon'));
eval(extract('_pointInPolysEO'));
eval(extract('_segCrossArt'));   // partial-edge bisection
eval(extract('_contactRunsTotal'));

var fails=0;
function check(c,m){if(!c){console.log('FAIL: '+m);fails++;}}
function near(a,b){return Math.abs(a-b)<1e-3;}   // _segCrossArt bisects, so allow bisection slop

// Art = a 100x100 box.
var ART = [[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]];

// --- Case 1: tangent / no overlap ---------------------------------------------------------
// Plate square entirely below y=0 -> total 0.
var plateBelow = [{x:40,y:-10},{x:60,y:-10},{x:60,y:-1},{x:40,y:-1}];
var totalBelow = _contactRunsTotal(plateBelow, ART);
check(near(totalBelow, 0), 'tangent/no-overlap plate -> total 0 (got ' + totalBelow + ')');

// --- Case 2: single solid contact -----------------------------------------------------------
// Plate square straddling y=0, kept strictly inside the art in x (5..25) so no vertex lands on
// the art boundary. Submerged boundary = left leg (10) + top edge (20) + right leg (10) = 40.
// NB the legs count: a partially-submerged edge contributes its submerged PORTION, not 0 — that
// is the fix for the sample-spacing quantization that read short welds as exactly zero.
var plateStraddle = [{x:5,y:-10},{x:25,y:-10},{x:25,y:10},{x:5,y:10}];
var totalStraddle = _contactRunsTotal(plateStraddle, ART);
check(near(totalStraddle, 40), 'single solid straddling contact -> total == 40 (got ' + totalStraddle + ')');

// --- Case 3: TWO DISJOINT HAIRLINES (the regression this fixes) -----------------------------
// Two tiny lobes, each poking ~0.1 above y=0 with a flat 0.2-wide tip, far apart in x (10 and 90).
// Tip-to-tip distance between the lobes is ~80 (large), but the actual welded contact is tiny.
var plateHairlines = [
    {x: 5,   y: -5},
    {x: 9.9, y: 0.1},   // lobe 1 tip-left  (inside)
    {x: 10.1,y: 0.1},   // lobe 1 tip-right (inside)
    {x: 15,  y: -5},
    {x: 85,  y: -5},
    {x: 89.9,y: 0.1},   // lobe 2 tip-left  (inside)
    {x: 90.1,y: 0.1},   // lobe 2 tip-right (inside)
    {x: 95,  y: -5}
];
var hairlineTotal = _contactRunsTotal(plateHairlines, ART);
check(hairlineTotal < 2, 'two disjoint hairline welds -> total < 2 (got ' + hairlineTotal + ')');
// Sanity: the tip-to-tip span between the two lobes (~80pt) would score the OLD farthest-pair
// criterion as a wide junction, even though the actual weld is tiny — that's the bug this fixes.
check(hairlineTotal > 0, 'hairline welds still register SOME contact, not zero (got ' + hairlineTotal + ')');

// --- Case 4: two solid welds -----------------------------------------------------------------
// Same two-lobe layout, but each lobe dips DEEP (flat tip at y=10). Kept strictly inside the art
// in x (5..25 and 75..95) — a vertex sitting exactly on the art edge is classified OUTSIDE by
// pointInPolygon's strict test, which previously made this case silently measure only ONE lobe.
// Each lobe = 10 (down-leg submerged part) + 20 (flat tip) + 10 (up-leg) = 40; two lobes = 80.
var plateSolidLobes = [
    {x: 5,   y: -5},
    {x: 5,   y: 10},   // lobe 1 tip-left  (inside)
    {x: 25,  y: 10},   // lobe 1 tip-right (inside)
    {x: 25,  y: -5},
    {x: 75,  y: -5},
    {x: 75,  y: 10},   // lobe 2 tip-left  (inside)
    {x: 95,  y: 10},   // lobe 2 tip-right (inside)
    {x: 95,  y: -5}
];
var solidTotal = _contactRunsTotal(plateSolidLobes, ART);
check(near(solidTotal, 80),
    'two solid welds -> BOTH lobes counted, total == 80 (got ' + solidTotal + ')');

// The point of this whole test: hairline welds must score far smaller than solid welds, even
// though both configurations have the same far-apart tip-to-tip span (~80) that the OLD
// farthest-pair criterion scored as a wide junction.
check(hairlineTotal < solidTotal / 20,
    'hairline total must be << solid total (hairline=' + hairlineTotal + ', solid=' + solidTotal + ')');

// --- Case 5: fully inside ---------------------------------------------------------------------
// Plate entirely within the art -> total equals the plate perimeter (large).
var plateInside = [{x:40,y:40},{x:60,y:40},{x:60,y:60},{x:40,y:60}];
var totalInside = _contactRunsTotal(plateInside, ART);
check(near(totalInside, 80), 'fully-inside plate -> total == perimeter (80), got ' + totalInside);

if(fails===0)console.log('PASS: contact-total'); else {console.log(fails+' FAIL');process.exit(1);}
