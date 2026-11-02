# Skeptical judge critique (Impact / Creativity / Validity / Relevance / Presentation)

Grounded in README.md, docs/PITCH.md, docs/SUMMARY.md, docs/research/challenge.md.

## Biggest problem: we answered the wrong question
The official challenge (challenge.md, verbatim) asks for a **web app that harmonizes MODIS+VIIRS into a burning activity CALENDAR** (early 2000s to present), with region + date selection, anomaly vs historical median, accessible color ramps, CSV download. It frames harmonization as a *time-series continuity* problem: "the sensor of origin no longer matters."
Our headline work (footprint matching, per-pixel merge, 24h snapshot stats) is a *pixel-pairing* problem. The PITCH.md still leads with "5,917 events seen by both sensors" and never mentions the calendar. The Explorer is the part that matches the brief, and it is relegated to the last README section, running on **8 days** of data, where the "historical median" is a median over those 8 days (README admits this). A judge who read the challenge sees: the central deliverable is a stub.

## What is generic (every serious team will do it)
- Load FIRMS CSVs, put dots on a Leaflet map, count by sensor, FRP histogram. Table stakes.
- Region presets + date filter + CSV download: literally listed in the brief.
- "Both / VIIRS-only / MODIS-only" Venn counts. Everyone's first notebook.
- "Combined revisit, one consistent product" as impact: vague, not a person's life improved.

## What is weak or unproven
- **Validity of the harmonization itself is the weakest thing we have.** Our own README: FRP fit uses n=25 pairs; slope 1.28 with CI 0.85-1.64; leave-one-out says **"no correction" (0.28 dex) beats the fit**. So the FRP harmonization does not demonstrably harmonize. Night n=5, Africa n=3, NOAA-21 CI unbounded.
- Time-window result undermines the matcher: 15 min -> 0 matches; 30 min -> 33 (S-NPP). At 180 min the "both" matches are mostly different overpasses (README says so). Correlation 0.82 at n=33 vs 0.37-0.44 at scale. Africa corr 0.08. The honest summary is "sensors rarely see the same fire at the same time", which makes per-event merging a questionable product.
- **Doc inconsistency (credibility risk):** PITCH/SUMMARY quote 24h 2026-10-31 numbers (5,917 both, 70,432 VIIRS-only, corr 0.53, NA 0.82/n=38) while README has newer numbers (3 sats, 8,026 both / 68,323 / 10,970, corr 0.44, NA 0.89/n=52). Judges who see two sets of numbers stop trusting either. Also README says a "7-day" file yields "8 days".
- Detection-limit logistic (n=130, 50% at 1.6 MW vs 29 MW) swings 20-61 MW with radius; the README itself says "qualitative". Percentile-of-FRP-as-detection-floor is a proxy, confounded by scan angle/pixel growth, day/night, and VIIRS's own floor. Fine as insight, dangerous as a headline number.
- Confidence mapping (low/nominal/high -> 0.15/0.55/0.90) is a judgment call; 1-(1-p)(1-q) assumes independence (self-described optimistic); VIIRS "high" n=1 in the check.
- Footprint orientation is approximated (98.2 deg orbit heading), bow-tie ignored. Honest, but it is precision engineering on a step that is not the bottleneck.
- **No external validation.** No perimeters (NIFC/ CAL FIRE/ MTBS), no Landsat/Sentinel-2/ground truth. "Validity" criterion is where this loses to a team with one real case study.
- Presentation: static HTML, data is a week; no live link, no named user, no story.

## Risky claims to cut or soften
- "One consistent product" / "sensor of origin no longer matters": not shown, since we have no multi-year overlap analysis. MODIS and VIIRS count series are not shown to be continuous across 2012-present.
- "Why MODIS misses small fires" stated as cause: it is a well-known, published result (Schroeder et al. 2014 VIIRS 375 m; Giglio et al. 2016 MODIS C6). Present as reproduced/quantified, not discovered.
- "Responders can triage single-sensor detections": single-sensor is mostly VIIRS-only small/night fires by construction (87% of night VIIRS < 5 MW), so "VIIRS-only" is not a lower-confidence signal; it is the sensitivity difference. Our own unified-confidence mean (0.51 VIIRS-only) is partly an artifact of the class mapping.
- Any hint of false-alarm handling: PITCH says not validated (gas flares, volcanoes, agricultural burns). Keep that.

