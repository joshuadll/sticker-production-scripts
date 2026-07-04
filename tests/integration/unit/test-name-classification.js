// Pure-string unit test for Step 1's element-name classification.
// runCombine's first pass makes a three-way decision on every top-level source layer:
//   IMPORT      — isImportableName() → valid style + known size → combine it
//   NOTIMPORTED — not importable AND not benign → warn the artist to fix + re-run
//   ignored     — a benign layer (Background / CONFIG.ignoreTopLevelLayers), silent
// "Warn on all": ANY un-importable top-level layer that isn't benign warns — so an
// untagged element (no bracket, no style code) can't drop silently. A name can also
// MATCH the regex yet be un-importable — "[WC-ZZ]" (unknown category), "[WC]"
// (non-stamp, no category), "[XX-LM]" (unknown style) — those warn too.
// This isolates the decision (no Adobe DOM) by extracting the real predicates from
// source, so it can't drift.
var fs = require('fs');

var psUtils = fs.readFileSync(__dirname + '/../../../utils/psUtils.jsx', 'utf8');
var step1   = fs.readFileSync(__dirname + '/../../../photoshop/Step1_CombineElements.jsx', 'utf8');

// NAME_REGEX + VALID_STYLES are `var ... = …;` lines, not functions.
function extractVar(src, decl) {
    var m = src.match(new RegExp(decl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?;'));
    if (!m) throw new Error('could not extract ' + decl);
    return m[0];
}
eval(extractVar(psUtils, 'var NAME_REGEX'));
eval(extractVar(step1,  'var VALID_STYLES'));

function extractFn(src, name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re);
    if (!m) throw new Error('could not extract ' + name);
    return m[0];
}
eval(extractFn(psUtils, 'parseLayerName'));
eval(extractFn(psUtils, 'getTargetPx'));
eval(extractFn(step1,   'isImportableName'));
eval(extractFn(step1,   'isBenignLayer'));

// getTargetPx reads CONFIG.sizeTable*; isBenignLayer reads CONFIG.ignoreTopLevelLayers.
// Supply real sizing values (mirrors PS_BuildElements CONFIG) + a sample ignore entry.
var CONFIG = {
    sizeTable:      { TL: 900, LM: 615, MP: 570, TR: 570, IC: 495, FD: 525, ST: 450 },
    sizeTableLarge: { LM: 690, MP: 600, TR: 600, IC: 540, FD: 600 },
    sizeTableSmall: { LM: 540, MP: 540, TR: 540, IC: 450, FD: 450 },
    ignoreTopLevelLayers: [ "Colour Reference" ]
};

// Mirror the first-pass decision in runCombine.
function classify(name) {
    if (isImportableName(name)) return 'import';
    if (!isBenignLayer(name)) return 'notImported';
    return 'ignored';
}

var fails = 0;
function check(name, expected) {
    var got = classify(name);
    if (got !== expected) {
        console.log('FAIL: ' + JSON.stringify(name) + ' → expected ' + expected + ', got ' + got);
        fails++;
    }
}

// ── Valid names import (happy path) ───────────────────────────────────────────
check('Bojnice Castle [WC-LM]', 'import');            // style + category
check('National Flower [ST]', 'import');              // stamp, no category
check('Big Stamp [ST+]', 'import');                   // stamp + size hint (category ignored)
check('Plate Thing [GC-LM]', 'import');               // GC style
check('Spiš Castle [WC-LM+]', 'import');              // large-size hint
check('Devín Castle [WC-LM-]', 'import');             // small-size hint
check("St. Martin's Cathedral [WC-LM]", 'import');    // punctuation in name
check('Old Town Hall (Bratislava) [WC-LM-]', 'import'); // parens in name
check('The Blue Church | Church of St. Elizabeth [WC-LM]', 'import'); // pipe in name
check(' Leading Space [WC-LM]', 'import');            // leading space before NAME is fine

// ── Valid FORMAT but unusable CODE → warn (bucket E, now gated at import) ──────
check('Mystery Thing [WC-ZZ]', 'notImported');        // unknown category
check('Mystery Thing [WC]', 'notImported');           // non-stamp with no category
check('Mystery Thing [XX-LM]', 'notImported');        // unknown style code

// ── The two real culprits from the Slovakia SKU ───────────────────────────────
check('Flag + Slovakia(text) [WC-IC] ', 'notImported'); // trailing space after ]
check('Kapustnica WC-FD]', 'notImported');              // missing opening [

// ── Malformed names → warn ────────────────────────────────────────────────────
check('Michael’s Gate [wc-lm]', 'notImported');    // lowercase tag
check('Some Landmark [WC-LM', 'notImported');           // missing closing ]
check('Some Landmark (WC-LM)', 'notImported');          // wrong bracket type
check('Kapustnica WC-FD', 'notImported');               // no brackets, style token present

// ── Untagged elements → warn (the "warn on all" policy; no tag intent needed) ──
check('Slovak Flag', 'notImported');                    // no bracket, no style code
check('flag final', 'notImported');
check('Layer 1', 'notImported');                        // stray/unnamed layer still surfaces

// ── Benign layers → silent, no warning ────────────────────────────────────────
check('Background', 'ignored');
check('background', 'ignored');
check('  Background  ', 'ignored');
check('Colour Reference', 'ignored');                   // via CONFIG.ignoreTopLevelLayers
check('  colour reference ', 'ignored');                // trim + case-insensitive

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
