# Health and equity angle: "The Invisible Burn Ledger"

Written from the viewpoint of a district health officer or pediatrician in a smoke-affected community (Punjab/Haryana, Indo-Gangetic Plain; Northern Thailand/Laos; West/Central Africa savanna and farm belt; Amazon arc and Bolivia/Paraguay).

## 1. The problem as seen from the clinic

Every smoke season I get a "fire count" from a MODIS-based dashboard. My district looks quiet. My ward is full of wheezing children. The dashboard is not lying; it is blind in a specific, *non-random* way:

- MODIS (1 km) has a detection floor that rises with pixel area (our finding: 5th-percentile FRP 5.3 MW at nadir, 27 MW at the scan edge; VIIRS 0.5-4 MW). Smallholder crop-residue and household/farm-clearing fires are mostly below it.
- Published evidence agrees: VIIRS finds roughly 2-10x more agricultural fires than MODIS in eastern China (RSE 2018); 65% / 83% of VIIRS fire pixels in forest / low-biomass land in NE Asia were missed by MODIS (Fu et al. 2020); MODIS underestimates daily FRP in Africa by at least 42.8% vs VIIRS (Li, Zhang, Kondragunta 2020, Remote Sensing 12(10):1561); VIIRS-based sub-Saharan emissions run 50-75% above MODIS-based inventories, concentrated in agricultural and savanna zones (Ouattara et al. 2025).
- Consequence: **places dominated by small fires are systematically under-reported in any historical record built on MODIS**, and the record before 2012 has nothing else. Those are exactly the places with the smallest plots, lowest income, and weakest monitoring. Undercounted burning becomes undercounted exposure becomes under-allocated health resources.

## 2. THE IDEA: a sensor-independent "Burning Exposure Equity Gap" report per district

**One-liner:** For any district/ward, show the *harmonized* fire record (MODIS+VIIRS, one scale, with uncertainty) next to what the legacy MODIS-only record says, and quantify the **Invisibility Gap**: the share of burning in my area that the old record never saw. Then turn that into a ranked, downloadable "smoke-season briefing" the health department can use for staffing, school-closure and advisory decisions.

### User
District health officer / pediatric lead / NGO health coordinator / journalist covering a district, in a place where official fire statistics are MODIS-derived or fire-count-derived.

### Moment of need
- Pre-season (Sept for Punjab/Haryana, Feb for Northern Thailand, Jul-Sept for Amazon/Bolivia, Nov-Mar for West Africa): "How bad will my district's season be, relative to what the national dashboard says, and where do I pre-position nebulizers, N95s, clinic hours?"
- Budget/advocacy moment: "Prove to the state that our block is under-counted so we qualify for the smoke-relief allocation."
- Mid-season: "Is this week anomalously heavy versus the same week in previous years, on a like-for-like basis?"

### Exact output (a single page + CSV)
For a chosen admin region and date range:
1. **Harmonized burning calendar** (week x year heatmap; fits the official challenge ask) with weekly counts and summed FRP, plus uncertainty band.
2. **Invisibility Gap** = (harmonized events) vs (events a MODIS-only record would have shown). Headline number: "In your district, 78% of burning events in Oct 2024 were VIIRS-only; MODIS-only dashboards saw 22%." Also gap in FRP-weighted terms, and by time of day (night fires, where VIIRS has a 0.5-1 MW floor, are where the gap is largest: 87% of night-time VIIRS pixels < 5 MW in our data).
3. **Anomaly vs history, era-aware**: this week vs same week in 2012-present using the VIIRS-consistent series, and (separately and clearly labelled) a MODIS-scaled long record 2000+ using a regionally fitted "invisibility factor" (e.g. ratio of VIIRS-era events to MODIS-era-visible events). Never mixing eras silently.
4. **Ranking table across districts**: sorted by *gap* and by harmonized burning per 100 km2 cropland-agnostic area (and per population if a population raster is supplied). "Most under-seen districts" is the equity headline.
5. **Peak-risk windows** (when does burning concentrate: day of week, hour from overpass local time, and the late-evening/night shift where farmers burn after satellite passes; only the overpass times are observable, so we state that).
6. CSV download of per-district per-week harmonized counts, FRP sums, gap, uncertainty, and a data-version stamp.

### Why harmonization is the key ingredient (not decoration)
- The *gap* cannot be computed from either sensor alone. It requires the cross-sensor matching (which VIIRS events does MODIS also see?) which our pipeline does by footprint overlap. The matched/unmatched split IS the measurement.
- The detection-floor finding supplies the mechanism and a defensible reason the gap is structural, not noise.
- FRP harmonization with uncertainty keeps weekly "burn intensity" comparable across sensors and years.
- The 2000-2012 MODIS-only era gets an honest, flagged "likely undercount" multiplier instead of being presented as truth.

