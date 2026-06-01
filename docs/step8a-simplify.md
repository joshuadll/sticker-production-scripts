# Step 8a — Simplify Cutlines

## What it does

Reduces the jagged anchor count of the Image-Trace cutlines created in Step 6,
so the cut path is clean before the manual pencil refinement. This is the
automated half of playbook §6's *"Select a cut line… Right click and choose
Simplify. Set the preferred number."*

Illustrator's **Object > Path > Simplify** cannot be driven from a script without
its dialog, so Step 8a reproduces it natively (see *Algorithm*).

Runs as the first phase of `pipelines/AI_AfterDeepnest.jsx`, immediately before
Step 8b (Caption Normalisation) and the manual pencil pass.

## Input / output

Operates in place on the open production `.ai`'s **Cutlines** layer (the Step 6
output). For each top-level item:

| Item | Action |
|---|---|
| GroupItem (separable bundle) | simplify the hidden `{name} outline`, then re-Unite `cutline = Unite(simplified outline, plate)` and restroke. The parametric `plate` stays mathematically exact — only the traced art is simplified. |
| bare PathItem / CompoundPathItem (non-caption cutline) | simplify in place |
| PlacedItem (stamp template) / other | skip |

## Algorithm (native, `aiUtils.jsx`)

`simplifyPathItem(path, tolerancePt, cornerAngleDeg)`:

1. Read `pathPoints[].anchor` into a polyline. Closed paths (all cutlines) are
   split at the anchor farthest from anchor 0, RDP'd as two arcs, recombined
   (`_rdpClosed`).
2. **RDP** (`rdpSimplify`) with `epsilon = mmToPoints(CONFIG.simplifyToleranceMm)`
   selects the keeper anchors — this controls how much detail is dropped.
3. **Corner preservation**: a keeper whose turn angle (`_turnAngle`) exceeds
   `CONFIG.simplifyCornerAngleDeg` becomes a hard corner (sharp, no handles);
   every other keeper gets **Catmull-Rom** bezier handles for a smooth curve.
4. The path is rewritten with `setEntirePath` + per-point directions
   (`_applySmoothPath`); `closed` is restored afterwards.

Deterministic and unit-testable. CompoundPathItems recurse into each sub-path.
Bails (no change) if reduction would collapse the path below 3 anchors.

## Confirmed / tunable values

| CONFIG (in `AI_AfterDeepnest.jsx`) | Default | Notes |
|---|---|---|
| `simplifyToleranceMm` | 0.2 | RDP epsilon — higher drops more anchors. ⚠️ Tune on a real trace with the artist. |
| `simplifyCornerAngleDeg` | 60 | Turns sharper than this stay corners. |
| `cutlineStrokePt` | 0.25 | Re-applied to re-United cutlines (black, no fill). |

## Playbook mapping

Playbook step 6 (Refinements) — the *Simplify* action, before the manual Pencil.

## Files

- Step function: `illustrator/Step8a_SimplifyCutlines.jsx` (`runSimplify`)
- Pipeline: `pipelines/AI_AfterDeepnest.jsx`
- Utilities: `utils/aiUtils.jsx` (`simplifyPathItem`, `rdpSimplify`,
  `findGroupMember`, `reuniteCutline`, `deriveCutline`, `strokeRecursive`,
  `mmToPoints`, `findLayer`)

## Testing

See `tests/integration/run-step8.sh` (covers 8a + 8b). After a run, verify:

1. Cutlines have markedly fewer anchor points but still follow the art.
2. Contours remain **closed**; stroke still 0.25pt black, no fill.
3. Re-United cutlines still enclose art + plate cleanly at the junction.
4. `simplified` count in the log matches the number of cutlines.
