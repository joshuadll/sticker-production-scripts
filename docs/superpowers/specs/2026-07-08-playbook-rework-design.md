# Production File Preparation Playbook — Rework Design

**Date:** 2026-07-08
**Status:** Approved (structure), in progress
**Target:** Notion page "📖 Revise the Production File Preparation Playbook" (id `3720fc5867398123ab3eced9719feac6`)

## Goal

Rewrite the artist-facing playbook so a new artist can read, understand, and — most
importantly — *follow* it. The current version is accurate but poorly organised: it
groups work into "Run 1–4" that don't match the "Noteworthie 1–6" menu names, buries
crucial layer-naming rules, documents things that don't exist, and separates
verification/troubleshooting from the steps they belong to.

Treat the **current code on `main` as the authoritative "final version 1"** of the
software. A factual audit (2026-07-08) confirmed the playbook is accurate almost
everywhere; only the GC caption-plate details are stale (see Content Corrections).

## Decisions (from the user)

1. **Structure:** phase-grouped (Phases A–E), not linear-numbered and not "Run 1–4".
2. **Menu numbering:** renumber the File → Scripts menu items so menu order = the real
   click order. This is a code change to `installer/install.command` + a "reinstall
   once" note in the playbook.
3. **Images:** capture real screenshots from Photoshop / Illustrator / macOS (done in a
   focused pass after the content is drafted, since the content defines which screens
   are needed).

## The renumber (installer/install.command)

Only two labels swap; everything else already matches workflow order:

| New # | Menu item | Script | Change |
|---|---|---|---|
| 1 | Build Elements (Photoshop) | PS_BuildElements.jsx | same |
| 2 | Build & Export Cutlines | AI_BuildAndExportCutlines.jsx | same |
| 3 | Import Nesting | AI_ImportNesting.jsx | same |
| 4 | Normalise Captions | AI_NormaliseCaptions.jsx | **was 6** |
| 5 | Layout QA | AI_LayoutQA.jsx | same |
| 6 | Export Final | AI_ExportFinal.jsx | **was 4** |

Artists must reinstall once (run `install.command` again) for the new menu order to
appear — the login auto-updater refreshes pipeline code but never the menu entries.

## New structure (phase-grouped)

**Top — At a glance:** what you produce, ~90 min, required software, a workflow-map
diagram (6 steps + 3 manual stops + Deepnest).

**Phase A · Set Up Once (per machine)**
- A1 Install the scripts — short numbered clicks; screenshot of macOS "Open Anyway".
- A2 Restart Photoshop & Illustrator — screenshot of File → Scripts menu (Noteworthie 1–6).

**Phase B · Prepare Your Artwork (per SKU)**
- B1 Source folder (name it with the STK code; optional `Caption_Plate.psd` for GC-LM).
- B2 **Name your layers** ⭐ — dedicated section. Comprehensive table with **Style** and
  **Category** as the lead columns; size-hint rule; "ungrouped / unique" rules + the
  fix-it table. Screenshot of a correctly-named PS Layers panel.

**Phase C · Build the Cut Lines (Photoshop → Illustrator)**
- Step 1 Build Elements → ✋ review captions (in Illustrator) → inline verify + troubleshooting.
- Step 2 Build & Export Cutlines → inline verify + troubleshooting.

**Phase D · Nest the Layout**
- Deepnest (own step; settings table) → ✋ manual stop.
- Step 3 Import Nesting → inline verify.
- Step 4 Normalise Captions (+ optional Step 5 Layout QA) — magenta spacing-band
  explainer + screenshot → ✋ pencil redraw.

**Phase E · Finish**
- Step 6 Export Final → inline verify + deliverables → ✅ Done.

**End — Key Reference Values** table (kept; genuinely useful).

## Content corrections (from the audit)

1. **GC `Caption_Plate.psd`** — remove the stale "L / C / R three-child-layer group"
   instruction. Current code (`Step1_CombineElements.jsx:175–204`) imports only the
   **top layer** as the plate artwork. Instruction becomes: "a `Caption_Plate.psd`
   whose top layer is the plate artwork."
2. **GC caption plate height** — was "0.5 cm (1-line) / 0.8 cm (2-line)". Current code
   (`AI_BuildAndExportCutlines.jsx:43`) uses a fixed **4 mm** raster. Update the
   reference value; GC is the least-tested path, so keep GC notes tight.
3. Everything else verified accurate — keep as-is (size table, canvas/doc specs,
   stroke/font/NQI values, deliverables, Deepnest sheet size, menu mappings).

## Addressing the 9 feedback points

| # | Feedback | Fix |
|---|---|---|
| 1 | Install step 2 too long | Break into short one-action clicks; screenshot the confusing part |
| 2 | Documents things that don't exist ("no GitHub page", "no Actions panel") | Delete all "there is no X" phrasing; state only what to do |
| 3 | Layer table should lead with Style/Category, list all codes | Rebuild table: Style & Category as lead columns, every code listed |
| 4 | Layer naming is crucial → own step | Promoted to dedicated section B2 |
| 5 | How is it organised? pipelines separated, Deepnest between | Phase-grouped; each script is its own step; Deepnest is its own step in Phase D |
| 6 | Verification on the steps | Inline "✔ Check" box per step; drop the standalone Section 5 |
| 7 | Artists don't read logs | Delete "Reading the Log" section; keep one line ("errors show in a popup") |
| 8 | Common Issues must be artist-language, no "Step 8C" | Move troubleshooting inline per step; phrase by pipeline/what-they-see |
| 9 | Appendix needed? | Remove the `install.command` source dump; keep only the download link |

## Deliverables

1. `installer/install.command` edited (swap 4↔6) + committed.
2. Notion page rewritten in the new structure with corrections.
3. Real screenshots embedded (focused capture pass; requires PS/AI + a sample SKU open).
4. Update memory `notion_references.md` to reflect the new numbering + rework.

## Out of scope

- No changes to pipeline logic or step behaviour.
- No changes to the canonical manual playbook (`2c60…`, never edit).
- Renaming pipeline `.jsx` files (menu names map to files; only the menu labels change).