## 3. How to build in under a week (free FIRMS data only)

Day 1: Pick 4 pilot regions (e.g. Punjab IN/PK; N. Thailand; Mato Grosso/Bolivia; Nigeria/Benin belt). Pull FIRMS country/area archives for MODIS + SNPP VIIRS (note: the no-key 24h/7d CSVs are all that is guaranteed; **archive access for the multi-year calendar and history needs the MAP_KEY** or the static yearly "archive" downloads on the FIRMS site, which are manual but keyless). Fallback without a key: use manual yearly CSV downloads from the FIRMS Archive Download page for 2-3 seasons, or the rolling 7-day product for the live demo and pre-fetched archives for history.
Day 2: Run existing pipeline per region/season; compute event-level "modis/viirs/both" labels (already produced). Aggregate to week x district. Admin boundaries: geoBoundaries ADM2 (open).
Day 3: Compute gap metrics and the era-aware anomaly baseline; fit a simple regional invisibility factor (VIIRS-era VIIRS-only share) with bootstrap CI over weeks.
Day 4: Extend the Explorer page: region picker, calendar heatmap, gap bars, ranking table, CSV export.
Day 5: Validation (below) and the "briefing" print view.
Days 6-7: Demo script, polish, limitations panel.

Optional enrichment (stretch, not required): WorldPop population per district; a PM2.5 time series (OpenAQ / CAMS reanalysis) for a correlation sanity check.

## 4. Demo plan (3 minutes)
1. Open Punjab, Oct-Nov. Show the MODIS-only dashboard view (what the state sees): "quiet block". 
2. Toggle harmonized: the block lights up; headline "Invisibility Gap 74%".
3. Flip to the ranking: the districts with the highest gap are the ones with the smallest-plot agriculture. Equity story.
4. Show the calendar: the season is longer/earlier than the legacy record implies; anomaly card for this week.
5. Click "Download briefing CSV". Close with the uncertainty/limitations panel (builds trust).
Backup: pre-rendered screenshots for each pilot region in case the network fails.

## 5. Honest validation
- **What we can validate:** (a) the gap is real and structural: stratify by pixel area/scan angle and show the gap grows with MODIS pixel size (already our detection-floor result); (b) consistency with published numbers (Li 2020: >=43% FRP underestimate in Africa; 2-10x count ratio in agri China) as a literature sanity check; (c) stability: the gap by week/bootstrap CI; (d) sensitivity to the matching time window, since near-simultaneous overpasses are rare (our dt<=30 min n is tiny), so "VIIRS-only" partly means "different overpass"; we must report the gap using a *same-day / same-area* definition and show window sensitivity.
- **What we cannot validate with FIRMS alone:** that the extra VIIRS detections are real fires (false alarms from industrial sources, gas flares, hot roofs exist; mask with static-source filter and persistent-hotspot filter); and that gap correlates with health outcomes. For (b)/(c) in health terms, do a modest ecological check: weekly harmonized FRP vs open PM2.5 (OpenAQ/CAMS) in 1-2 regions, lagged 0-3 days, reporting correlation with the explicit caveat that wind transport dominates. If correlation of harmonized is not better than MODIS-only, say so.
- Even VIIRS misses small/short fires (GOES saw ~13.6k vs VIIRS 2.9k vs MODIS 873 in the FIREX-AQ field-validated US sample; EGU2020), so our "harmonized" record is a *floor*, not truth. Say this on screen.
- Do not claim health effects. Claim: "the record the health sector uses under-represents these places."

## 6. Risks
- **Overreach**: implying fire counts = exposure or causal health burden. Mitigation: label it a "visibility and burning-activity" tool, with PM2.5 only as an optional cross-check.
- **Keyless data limits** the multi-year history; MAP_KEY solves it. Plan the demo so it is valid with 2-3 downloaded seasons.
- **Overpass sampling**: we see 2-4 snapshots a day per sensor; evening/night burning is partly invisible. State it.
- **Era mixing** (2000-2012 MODIS-only) is statistically delicate; keep the scaled history visually separate and flagged.
- **False positives** in VIIRS-only detections (infrastructure, flares) inflate the "gap". Apply static-source mask and report with/without.
- Political sensitivity of naming districts/countries (cross-border smoke). Present as data, not blame.
- Small-n regional FRP harmonization (our n=25 pairs): use counts as the primary metric, FRP secondary.

