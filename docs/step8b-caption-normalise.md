# Step 8b — Caption Normalisation

## What it does

During the Deepnest layout the artist resizes whole stickers to fill space, which
also scales the caption pill off its fixed spec. This step pulls each **Gouache**
caption plate back to its canonical absolute height and re-derives the fused
cutline around it — the automated half of playbook §6's *caption check*
(*"the plate height in the Gouache set is 0,5 cm… adjust the cut lines to match
the new caption size"*).

It exploits the separable-caption architecture
(`docs/caption-separability-architecture.md`): the cutline is a **derived**
`Unite(outline, plate)`, so normalisation is *reset the plate → re-Unite*, never
anchor-splice surgery. This **must** run before the manual pencil pass — once the
artist pencil-edits a cutline the invariant intentionally breaks.

Runs as the second phase of `pipelines/AI_AfterDeepnest.jsx`, after Step 8a.

## Scope — Gouache only

| Style | Treated? | Why |
|---|---|---|
| GC (Gouache) | ✅ reset plate to 0.5cm (1 line) / 0.8cm (2 line) | discrete pill plate; caption drift is a real geometric change, re-Unite is clean |
| WC (Watercolor) | ⏭ skipped | spec is text-size (8pt) on a white base; resetting it barely moves the cutline |
| ST (Stamp) / uncaptioned | ⏭ skipped | no plate |

## How it knows the spec — `group.note`

Step 8b has no sidecar (the artist re-opens the `.ai` manually after Deepnest),
so Step 6 stashes the caption spec on the group at creation time:

```
group.note = "{styleCode}|{capLines}"   // e.g. "GC|2"
```

(set in `Step6_CreateCutlines.jsx` `_buildSeparableCutline`). Groups built before
this change have no note → Step 8b skips them with a warning (Step 8a still
simplifies them).

## Per-group procedure

For each GC GroupItem in the **Cutlines** layer:

1. `rebuildPlateToHeight(plate, specHeightPt)` — rebuild the hidden `{name} plate`
   to the canonical height, anchored at its **top-centre** (the junction with the
   art) and preserving aspect so the pill radius stays proportional.
2. `reuniteCutline(group, outline, plate, cutlineStrokePt)` — re-derive
   `cutline = Unite(outline, plate)`, restroke 0.25pt black, swap the visible
   cutline member. `outline`/`plate` stay hidden and separable.

## Confirmed / tunable values

| CONFIG (in `AI_AfterDeepnest.jsx`) | Default |
|---|---|
| `plateHeightSingleLineCm` | 0.5 |
| `plateHeightTwoLineCm` | 0.8 |
| `cutlineStrokePt` | 0.25 |

## Playbook mapping

Playbook step 6 (Refinements) — the *caption check / adjust cut lines* action,
before the manual Pencil.

## Files

- Step function: `illustrator/Step8b_CaptionNormalise.jsx` (`runCaptionNormalise`)
- Pipeline: `pipelines/AI_AfterDeepnest.jsx`
- Utilities: `utils/aiUtils.jsx` (`rebuildPlateToHeight`, `reuniteCutline`,
  `buildPlate`, `deriveCutline`, `findGroupMember`, `mmToPoints`, `findLayer`)
- Sets up the metadata: `illustrator/Step6_CreateCutlines.jsx` (`group.note`)

## Testing

See `tests/integration/run-step8.sh` (covers 8a + 8b). After a run, verify:

1. GC plates measure 0.5cm (one-line) / 0.8cm (two-line) tall.
2. The re-United cutline still encloses art + plate cleanly at the junction.
3. WC / stamp / note-less groups are logged as skipped (not normalised).
4. `normalized` count in the log matches the number of GC caption groups.
