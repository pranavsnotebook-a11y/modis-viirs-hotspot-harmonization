# Idea: "Fire Claim Checker" - is the fire trend real, or is it the sensor?

Perspective: climate scientist / forest-carbon policy analyst / journalist. Written 2026-11-02.
Evidence legend: [V] seen in a search result or repo doc this session; [M] from my memory, unverified; [H] hypothesis to be tested by the build.

## 1. The trust problem

Anyone who plots "active-fire hotspots per year" 2000-2026 sees a series made of three different instruments:

1. **2000/2002-2026 MODIS (Terra, Aqua):** 1 km pixels growing to the swath edge. Detection floor ~3.7-5.7 MW at the smallest pixels, ~39-42 MW at the largest (Sofiev & Kouznetsov 2026, GMD) [V, docs/research/literature.md].
2. **2012-2026 VIIRS 375 m:** floor ~0.7-3.7 MW. A VIIRS-based count can be several times a MODIS-based count (one fused-FRP study reports ~3.8x more fire pixels 2012-2024) [V, search snippet of MDPI Remote Sensing 18(10):1650]. In our own 24 h sample, 87% of night-time VIIRS pixels are below 5 MW, i.e. below MODIS's best-case floor [V, README].
3. **Drifting platforms:** Terra and Aqua orbits drift, changing overpass local time, pixel size and spacing, scan gaps and bow-tie overlap. Giglio's May 2025 LANCE note says Terra along-scan pixel size grew to ~970 m by spring 2025 and that the impact on fire products is "under investigation" [V, search snippet of landweb.modaps.eosdis.nasa.gov LANCE_UWG_Orbit_Drift_Giglio_202505.pdf]. Overpass time matters because fires have a strong diurnal cycle; sampling a different hour biases FRP (Remy & Kaiser 2014, ACP 14:13377) [V, snippet].

So a headline like "fires doubled since 2012" can come from (a) a real change, (b) switching MODIS to VIIRS, (c) Terra/Aqua drift, (d) changed edge-of-swath mix, or (e) a mix. Today nobody who is not an active-fire specialist can tell which. The challenge statement itself says the records "cannot be directly compared without harmonization".

## 2. The ONE idea: Fire Claim Checker

A web app where a user types or selects a **claim** ("fires in Region X in 2025 were double 2015") and gets a **verdict card** that separates the apparent change into artefact and residual, with honest uncertainty.

### User and moment of need
- **Journalist / fact-checker** 2 hours before publishing "Amazon fires up 80%". Needs: yes/no/can't-tell and a figure to cite.
- **Forest-carbon / REDD+ / policy analyst** writing a baseline or a reversal-risk statement and asked "is burning really rising in this jurisdiction, or is it the new sensor?"
- **Scientist** wanting a quick triage before spending time on burned-area data.
(The official challenge's users - emergency managers - get the burning calendar and anomaly as the same engine's other view; see section 5.)