## What would make me rank it top
1. A working **burning-activity calendar from ~2000 to present** for a user-chosen AOI, with a harmonization that is *demonstrably* sensor-agnostic: the series stays continuous across the Terra/Aqua -> VIIRS handover, and a test shows it (e.g. a held-out overlap period 2012-2024 where MODIS-scaled-to-VIIRS predicts VIIRS counts).
2. Anomaly vs multi-year median that matches a **known event** (e.g. 2019-20 Australia, 2023 Canada, 2021 Greece, Amazon Aug 2019) and states the lead time or context.
3. A named user and decision ("which weeks should this district pre-position crews / issue burn bans?") plus the honest statement of what the tool can and cannot say.
4. Reproducible, open, with an uncertainty band on every number.

## Top 3 highest-leverage changes
1. **Build the real calendar on multi-year data.** Get a FIRMS MAP_KEY (or bulk archive downloads: MODIS C6.1 2000-, VIIRS S-NPP 2012-, NOAA-20 2018-), aggregate in a lightweight server-less format (per 0.25 deg cell x day counts/FRP sum, as parquet/JSON tiles), and make the Explorer's month x year heatmap with accessible ramp, AOI draw, anomaly vs median, CSV. Everything else is secondary; this is the brief.
2. **Switch harmonization to the level the brief needs: a count/FRP time-series crosswalk, not pixel pairing.** Fit it on the 2012-2024 MODIS/VIIRS overlap per region x season x day/night (e.g. quantile mapping or ratio of cell-day counts above a common FRP/size threshold; the detection analysis already gives the principled threshold: counts above ~X MW are comparable between sensors). Report holdout error with intervals. This reuses your detection-limit work as the *method* instead of a side analysis, and turns the 25-pair weakness into a 10^6-cell-day strength.
3. **Validate on one famous event and tell one story.** Pick one (see below), show the calendar anomaly, overlay an official perimeter or burned-area (MCD64A1 / VIIRS VNP64), and show what harmonization changes ("MODIS-only record would have understated small-fire season X by Y%"). Also reconcile PITCH/SUMMARY/README numbers into one regenerated set.

## 60-second demo moment
"The vanishing fires." Open the Explorer on a drawn AOI (e.g. a Greek/Portuguese or Canadian boreal region). Calendar heatmap 2002-2025. Toggle "raw MODIS+VIIRS": a sudden fake step-up appears in 2012 / 2018 (VIIRS arrival = 'fire increase'). Toggle "harmonized": the step disappears and the true anomaly (e.g. 2023 Canada, bright red month) stands out vs median. Click that cell: list of events and CSV download. Finish by dragging the AOI to a smaller-fire region (agricultural burns / Africa) where the correction is largest. Visual, one idea, instantly credible: *the artificial trend is removed*.
(Fallback within current assets: show the pixel-size slider: MODIS 1 km pixel vs 20 VIIRS pixels inside it, small fires lighting up VIIRS only.)

## Story / title for Galactic Impact
Title options: **"One Fire Record: Ending the False Rise in Wildfires"** or **"The Fires MODIS Couldn't See"**.
Story: Two decades of fire data are quietly lying. When VIIRS replaced MODIS, small fires appeared that were always there. Fire managers, insurers and climate scientists reading raw counts see a trend that is a sensor artifact. We make the record continuous, show which part of any change is real, and give an emergency manager in any country a calendar that says "this month is X% above normal, with Y uncertainty." Impact: early warning, burn-ban/prepositioning decisions, honest climate trend statements, and especially under-resourced regions (Africa/SE Asia) where small agricultural fires dominate and MODIS under-counts most. Anchor on a named user and a quantified "what changes" number, not on pixel matching.

## Past winners context (search, cited)
- Space Apps global winners lists: [2021](https://www.earthdata.nasa.gov/news/spaceapps-2021-winners), [2020](https://www.earthdata.nasa.gov/news/2020-space-apps-challenge-winners), [2023](https://science.nasa.gov/directorates/smd/2023-nasa-international-space-apps-challenge-announces-10-global-winners), [2024](https://www.nasa.gov/learning-resources/stem-engagement-at-nasa/nasa-international-space-apps-challenge-announces-2024-global-winners/), [2025](https://www.nasa.gov/learning-resources/stem-engagement-at-nasa/nasa-announces-2025-international-space-apps-challenge-global-winners/).
- From the search results: 2020 Galactic Impact went to a MODIS/SMAP-based ML project (L.L.O.C.U.S.T.), and the 2020 Best Use of Technology to a fire project (FireWay). The search snippets did not give project descriptions, so I did not verify what made them win; check the pages before quoting. Pattern I can state only tentatively: winners tend to pair a concrete named user problem and a working demo with NASA data, not just a processing pipeline.
