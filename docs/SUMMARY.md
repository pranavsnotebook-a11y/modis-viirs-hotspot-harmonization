# One Fire Record: project summary

**Problem.** MODIS (1 km, 2000 onward) and VIIRS (375 m, 2012 onward) report fires differently. Raw counts jump when VIIRS arrives, so "fires doubled" can be a sensor artefact. People who rely on the record (health officers, responders, journalists) cannot easily tell real change from sensor change.

**Main result: MODIS's overpass times have moved, and its counts moved with them.** Measured from the FIRMS archives, Aqua's daytime detections held at about 13.5 h local time and Terra's at 10.6 h until about 2021, then moved to 14.7 h and 9.6 h by 2025. Aqua/Terra, two identical instruments, went from about 2.4 to 3.89 by day and from about 0.47 to 0.34 at night.

We then ran a preregistered control against VIIRS S-NPP, whose orbit held. For 2025 against 2013-2020, with the same countries and months, Terra/S-NPP is x0.61 by day (model x0.69) and x1.33 at night (model x1.51). The model is a daily cycle fitted on one week of 2026 without Terra, not refitted. Terra ageing would lower both ratios and real fire change would leave them about flat, so neither fits as the main cause. By country, the day ratio fell in 53 of 54 and the night ratio rose in 52 of 54 (exploratory). MODIS shows 2025 at -18% against its 2013-2020 mean and S-NPP at -10%.

**Limits of that result.** The MODIS data version changes in 2023, as the drift speeds up, and that year's step cannot be separated from it. Within the one version, 2023-2025, the day ratio still falls x0.73 (model x0.79). The test was not fully blind, because the Aqua/Terra table had been seen. The model overstates the night rise and misses Aqua's night ratio. Countries range from x0.31 to x0.89, so one global cycle is too simple. It measures the effect but does not yet correct it. Details: `docs/research/viirs_control_results.md`.

**It affects our own product.** The share of MODIS pixels matched fell from 44.3% in 2021 to 31.9% in 2025, and Harmonized / S-NPP rose from 92.0% to 100.6%. A 300 minute window barely changes that rise, and Aqua's matches fall too, cause not established. Harmonized counts after about 2021 are not comparable with earlier years, and the site says so.

**Earlier results.**
- *Detection floor (one week, 26 Oct-1 Nov 2026).* Summing FRP per 0.05 deg cell before flooring, NOAA-20/Aqua falls from 5.45x to 2.31x at 20 MW and 2.02x at 100 MW, then levels off. A per-pixel floor is not a valid test (an earlier 1.08x at 20 MW was withdrawn).
- *Overpass (same week).* Cells of at least 20 MW: Aqua/Terra 4.89 by day and 0.23 at night, flipping in all six regions. Control NOAA-20/NOAA-21 0.84-0.86, so about 15% is this method's own noise.
- *Predicting a satellite the model never saw (same week, criteria committed first).* A shared fire activity per cell-day, one operator per instrument and one daily cycle, trained on Aqua, NOAA-20 and NOAA-21, beat every baseline on Terra (deviance day 0.74 vs 1.06, night 0.90 vs 1.12), with totals at 1.41x and 1.16x of actual. Not blind, one week, a simple GLM rather than a new architecture, and tree models win some control hold-outs.
- *FRP.* A robust fit on 25 near-coincident pairs does not beat leaving MODIS FRP unchanged, so we do not claim a validated FRP correction.

**Built.** The pipeline (`src/hotspots`) and a static website (`web/index.html`) with six pages: Overview, Map Explorer with 2D maps and a 3D globe, Harmonization Lab, Activity Calendar, Historical Analysis and Data Explorer. It holds 1.2 million individual records for 26 Oct-2 Nov 2026 and 1 degree monthly totals from MODIS (Nov 2000 to Dec 2025) and S-NPP (Jan 2012 to Dec 2025). 16 tests.

**Not yet.** A drift correction, validation against fire perimeters or burned area, a confirmation of the leave-one-satellite-out test on a separate week (a fully separate 7-day file is available from about 10 Nov 2026), and a validated FRP harmonization.

**Proposals, not built** (`docs/ideas/`): Fire Claim Checker, Invisible Burn Ledger and Satellite Look Ledger.