### Exact output (the "Claim Card")
For a region (draw, pick country/admin-1, or bbox), a season window (e.g. Aug-Oct) and two periods:
1. **Naive number**: raw counts per sensor, e.g. "MODIS: +12%. VIIRS-only since 2012: +3%. Spliced MODIS->VIIRS: +96%." Showing that the splice, not the world, makes the doubling.
2. **Artefact-controlled trend**: one sensor-independent index (see 3), trend slope in %/yr with a 90% interval and a ratio "period B / period A" with interval.
3. **Artefact budget** (waterfall): how much of the naive change is attributed to (i) sensor switch / detection-floor change, (ii) swath-edge/pixel-size mix, (iii) Terra/Aqua orbit-drift sampling, (iv) residual = candidate real change.
4. **Verdict** with plain-language grade: SUPPORTED (interval excludes 1 and survives all robustness variants), NOT SUPPORTED (interval includes the claim's opposite), ARTEFACT-DRIVEN (naive change large, residual interval includes 0), or TOO UNCERTAIN (wide). Never a bare probability.
5. **Robustness strip**: the same trend under 6 analysis choices (Aqua-only, Terra-only, VIIRS-only 2012+, nadir-only, FRP-floor 10/20/40 MW, day-only/night-only). If they disagree in sign, verdict is downgraded automatically.
6. **Exports**: CSV (region-season-year, index, lower, upper, n, per-sensor raw counts, flags), PNG of the card with a permalink containing region, dates, method version; a one-line citable sentence ("... 90% interval 0.9-1.4x; method fire-claim-checker v0.1; data FIRMS C6.1 SP + VIIRS C2").

### Why harmonization is the whole point
The verdict is only meaningful on a quantity that does not depend on which sensor looked. Harmonization supplies the three parts: (a) footprint matching tells us, for the 2012+ overlap, which VIIRS fires MODIS would have seen; (b) FRP harmonization with uncertainty puts both on one FRP scale (our fit is slope 1.28, CI 0.85-1.64, scatter 0.37 dex, no better than 1:1 at n=25 - the card must carry that uncertainty, not hide it); (c) the detection-limit-vs-pixel-area finding gives the **common-support rule**: count only fire pixels whose FRP exceeds the detection floor of *the worst pixel any contributing sensor could have had in that period*. That makes the index sensor-independent by construction at the price of ignoring small fires - which is the honest trade (and the finding already in the repo).

## 3. Method (what the code does)

**Index = common-support fire power**: per region-season-year, sum of FRP (or count) of fire pixels with FRP >= F_c, using detections from the sensor that has the highest quality for that year, where F_c is the largest per-pixel floor in the comparison (default ~40 MW for MODIS across the whole swath; user-selectable down to ~6 MW if "nadir-only" is on, using scan/track to drop pixels > 1.5 km^2). Optionally an inverse-detection-probability weight w = 1/P_det(FRP, pixel area, sensor), P_det taken from the repo's detection module, so intermediate fires are not thrown away.

**Artefact attribution** by sequential differencing: index with all choices -> remove each control in turn; the shift is that artefact's share. Present as ordered-dependent and say so.

**Splice calibration**: on the 2012+ overlap, estimate sensor ratio R(region, season, FRP class) = count_VIIRS(F>=F_c)/count_MODIS(F>=F_c) with a block bootstrap by year-week. Check R is stable in time. If R drifts (e.g. Terra post-2022) that *is* the drift artefact - and the Terra-vs-Aqua ratio over time is a free drift diagnostic.

**Uncertainty**: block bootstrap over weeks (autocorrelation), plus parameter draws for FRP harmonization and floor. Intervals are widened, never narrowed, by the uncertainty of the calibration; fires in a region with too few overlap pixels get "TOO UNCERTAIN".

**Claim parser**: do not use an LLM to decide anything. A form: region, season, period A, period B, quantity (count / FRP). Optional free-text claim is only shown next to the card.

## 4. Build in under a week with FIRMS data

Honest constraint: we currently have only the free FIRMS 24h/48h/7d CSVs (8 days). A real trend needs years. Plan has two tracks so the demo is true at every stage.

### Track A - works with the 8 days now (the "artefact lab")
These are real measurements, not simulated trends:
1. **Splice-step size** from simultaneous data: for each region, ratio VIIRS count to MODIS count on the same days. This is "the apparent jump you would see at the 2012 switch if the world did not change". Report per FRP class and per region with bootstrap over days/overpasses. This alone is the demo hook: "On identical days, the VIIRS record shows N.N x as many fire pixels as MODIS in Southeast Asia, 2.x in Africa..." (values to be measured; do not quote until computed).
2. **Swath-edge effect**: bin MODIS detections by scan size; show count and 5th-percentile FRP vs pixel area (already in `hotspots.detection`), turn into the P_det(FRP, area) curve.
3. **Terra vs Aqua overpass sampling**: counts and FRP by UTC hour of day per satellite for the same fires matched by footprint; shows what a drifted overpass hour does.
4. **Injection-recovery test bed**: take the 8-day world as "truth", impose known multiplicative trends (x1.0, x1.3, x2.0) and a synthetic sensor switch (replace MODIS pixels by VIIRS pixels after time T; floor change), and check the method (a) recovers the injected trend, (b) flags the switch-only series as ARTEFACT-DRIVEN. This is the only validation possible with 8 days and is still genuinely informative about the estimator's false-alarm rate. Limitation: one week, so no seasonality; state that.

### Track B - real trend (needs a MAP_KEY or archive)
- Free MAP_KEY by email (5,000 transactions per 10 min; area API day range max 5, so loop) [V, data_sources.md]. Ask for it today.
- Without the key: the FIRMS archive download page gives CSV for older data by emailed request [V, data_sources.md]; request 6-8 regions x 2012-2025 now, because delivery is by email. Keep to SP (science-quality) data; do not mix NRT and SP in one series [V, data_sources.md].
- Practical scope for a week: 6-8 pre-chosen regions (e.g. Amazon arc of deforestation, Cerrado, Indonesia/Kalimantan, Central Africa savanna, Punjab/Haryana, California, Siberia/boreal, eastern China agricultural) x seasons, aggregated to week-level counts and FRP sums in a small parquet. The static web page reads that parquet; no backend. If the archive does not arrive in time, Track B ships as "analysis-ready for when data arrives" and the demo uses Track A only; this must be stated on the page.
- Note: Suomi NPP delivery ceases around 2 Nov 2026 [V, data_sources.md]; freeze S-NPP now and use NOAA-20/-21 for the later years.

### Day-by-day (4 people)
- D1: region/season aggregation module; fixture parquet from the 8 days; Track A step-size and P_det code. Request MAP_KEY and archive.
- D2: estimator + bootstrap; injection-recovery harness; unit tests.
- D3: Claim Card UI (static page, extend the existing Explorer): naive vs controlled, waterfall, robustness strip.
- D4: archive data ingestion (if arrived), calibrate R, run 6-8 region claims.
- D5: calendar/anomaly view re-using the same index (satisfies the official brief), CSV export, permalink.
- D6: validation write-up, demo rehearsal. D7: buffer.

## 5. Fit to the official ask
Same engine produces the three required views: **burning calendar** (week x year heatmap of the common-support index with interval shading), **region/date selection**, **anomaly vs history** (z-score computed on the sensor-independent index, so an anomaly in 2025 is not a MODIS-to-VIIRS artefact), and **CSV download**. Existing GFW compares the current week against previous 16 years and ranks significance using 8 years of VIIRS vs up to 18 of MODIS [V, search snippet of GFW blog / blueraster] - i.e. different baselines, no harmonized one, no uncertainty.

## 6. Demo plan (4 minutes)
1. (30 s) Show a real-looking headline chart: spliced MODIS->VIIRS count, "fires doubled in 2012." Ask the room.
2. (60 s) Track A reveal: same 8 days, both sensors, identical fires: VIIRS shows N x. "The doubling is built into the satellite swap."
3. (60 s) Claim Card live on one region with real archive data: naive vs controlled, waterfall, verdict. Flip one robustness toggle (Aqua-only) and show the verdict's stability.
4. (45 s) Injection test slide: inject a known 30% rise, show recovered with interval; inject nothing but a sensor swap, show ARTEFACT-DRIVEN. This is the credibility moment.
5. (30 s) CSV + permalink + citable sentence; one honest "TOO UNCERTAIN" example, which sells trust more than a clean win.
Fallback if archive data is missing: steps 1,2,4 are fully live on the 8 days; step 3 uses a clearly labelled synthetic series.

## 7. Honest validation plan
- **Injection-recovery** (above): coverage of the 90% interval, false-alarm rate of ARTEFACT-DRIVEN, bias per region. Reportable now.
- **Two-sensor consistency** (needs Track B): in 2012-2026 the artefact-controlled MODIS-only and VIIRS-only trends should agree within intervals; raw ones will not. Also Aqua-only vs Terra-only. Disagreement is a finding, shown, not tuned away.
- **Placebo regions/seasons**: apply the claim test to season-region combos with essentially no fire; expect NOT SUPPORTED/TOO UNCERTAIN.
- **Comparison with independent literature**: contrast with published burned-area trends, e.g. the global decline in burned area reported by Andela et al. 2017 [M, unverified] - but active-fire counts and burned area are different quantities, so only agreement in sign for savanna-dominated regions is a sanity check, not proof.
- **Hold-out**: calibrate R on odd years of the overlap, test on even years.
- No ground truth exists for "true fire". Say so on the page.

## 8. Risks and how they are handled
| Risk | Severity | Handling |
|---|---|---|
| Only 8 days now; archive may not arrive | High | Track A is self-contained; label Track B status on the page; do not claim trends from 8 days |
| Common-support rule discards most small fires, so agricultural burning (mostly small) is under-represented | High | Say it on the card; provide the inverse-probability variant with a wider interval |
| FRP harmonization fit is weak (n=25, no gain over 1:1) | Med | Carry its uncertainty into intervals; prefer counts above a floor over FRP sums for headline |
| Detection counts are not fires or burned area; cloud cover and number of overpasses vary by year | Med | Normalize by valid-observation proxy where possible (overpass counts per region-week); disclose |
| Orbit drift effects are not fully characterized even by the MODIS fire team [V] | Med | Use Aqua/Terra split and diurnal-hour plots as diagnostics, not as a corrected-for-certain claim |
| Sofiev & Kouznetsov detection-limit numbers come from one 2026 paper | Low-Med | Re-measure our own floors from the data; use the paper as cross-check |
| Verdict labels over-interpreted by journalists | Med | Three-way plus TOO UNCERTAIN, always show interval, no single score, wording reviewed |
| Scope creep into a fire-science paper | Med | Fix 6-8 regions; stop at D5 |

## 9. Novelty check (WebSearch, 2026-11-02)
- No result described a tool that tests fire-trend claims with sensor-artefact attribution and uncertainty. Searches for sensor-independent trend + uncertainty on Global Forest Watch returned only the GFW blog and Blue Raster stories: GFW compares to previous 16 years and notes alerts are not fire counts, but nothing on harmonized trends [V: https://www.globalforestwatch.org/blog/fires/fighting-fires-with-satellites-viirs-fire-data-now-available-on-global-forest-watch ; https://blueraster.com/stories/global-forest-watch-fires/].
- A search for a 2012 trend break found no direct analysis; the closest were the MDPI study of fused MODIS-VIIRS FRP 2012-2024 (3.82x more fire pixels) [V: https://www.mdpi.com/2072-4292/18/10/1650] and the CAMS note "Drifting away from MODIS" [V: https://atmosphere.copernicus.eu/drifting-away-modis-cams-global-fire-assimilation-system].
- Orbit drift: Giglio 2025 LANCE slides (impact under investigation) and the 2022 MODIS science team talk (drift artefacts in FireCCILT11) [V: https://landweb.modaps.eosdis.nasa.gov/data/filePost/LANCE_UWG_Orbit_Drift_Giglio_202505.pdf ; https://modis.gsfc.nasa.gov/sci_team/meetings/202211/presentations/giglioRoyRanderson.pdf]. Remy & Kaiser 2014 for diurnal-sampling FRP bias [V: https://acp.copernicus.org/articles/14/13377/2014/].
- Existing multi-sensor apps (Fireguard, fire.ai history 2004-present, OroraTech) are monitoring/alert tools; fire.ai snippet shows no uncertainty or trend testing [V: https://fire.ai/]. Uncertainty-aware visualization of heterogeneous detections exists as a 2019 paper, not a trend-claim tool [V: aminer.org listing].
- Caveat: absence in a few searches is weak evidence. Specialist groups (e.g. the MODIS fire team) may have internal analyses. Present the project as a transparent, usable tool, not as a first scientific result.

## 10. Runner-up ideas

**Runner-up A - "Sensor Swap Simulator" (education / newsroom explainer).** Interactive: pick a region, slide the "sensor era" and see the same real fire day rendered as MODIS-only, VIIRS-only, and harmonized, with counts and a "false jump" meter. Built entirely from Track A; feasibility 8/10 (can be done in 3 days, true with 8 days of data), impact lower than the full checker. It is also Track A's demo front-end, so low-regret.

**Runner-up B - "Orbit-Drift Watch" (data-quality dashboard for the fire community).** Ongoing monitor: per satellite per week, mean overpass local time, pixel size, scan gaps, count ratio Terra/Aqua and MODIS/VIIRS in matched regions; alerts when the ratio departs its baseline - an early-warning for trend contamination as Terra (end ~Jan 2027) and Aqua (end ~Sept 2027) wind down [V, search snippet]. Feasibility 6/10; needs multi-year data and would appeal to scientists and NASA, less to journalists.

## 11. Feasibility score
**6.5 / 10.** The method and Track A are solid and demonstrable with the data in hand. The score is held down by the dependence on multi-year archive data for the headline trend, the weak FRP harmonization, and the genuine scientific difficulty of attributing drift effects; the injection-recovery and the explicit TOO UNCERTAIN verdict make the project honest even if Track B arrives late.
