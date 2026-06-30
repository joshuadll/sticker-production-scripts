# Default Peel Tab — In-Illustrator Validation Checklist

Run Pipeline 1 then Pipeline 2 on a stamp-bearing SKU and confirm:

- [ ] Pipeline 1: each uncaptioned element gets a `[name] tab` group on the chosen longest
      straight edge, body pointing OUTWARD (away from the art), correct A/B asset by edge length.
- [ ] Concave outline: outward normal points away from the art body (not into a notch).
- [ ] Artist reposition: move/rotate a `[name] tab`; Pipeline 2 seats it at the NEW pose.
- [ ] Pipeline 2: tab cutline is seated into the art (real overlap), fused cut united,
      `[name] tab fill` rides along and bleeds slightly past the cut (printed, not cut).
- [ ] Half-cut endpoints meet the fused cut at both ends; straight for a flat edge, curved for a
      curved/tilted edge. Peel test: grabbing the tab separates cleanly.
- [ ] Steep/diagonal/vertical edge: seat does NOT shear or float (seatPlateToOutline was only
      validated on bottom-ish captions — record the result here and tune seat knobs if needed).
- [ ] `peelHereTabWidthMm` re-measured from `Peel_Teb_B.ai`; A/B threshold tuned with the artist.
- [ ] Final file (Step 11): tab groups ship as groups (NOT unwrapped to bare paths); no QA/halo
      layers leak into print.