## 7. Is this already a standard product? (verified by search)
- NASA FIRMS, Global Forest Watch alerts, and national dashboards (e.g. Punjab's ISRO-based control room counts, Delhi's stubble-burning source-apportionment DSS) report fire *counts* or contribution to PM2.5 from a single sensor product; I found no product that reports the MODIS-vs-VIIRS *visibility gap* by district or frames it as an equity/under-representation measure. Searches for a health-sector fire-smoke alert tool built on harmonized sensors returned nothing standard (searched 3 formulations; absence of evidence, not proof).
- The detection gap itself is well documented in the literature (Li et al. 2020; Fu et al. 2020; eastern China VIIRS; EGU2020 FIREX-AQ; CEEW 2025 brief arguing against fire-count-only inventories; CCAC "moving beyond fire counts"). That is a *strength*: the science is established; the gap is not turned into a district-level, downloadable decision tool for health officials.
- Closest neighbours: AirNow Fire and Smoke Map (US, PM2.5 sensors + smoke, not sensor-gap), CAMS/GFAS emissions (global emission inventory, not district equity), CEEW burnt-area work (research brief).

Sources:
- Li, Zhang, Kondragunta 2020, Remote Sensing 12(10):1561: https://www.mdpi.com/2072-4292/12/10/1561
- EGU2020 FIREX-AQ comparison abstract: https://meetingorganizer.copernicus.org/EGU2020/EGU2020-3076.html
- EGU2016 VIIRS 375 m small fires: https://meetingorganizer.copernicus.org/EGU2016/EGU2016-17722-2.pdf
- NASA MODIS team abstract (eastern China VIIRS algorithm): https://modis.gsfc.nasa.gov/sci_team/pubs/abstract_new.php?id=44844
- Crop residue review (pixel vs plot size): https://mdpi.com/2072-4292/16/2/342
- CEEW 2025 issue brief: https://www.ceew.in/node/4711
- CCAC, moving beyond fire counts: https://www.ccacoalition.org/resources/monitoring-crop-residue-burning-better-moving-beyond-fire-counts
- Commentary on crop-residue under-detection: https://egusphere.copernicus.org/preprints/2024/egusphere-2024-980/egusphere-2024-980-AC2-supplement.pdf
- Punjab/Delhi news context: https://www.outlookindia.com/national/punjab-air-quality-deteriorates-as-stubble-burning-cases-rise-to-134
Some secondary figures (Fu et al. 2020 percentages, Ouattara 2025) were relayed by search summaries and not opened in full; verify before quoting on a slide.

## 8. Runner-up ideas

**R1. "Smoke-Season Calendar for Schools" (pediatric planner).** Per-district harmonized calendar showing the weeks historically (2012+) with the highest burning density, expressed as "expected heavy-burning weeks" with CI, to pre-schedule school-calendar flexibility, asthma-med stock, and vaccination drives. Output: one-page PDF/CSV per district. Harmonization role: seasonality from a consistent record rather than a MODIS-only shape that misses small-fire shoulder seasons (e.g. early-season crop-residue burning). Feasibility 7/10; risk: needs multi-year archive (MAP_KEY); real value depends on the seasonal shift being detectable. Validation: compare estimated season start/peak between MODIS-only and harmonized, test stability year to year.

**R2. "Night-burn detector for enforcement-evading burning."** Quantify the share of fires seen in the night overpass (VIIRS has the sensitivity at night; MODIS 4-28 MW floors do not) and shifts in day/night ratio over time and by district, as a signal of burning displaced to hours when it escapes both daytime satellites and daytime enforcement (news reports of Punjab farmers burning at night to escape penal action). Output: district day/night ratio trend. Harmonization role: only the combined record separates "no fires" from "fires below MODIS night floor". Feasibility 6/10; risk: sensor overpass timing changes (NOAA-20/21 added) confound trends; sensitive/enforcement implications; do not frame as accusation.

## 9. Recommendation
Build the main idea, scoped to: 3-4 pilot regions, count-based gap as the primary metric, era-aware anomaly baseline, ranking + calendar + CSV, and an upfront limitations panel. It reuses everything we already have (matching, modis/viirs/both labels, detection-floor finding, Explorer) and directly satisfies the official ask (burning calendar, region/date selection, anomalies vs history, CSV) while adding a differentiated, defensible human-impact framing.

Feasibility: 7/10 (the core metric works on 24h data today; the history/anomaly parts depend on archive access or a MAP_KEY).
