# Responder-lens idea: "Is the empty map really empty?" (Satellite Look Ledger)

Written 2026-11-02 from the point of view of an incident commander / emergency manager. Web checks are cited inline;
anything marked (own knowledge) was not verified in this session.

## 1. The idea in one paragraph

Every responder staring at a hotspot map is reading absence as evidence ("nothing there, so it's out / quiet / safe to
re-enter"), but a satellite only "looked" if it passed over, at a viewing angle that gave a pixel small enough, in
daylight/night conditions where its detection floor was low enough, and with no cloud or smoke in the way. Today nobody
tells you that. We build a **Look Ledger**: for any point or polygon, it lists every Aqua, Terra, S-NPP, NOAA-20 and
NOAA-21 look in the last N hours (and the predicted next looks), converts each look to a probability of detecting a fire of
a given strength (in harmonized FRP/MW), and combines them into one answer: "A 10 MW fire here would have been caught with
P=0.93 in the last 24 h; a 2 MW fire only P=0.41; longest blind gap 9 h 10 min; next good look 02:14Z (NOAA-21,
night, 0.14 km2 pixel, P=0.8)." It is the missing half of every hotspot map: **how much absence-of-detection is worth.**

## 2. User and moment of need

- **Who:** an incident commander / planning section chief / operations chief on a going fire; a county emergency manager
  deciding on evacuation re-entry; a duty officer deciding whether a "no detections since yesterday" fire needs a crew
  tonight; an aviation/overhead dispatcher choosing where to send a recon flight (a limited, expensive resource).
- **Moment:** 05:30 operational-period briefing. Yesterday's heat is not on the map. Questions: Is that flank cold? Can the
  crew go home? Can residents return? Did we miss the spot fire past the line? Where do I spend the one IR flight?
- **What they get today:** a dot map (FIRMS) where blank = "unknown" but looks like "clear". The only standard tool for
  timing is a generic overpass predictor (NASA's overpass tool, NextGIS toolbox) that gives times, not detection ability;
  a Canadian guide notes real overpass times differ from "typical" by about +/-90 min. See sources.

## 3. The exact output

1. **Look timeline** for the AOI (last 48 h and next 12 h): one row per satellite look: UTC + local time, sensor, day/night,
   pixel area at that location (km2, from scan/track growth with scan angle), and P(detect) at 2 / 10 / 50 MW.
2. **Cumulative "would have seen it" curve**: P(at least one detection) vs fire strength (MW), for the window. One chart,
   one headline number per user-chosen threshold.
3. **Blind-gap bar**: longest period with P(detect 10 MW) < 0.5, and when the next look that closes it arrives.
4. **Persistence verdict (optional for a known fire):** "No detection in the last K looks. Evidence that a >=X MW fire is out:
   posterior 0.88 (prior 0.5). Cannot rule out fire below X MW." Wording is always "cannot rule out", never "safe".
5. **Map layer "Minimum detectable fire (MW), next 6 h"** over a region: tells the flight planner where the satellites are
   blind and a recon flight adds the most information.
6. **CSV/JSON download** of the ledger (fits the challenge's CSV requirement) and a one-line printable briefing card.
7. **Calendar tie-in (the official ask):** the burning calendar gets a **detection-effort-adjusted anomaly**: this month vs
   historical median, corrected for how many looks and at what floor each year/sensor era had. Raw counts jump when VIIRS
   replaces MODIS partly because 375 m sees smaller fires; the same model removes that artifact.

## 4. Why harmonization is the key ingredient

- A "look" from Terra at a 7 km2 swath-edge pixel and a night look from NOAA-21 at 0.14 km2 are not interchangeable.
  Counting "passes" is wrong; you need all sensors on **one detection-probability / FRP scale**. That is exactly what we
  already built: footprint geometry, harmonized FRP with uncertainty, and the finding that the floor scales with pixel area
  (MODIS 5th-percentile FRP 5.3 MW at <=1.5 km2 up to 27.4 MW at >6 km2; VIIRS 0.5-4.4 MW).
- Five satellites together give 6-10 looks/day at mid-latitudes with very different quality; only a harmonized model can
  say what the combination is worth.
- The multi-year MODIS+VIIRS record is what lets (a) the calendar anomaly be fair across the sensor transition and
  (b) you learn typical effort per place and season.
- Other teams will mostly build the calendar, map and CSV. A responder-facing product that quantifies *what a blank means*
  is a different thing, and it falls straight out of the detection-limit finding we already own.

## 5. Is it already a product? (checked)

- Overpass predictors exist (NASA ocean-color overpass predictor, NextGIS "prediction of a satellite overpass" toolbox, and
  FIRMS shows last detections), but they give times, not P(detect) per fire size, and do not combine five sensors. The
  search found "no single tool that combines VIIRS/MODIS overpass prediction with active fire results".
- Literature models detection as a probability (logistic curve in fire size/temperature, plus false-alarm rate) in data
  assimilation work (Mandel et al., arXiv 1808.03318; arXiv 2204.00686) and in the VIIRS 375 m ATBD (theoretical 50%
  detection curve vs fire area/temperature; Schroeder et al. 2014). None is delivered as a responder "what does a blank
  mean here" product; the web search found no published tool or FIRMS feature giving a per-location confidence that a
  fire is out. NASA's FIRMS blog on cloud impacts and Ororatech's "missed detections" help page both describe the problem
  in prose only.
- Caveat: I cannot prove nobody inside an agency or a commercial vendor (Ororatech, FireWatch-type vendors) has something
  similar; I only found nothing public. Pitch it as "we found no public equivalent", not "first ever".

## 6. How to build it in under a week (free FIRMS only)

- **Day 1: orbits.** Get TLEs (CelesTrak, free, no key) and compute passes/swath with `skyfield`/`sgp4`; fall back to
  empirically inferred pass times from the FIRMS 7-day CSVs (acq_time clusters per `satellite`) if TLEs are unavailable. The
  empirical route also protects against Terra/Aqua orbit drift (own knowledge: MODIS platforms are near end of life).
  Scan angle per look from geometry; check it against FIRMS `scan` (pixel width grows with angle) as a sanity test.
- **Day 2: pixel area model.** pixel_area(sensor, scan angle) from `scan*track` in the CSVs (already in `hotspots.schema`).
- **Day 2-3: detection model.** Extend `hotspots.detection`: P(detect | FRP, pixel area, day/night, sensor), logistic. Calibrate
  MODIS against VIIRS as referee (pairs already in the pipeline). VIIRS has no better referee, so use (a) the ATBD
  theoretical curve as a prior, and (b) capture-recapture between S-NPP/NOAA-20/NOAA-21 look pairs (~50 min apart, same
  fire) to estimate VIIRS detection rate, assuming near-independence (state it).
- **Day 3: ledger engine.** Combine looks: P_miss = prod(1 - p_i(FRP)). Weight down looks by a cloud prior (see risks).
- **Day 4-5: UI.** Add a "Look Ledger" tab to `web/explorer.html`: click a point or draw a box, see timeline, curve, gap bar,
  next-look; map layer of min-detectable-FRP.
- **Day 5: calendar.** Compute effort index per day/sensor era; show raw vs effort-adjusted anomaly. Full multi-year needs a
  MAP_KEY; before that, demonstrate on the 7-day window and on the MODIS-only vs VIIRS-only comparison.
- **Day 6-7: validation, demo script, write-up.**
- Scope guard: no routing, no fire spread, no weather. Static JS + Python precompute is enough.

## 7. Demo (3 minutes)

1. Pick a real fire from the current 7-day data (e.g. a North American or Australian incident with a multi-day record).
2. Show the plain FIRMS map at a moment when the fire had "no dots" for ~10 h, then re-lit. Ask the audience: "out?"
3. Open the ledger at that moment: the ledger says "10 MW detected with P=0.55 only; blind gap 9 h". The re-light
   afterwards proves the point (this is a **hindcast**, label it as such).
4. Draw a box around a quiet flank: show the min-detectable-MW layer and "next good look in 1 h 40 min".
5. Flip the calendar to the effort-adjusted anomaly and show how a raw MODIS-to-VIIRS jump shrinks.

## 8. Honest validation

- **Calibration on coincident looks (n small but real):** reliability diagram and Brier score for MODIS P(detect) vs VIIRS-
  referee outcomes, held out by region/day. Existing n=130 neighbourhood pairs is the floor; the 7-day file gives more.
- **Persistence test (large n):** treat a VIIRS pixel that burned at look t-1 and t+1 (consecutive overpasses) as "fire
  probably present at t". Compare predicted P(detect at t) with the observed hit rate, binned by pixel area, day/night, FRP.
  Bias: the fire may genuinely have paused; report as an upper bound on misses and note the assumption.
- **Hindcast of false all-clears:** count fires with an "undetected gap then re-detection"; how often did the ledger flag
  the gap as "cannot rule out"? Report hits and false alarms (gaps flagged where nothing re-lit are expected and fine).
- **With MAP_KEY / external truth:** compare against public agency perimeters and containment dates (e.g. NIFC/WFIGS, free)
  and test whether our "evidence of absence" curve is consistent with reported out dates. Do not claim agencies should
  use it that way; they decide on the ground.
- **Not validated and must say so:** cloud/smoke effects, FRP of undetected fires, smouldering low-intensity fires, any
  field-use claim, any user study. No firefighter has used this; we role-played the need. Offer a quick interview with a
  local fire district as stretch.

## 9. Risks

- **False reassurance** is the real danger. Mitigation: wording ("cannot rule out"), conservative defaults, show the
  threshold, never a green "safe" state, prominent not-for-life-safety banner.
- **Cloud and smoke** are not in FIRMS. NASA's FIRMS blog says heavy cloud/smoke cover leaves very limited detection. Our P is
  then an upper bound. Options: coarse free cloud-fraction proxy (Open-Meteo/GFS, own knowledge) or GOES/MODIS cloud mask if a
  token is available; otherwise display "clear-sky" explicitly.
- **FRP is not fire size.** Detection really depends on sub-pixel fire fraction and temperature (ATBD); FRP only proxies it.
- **VIIRS has no independent referee** here: its curves rest on literature plus capture-recapture assumptions.
- **Orbit/timing error** and spurious TLE gaps; mitigate with empirical pass inference.
- **Data scope:** only 7 days free; the effort-adjusted calendar gets stronger with a MAP_KEY.
- **Scope creep** into a "fire out" decision tool. Keep it as an information ledger.

## 10. Runner-up ideas

**R1. "Known Burner" triage / novelty score for new detections.**
Moment: dispatch sees 400 new dots overnight; most are recurring agricultural burns, flares, or prescribed burns. Output: each
new hotspot gets a *rarity* score = how often this ~1 km cell has burned on this date over 2000-present (harmonized
MODIS+VIIRS), plus "first ever" flag near active fires (spot fires / new starts in non-burning ground). Harmonization is the key:
20 years of history must be comparable across sensors, otherwise VIIRS's extra small fires look "novel" everywhere. Build:
recurrence grid in the calendar pipeline (needs MAP_KEY for the history), score and sort, CSV. Validate: do top-rated novel
dots lie nearer later-mapped perimeters than low-rated ones? Risk: overlaps with FIRMS's own static-source/type flags
(own knowledge) and agency "new start" lists, and without MAP_KEY the history is too thin. Feasibility 5/10 without key, 7/10 with.

**R2. Holdover / rekindle watch.**
Moment: fall and spring, after a big fire is "contained", where do I keep a crew or tanker watching? Output: pixels inside last
season's burn that re-emerge, ranked by prior-year burn intensity/persistence and the historical record of overwintering.
Harmonization: needs continuous multi-year record across MODIS and VIIRS. Prior art: Scholten and Veraverbeke's Alaska
overwintering-fire detection algorithm (6 of 7 large reported fires recovered; most reported holdovers too small to see).
So the idea is research-known and regionally narrow. Feasibility 4/10 on free data only (needs multi-year history).

## Sources

- NextGIS overpass prediction tool: https://docs.nextgis.com/docs_toolbox/source/predict_overpass.html
- NASA overpass predictor: https://oceandata.sci.gsfc.nasa.gov/overpass_pred
- Canadian fire guide (overpass +/-90 min, local-time note): https://publications.gc.ca/collections/collection_2026/rncan-nrcan/Fo4-256-2025-eng.pdf
- FIRMS blog, impact of cloud on active fire detections: https://wiki.earthdata.nasa.gov/spaces/FIRMS/blog/2024/08/07/382276882/The+Impact+of+Cloud+on+Active+Fire+Detections
- Detection likelihood modeling: https://arxiv.org/pdf/1808.03318 and https://arxiv.org/pdf/2204.00686
- VIIRS 375 m ATBD (50% detection curve): https://www.star.nesdis.noaa.gov/aerosoltraining/documents/VIIRS_AF_Iband_ATBD_v1.0_20200506.pdf
- Schroeder et al. 2014 abstract: https://modarch.gsfc.nasa.gov/sci_team/pubs/abstract_new.php?id=10242
- Ororatech, missed detections: https://help.ororatech.com/missed-detections
- FIRMS latency Q&A (ARSET 2025): https://earthdata.nasa.gov/s3fs-public/2025-08/arset-2025-firms-part2-qa-spanish-updated-08-11.pdf
- Overwintering/holdover fires: https://presentations.copernicus.org/EGU2020/EGU2020-6013_presentation.pdf and https://apps.dtic.mil/sti/html/trecms/AD1214777/index.html

## Feasibility: 7/10
Engineering is easy (orbits, existing detection module, a UI tab). The risk is scientific honesty: no cloud data, VIIRS has
no referee, and only 7 days free. Those are manageable if the claims are limited to "detection-ability bookkeeping".
