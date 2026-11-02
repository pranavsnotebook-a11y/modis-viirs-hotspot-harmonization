# Innovation below the model level: what actually improves output quality?

Researched 2026-11-02. Scope: L1B radiances, differentiable detectors, library work, native kernels, hardware, sampling theory.
Question from the team: is there real value below the model level, judged by OUTPUT QUALITY and not speed?

## Bottom line

1. **Speed is not a lever.** The pipeline already does a global FIRMS day in about 2 s. Native code, GPU, Rust or Metal would make
   a 2 s job faster and change no number in the output. Measured here (section 6): 1e8 Monte Carlo detection trials take 3.2 s in plain
   NumPy on an M4; 1e8 rows of trigonometry take 3.3 s. The 25-year archive is roughly 0.5-0.6 billion detection rows (estimate), i.e.
   well under a minute of vectorised trig per operation. Nothing here is "impossible without C".
2. **Going to L1B is real science but is a data-volume problem, not a CPU problem.** One day of L1B inputs for all five sensors is on
   the order of 0.5 TB (extrapolated from sampled granule sizes, section 3.1), against about 13 MB/day of FIRMS CSV. The cost is
   downloading, not computing.
3. **The cheapest, largest quality gains are not at the L1B level.** My quick diagnostic on the repo's own 7-day files (section 6)
   shows the sensors sample very different local times: Aqua day passes at about 15.7 h local solar time, Terra at about 8.7 h,
   NOAA-20/21 at about 13.5 h. NASA states both MODIS orbits are drifting. The README lists overpass time as "untested" for the
   Aqua/Terra 2x gap. That is where I would spend the first day.
4. **No published differentiable or soft-threshold reimplementation of the MOD14/VNP14IMG contextual test was found** (about six
   searches; not exhaustive). Also, the contextual tests have only about 6-10 tunable constants per sensor and day/night mode, so
   gradients are not needed to tune them; a grid search does the same job. The real obstacle is independent labels, not differentiability.
5. **Do not invent library gaps.** The soft-threshold primitive already exists (SoftJAX/SoftTorch, 2026), thinned and missing-event
   point processes already exist in the ML and ecology literatures. A custom observation operator is worth writing as about 50 lines
   inside this repo; it is not worth a library or an upstream PR.

## Evidence legend

- **[V]** read in full text or structured data in this session. The primary PDFs (Giglio 2016, Schroeder 2014, VIIRS 375 m user guide v1.2,
  Giglio 2025 slides) were downloaded and text-extracted locally. NASA CMR granule metadata was fetched live on 2026-11-02.
- **[S]** seen only in a search-result snippet, a summarising fetch tool, or secondary text. Check before quoting.
- **[M]** measured by me on this repo's data or on synthetic data in this session; the code was run, but it is in the scratchpad and not in the repo.
- **[U]** background knowledge or inference, not verified.

## Ranking by expected output-quality gain per unit effort

Effort is person-days for a team that already has the repo. "Gain" is what it does to the harmonized record or to the honesty of its
claims, not to speed.

| Rank | Option | Effort | Gain | Notes |
|---|---|---|---|---|
| 1 | Stratify and adjust every sensor comparison by **local overpass time** (diurnal sampling), using the six overpass slots already in the data | 1-2 d | High | Plausible main driver of the Aqua/Terra 2x gap. FIRMS-level, no L1B needed. Causality not yet shown (section 6). |
| 2 | **VNP14 750 m** as a bridge product (same MIR band family and similar pixel size as MODIS; NASA says it performs like MYD14) | 1-2 d | Medium-High | Granules are about 0.8 MB each [V CMR], roughly 0.2 GB per satellite-day. Removes the pixel-size factor from the comparison. Needs Earthdata Login. FIRMS serving of VNP14 not checked [U]. |
| 3 | **Detection-limit / thinning observation model** with covariates (pixel area, view angle, day/night, local time), fitted jointly across sensors in plain PyTorch or NumPy | 3-5 d | Medium-High | Two sensors seeing the same fire field with different detection curves make the curves identifiable. Builds on Sofiev & Kouznetsov 2026 and the repo's n=130 logistic fit. |
| 4 | **L1B degradation experiment** on a few coincident granules: aggregate VIIRS I4/I5 to about 1 km in the radiance domain, run the Collection 6 tests (Eqs. 1-6), compare with MYD14 | 4-7 d | Medium (causal attribution, not a new product) | About 8-10 GB for 10 granule pairs. Splits "algorithm" from "resolution" from "time". Coincident overpasses are rare (repo: n=25 pairs at 30 min). |
| 5 | Output **schema for harmonized and future detectors**: per detection store footprint, local time, angles, background mean and MAD, saturation flag, and a minimum-detectable-FRP value | 1 d (design only) | Medium for the narrative, zero for current numbers | VNP14IMG already carries background statistics for fire pixels [V]. |
| 6 | Learned or soft-threshold detector on L1B with INDEPENDENT labels (Landsat-8/9, Sentinel-2 SWIR, perimeters) | 15+ d | Unknown, possibly high | Research project. Circular if trained on VNP14IMG labels. |
| 7 | One common detector over L1B from both sensors, run globally | 20+ d | Unknown | Data volume, band mismatch, and the algorithm authors' own finding (section 3.1). Not for a hackathon. |
| 8 | Hardware / on-board work | any | None for the current product | Simulation only. |

## Not worth doing (details in the sections below)

- C, Rust, Metal or GPU kernels for the current pipeline, the matching, the per-pixel geometry, or Monte Carlo detection. No output change.
- A global common detector on L1B, or a "differentiable MOD14" as a headline claim, without independent labels and without a data budget.
- Training any learned detector on VNP14IMG or MOD14 flags and reporting agreement with them (circular).
- A new point-process library, a fork of EasyTPP or neural STPP, or an upstream PR. The idea is not new and the repo needs about 50 lines, not a library.
- Compressed sensing of fire fields from irregular swaths.
- Optimal constellation scheduling from a learned diurnal cycle as a project (a crowded literature, and not a quality lever for a MODIS/VIIRS record).
- FPGA, Jetson or on-board prototyping. A hackathon can only simulate it.
- 25-year per-pixel orbital geometry rebuilt from TLEs. FIRMS already gives `scan` and `track`, and L1B geolocation gives angles exactly.

## 1. Upstream of FIRMS: one detector on L1B radiances

### 1.1 What the two operational algorithms are (read in full text)

Sources: Giglio, Schroeder & Justice 2016, RSE 178:31-41 [V]; Schroeder, Oliva, Giglio & Csiszar 2014, RSE 143:85-96 [V];
VIIRS C2 375 m Active Fire User Guide v1.2, June 2025 [V].

| | MOD14/MYD14 C6/C6.1 | VNP14IMG (375 m) |
|---|---|---|
| Inputs | 4, 11, 12 um brightness temperatures; day also 0.65, 0.86, 2.1 um reflectance (MOD021KM/MYD021KM; land/sea mask from MOD03/MYD03) | I1-I5 (375 m) plus M13 (750 m) for FRP; C2 uses the Level-1B radiance and geolocation products |
| MIR band | bands 21 and 22, 3.929-3.989 um. Band 21 saturates near 500 K; band 22 near 331-335 K (sources disagree [S]) | I4, 3.55-3.93 um centred 3.74 um, saturation 367 K [V]. M13 3.973-4.128 um, dual gain, about 634 K [V] |
| TIR band | 31, 11 um | I5, 10.5-12.4 um, saturation 380 K [V] |
| Absolute test | T4 > 360 K (320 K at night) | BT4 > 335 K and dBT45 > 30 K (day); > 300 K and > 10 K (night) [V] |
| Contextual tests | dT > mean + 3.5 MAD(dT); dT > mean + 6 K; T4 > mean + 3 MAD(T4); T11 > mean + MAD(T11) - 4 K; MAD(T4 fire pixels) > 5 K | Day: dBT45 > mean + 2 MAD and > mean + 10 K; BT4 > mean + 3.5 MAD; BT5 > mean + MAD - 4 K or MAD(background-fire BT4) > 5. Night: 3 MAD, +9 K, 3 MAD [V] |
| Background window | up to 21 x 21 | 11 x 11 growing to 31 x 31 until 25 % valid or at least 10 valid [V] |
| Output of the algorithm | five classes (missing, cloud, non-fire, fire, unknown) | fire mask plus per-fire-pixel FP_T4, FP_MeanT4, FP_MAD_T4, FP_MeanDT, FP_WinSize, FP_power, FP_Rad13 [V] |

What this means for the idea of "sub-threshold information":
- The swath file keeps the contextual statistics only for pixels that were flagged. A pixel that narrowly failed a test is not
  kept. FIRMS CSVs keep even less. The L1B inputs are about 400 times larger per granule than the VNP14IMG granule (about 1.3-1.6 MB
  vs roughly 600 MB across VNP02IMG, VNP03IMG and VNP02MOD) [V CMR; arithmetic is mine].
- FRP in VNP14IMG is not an I-band quantity. It is computed from the 750 m M13 channel, and all 375 m fire pixels inside one M13
  pixel share the same fractional FRP value [V user guide]. Any harmonization that treats per-pixel VIIRS FRP as independent
  pixel-level information is overstating it. This matters for the repo's FRP fit.

### 1.2 Has a literal common detector been tried?

- **The algorithm authors found that direct reuse of the MODIS tests failed on VIIRS.** Schroeder 2014 [V]: the 367 K I4 saturation
  and the shorter I4 wavelength "prevented direct application of the original MODIS detection tests". I4 also carries about a
  three-fold larger reflected-solar component than M13 [V]. The tests were retuned (different multipliers and offsets, new
  saturation, SAMA and glint handling). So even the NASA team's own lineage has two related but non-identical detectors.
- I found no paper that runs one identical detector on MODIS and VIIRS radiances for harmonization. Searches were limited; absence
  here means "not found", not "does not exist".
- Related prior art found: Landsat-8/OLI 30 m active fire algorithm (Schroeder et al. 2016, RSE 185:210-220 [S]); a learned CNN
  detector for VIIRS and MODIS volcano hotspots (HotLINK, Saunders-Shultz et al. 2024, Frontiers in Earth Science 12:1345104 [S]); a
  Himawari-8 CNN (FireCNN [S]); probabilistic downscaling of contextual MODIS tests (Kumar et al. 2019 [S]); and a 2026
  on-orbit MWIR detector paper that positions itself against MODIS/VIIRS contextual methods (arXiv 2605.06273 [V abstract]).

### 1.3 Is a differentiable soft-threshold contextual detector published?

- **Not found.** One sentence for the record: a sigmoid in place of each indicator is trivial, and SoftJAX/SoftTorch (Paulus et al.,
  arXiv 2603.08824, March 2026 [V abstract]) already provide soft versions of hard operations for JAX and PyTorch. I could not confirm
  from the abstract that they ship a soft comparison operator [U].
- **Nearest published work on learnable detection curves** (important, so we do not claim novelty wrongly): Haley, Farguell Caus,
  Kochanski, Schranz & Mandel, arXiv 1808.03318 [V abstract]: a data likelihood for MODIS and VIIRS detections given a fire-model
  state, using a logistic regression of detections plus Gaussian geolocation error. Mandel et al. 2014 is the precursor [S]. This is
  detection-curve learning at the fire-model level, not at the radiance level.
- **Honest assessment of what differentiability buys.** The contextual detector has roughly 6-10 constants per sensor and mode.
  A grid search, CMA-ES or Bayesian optimisation tunes them without gradients. Differentiability matters only when the detector is
  embedded in an end-to-end model with many parameters. For our problem the binding constraint is **labels**, not gradients:
  - training on VNP14IMG or MOD14 flags only reproduces those flags (circular);
  - independent truth would come from Landsat-8/9 or Sentinel-2 SWIR active fire, ASTER (used by Giglio 2016 for validation [V]), or
    perimeters (the repo lists external validation as "not yet").

### 1.4 What a physics-level harmonization would require, and what breaks

| Issue | Facts | Consequence |
|---|---|---|
| MIR band | MODIS 3.96 um (band 21/22) vs VIIRS I4 3.74 um vs VIIRS M13 4.05 um | Different Planck sensitivity to fire temperature and different reflected-solar leak; thresholds cannot be shared |
| Saturation | I4 367 K [V]; MODIS band 21 about 500 K, band 22 about 331-335 K [S]. I4 folds over (DN wrap) in intense fires and mixed saturated pixels get spurious radiances after onboard aggregation, with no L1B flag for the mixed case [V user guide] | I4-only detection is robust but I4-based FRP is not; this is why FRP uses M13 |
| Pixel size and PSF | MODIS 1 km at nadir growing off nadir; VIIRS I-band 375 m, aggregated in 3 zones (3, 2, 1 native samples), 383 x 360 m at nadir to 795 x 784 m at 56.3 deg, radiance-domain averaging [V] | Needs an explicit degradation operator to compare at one resolution |
| Bow-tie | VIIRS: onboard deletion of 4 (zone 2) or 8 (zone 3) outer rows per scan, about 50 % redundancy removed, appears as fill stripes, flagged in the fire mask [V]. MODIS: bow-tie overlap exists and is changing with orbit drift [V Giglio 2025]; how MOD14 handles overlap duplicates not verified [U] | Duplicate counting at MODIS scan edges is a real confounder for count comparisons |
| Cloud and glint inputs | MODIS uses 12 um (T12) and bands 1, 2, 7; VIIRS I-band uses I1-I3, no 12 um [V] | The false-alarm filters differ, so "same detector" would drop information from one sensor |
| Time | Fires change within 10-30 min (repo: only 25 pairs within 30 min) | L1B harmonization does not remove the time offset, only the algorithm offset |

### 1.5 Products and data volume

Granule sizes below were read from NASA CMR (anonymous search API, queried 2026-11-02 for the newest granules) [V]. CMR reports
"granule_size" without units for most products; I read VNP02IMG explicitly as MB and assume MB for the rest [U]. Sizes vary with
day/night (the VNP02IMG samples were all daytime; MOD021KM samples were 64 and 118 MB); treat everything as order-of-magnitude.

| Product (short name) | What it is | Sampled size per granule | Granules per day per satellite |
|---|---|---|---|
| VNP02IMG | VIIRS 375 m radiances (I1-I5) | 246-273 MB (day) | about 240 (6-min) |
| VNP03IMG | VIIRS 375 m geolocation | 142-175 MB | about 240 |
| VNP02MOD | VIIRS 750 m radiances (M13 for FRP) | about 198 MB | about 240 |
| VJ102IMG (NOAA-20) | same as VNP02IMG for NOAA-20, collection 2.1, from 2018-01 [V CMR] | not sampled | about 240 |
| MOD021KM / MYD021KM | MODIS 1 km radiances. LAADS lists both a 6.1 collection and a V7 collection [V CMR]; MOD14 and MYD14 are still V061 [V CMR] | 64-118 MB (V7, netCDF) | 288 (5-min) |
| MOD03 / MYD03 | MODIS geolocation (6.1 HDF about 26 MB; V7 netCDF about 86 MB) | 26-86 MB | 288 |
| VNP14IMG / VNP14 | the finished fire products | 1.3-1.6 MB / 0.8 MB | about 240 |

Estimate [arithmetic is mine, from the sampled sizes]:
- VIIRS L1B for fire: about 590-650 MB per granule x 240 = roughly 0.15 TB per satellite-day. Night granules may be smaller.
- MODIS L1B for fire: about 90-200 MB per granule x 288 = roughly 26-58 GB per satellite-day.
- All five (S-NPP, NOAA-20, NOAA-21, Terra, Aqua): about 0.5 TB/day; about 3.5 TB per week. S-NPP deliveries end around now per
  `docs/research/data_sources.md`, which leaves about 0.35 TB/day.
- Twenty-five years of MODIS L1B alone is of order 0.3-0.6 PB. Not a hackathon activity.
- At 100 MB/s, one day of five-sensor L1B is about 1.5 h of transfer. CPU time for the detection step is minutes (section 6).
- A feasible demo is 10 coincident granule pairs, about 8-10 GB.

Access: CMR search needs no login (I used it above). LAADS downloads need an Earthdata Login token sent as `Authorization: Bearer`;
the LAADS page also offers an LAADS-only app token, and says the EDL token can make LAADS downloads slower [V]. LP DAAC files
(VNP14IMG, VNP14, MOD14) also sit behind Earthdata Login (the download URLs are on data.lpdaac.earthdatacloud.nasa.gov; I did not
download any) [U]. No numeric rate limit is documented; the LAADS page warns that many requests for nonexistent files can get an IP blocked.

### 1.6 Recommended way to test "physics-level harmonization" without a global product

The degradation experiment (rank 4) is the honest version: take coincident or near-coincident Aqua and VIIRS granules, aggregate
VIIRS I4/I5 into MODIS-like 1 km samples in the radiance domain, apply the MOD14 Collection 6 tests to them, and compare with
MYD14 and VNP14IMG. The three-way comparison separates algorithm, resolution and time. Cheaper first step: compare VNP14 (750 m) with
MYD14 (rank 2). Caveats: n of coincident pairs will be small; the experiment cannot test detection truth, only inter-sensor consistency.

## 2. Library-level work

### 2.1 What already exists

- **Soft/differentiable thresholds**: SoftJAX and SoftTorch, arXiv 2603.08824 [V abstract]. Do not write another.
- **Neural spatio-temporal point processes**: Chen, Amos & Nickel, ICLR 2021, arXiv 2011.04583, code `facebookresearch/neural_stpp`
  (PyTorch + torchdiffeq, license CC BY-NC 4.0 per search summary [S], so non-commercial); Auto-STPP, Zhou & Yu, NeurIPS 2023,
  arXiv 2310.06179, code `Rose-STL-Lab/AutoSTPP` [S].
- **EasyTPP** (ICLR 2024, `ant-research/EasyTemporalPointProcess`): a benchmark toolkit for neural TPPs in PyTorch (and TensorFlow).
  The introduction page I read does not mention spatial processes, covariates, observation models or missing-event handling,
  and its "Thinning Algorithm" page concerns sampling from the model [V]. That is absence of mention on one page, not proof of absence in the code.
- **Missing, thinned or intermittently observed events**: Gupta et al., "Learning Temporal Point Processes with Intermittent
  Observations", AISTATS 2021 (PMLR v130) [S]; Liu & Hauskrecht, "Event Outlier Detection in Continuous Time", ICML 2021 (PMLR v139),
  which models omitted points as a removal process [S]; Mei & Eisner neural Hawkes, which imputes missing events by particle
  smoothing [S]; a debiased-thinning dissertation from LSU [S].
- **Thinned Cox processes with imperfect detection** are standard in ecology: Koshkina et al. 2017, MEE 8:420-430 (inhomogeneous
  Poisson with detection probability) [S]; thinned LGCP in Koshkina's thesis chapter and arXiv 2511.16447 (2025) [S]. JAX Hawkes/Cox
  tooling exists (`intensify` 0.2.0, non-neural [S]).
- **Detection-limit observation operator for these exact sensors**: Sofiev & Kouznetsov 2026, GMD 19:10123, detection limit linear
  in pixel area, pixel-level, with MODIS-VIIRS cross-mapping [V, from `docs/research/literature.md`].
- **Learned detection curve for MODIS/VIIRS detections**: Haley et al. 2018, see section 1.3.

### 2.2 Real gaps (kept to what I could support)

1. **A maintained point-process library that exposes a covariate-dependent thinning likelihood** (log L = sum log(p_det_i * lambda(x_i)) minus
   the integral of p_det * lambda). I did not find one in EasyTPP's documentation. I could not check the full code of any library, so
   this is a "not seen", not a proven absence. The mathematics is a few lines; the hard part is identifiability, not code.
2. **Identifiability is the real scientific content, and our setting is favourable.** p_det and lambda are confounded with one
   sensor. With two or more sensors that observe the same latent fire field with different, covariate-dependent detection curves
   (pixel area, view angle, local time), the curves are identifiable in principle. Nobody I found has done this for MODIS and VIIRS
   with a neural intensity; I would not claim it is unpublished beyond "not found in six searches".
3. **Training data caveat**: the repo's only direct detection curve uses n = 130 fires within one overpass pair; a joint model on
   FIRMS-scale data will have much more data, but it has no ground truth for "fire exists but undetected".

### 2.3 Verdict

Write the custom likelihood, a logistic detection curve in (log FRP, log pixel area, view angle, local time), and the loss as plain
PyTorch or NumPy inside this repo (about 50 lines; a few days including diagnostics and simulation-based recovery tests). Do not fork a
library, and do not plan an upstream PR: upstreaming into a benchmark toolkit is possible but costs review cycles for no gain in
this project's output. A concrete, honest test is a simulation: generate fires, thin them with known detection curves for two sensors,
and check the model recovers the curves.

## 3. C, Rust, GPU, Metal

Measured on this machine (Apple M4, 10 cores, 24 GB; NumPy and SciPy from the repo .venv, single-threaded vectorised code, synthetic
data) [M]:

| Task | Time |
|---|---|
| Dense, approximate 11 x 11 contextual statistics on one full VIIRS granule (6464 x 6400), SciPy `uniform_filter` | 3.1 s |
| Exact masked background mean and MAD only at about 9.6k candidate pixels of one granule | 0.29 s |
| Exact window statistics for 1e5 candidates | 0.054 s |
| Monte Carlo: 1e8 sub-pixel fire trials through a Planck forward model and a contextual test | 3.2 s |
| Trigonometry on 1e8 coordinates | 3.3 s |

Caveats: the data are random, not real radiances; no cloud, water or glint logic; real granules add I/O and decompression.

Concrete conclusions:
- The detection step for a full VIIRS satellite-day (about 240 granules) is minutes to tens of minutes single-threaded and a few
  minutes on 10 cores. A native kernel would cut that by 10-30x and still be hidden by the transfer of about 0.15 TB.
- 25 years of per-detection geometry: about 0.1 billion MODIS rows plus about 0.47 billion VIIRS rows (assumption: about 9k MODIS
  and about 50k VIIRS detections per satellite-day, from the repo's 7-day files, times 25 satellite-years of VIIRS). Each vectorised
  operation over that is on the order of 20 s. No native code.
- Monte Carlo over detection: 1e10 trials is about 5 minutes in NumPy. A GPU or Numba would reduce this and change no result.
- Where native code is legitimate: porting a finished detector to flight software (C on an embedded target), or a streaming
  L1B reader when the archive is local. Neither exists in this project, and neither affects output quality here.
- Orbital geometry: FIRMS provides `scan` and `track`; VNP03IMG and MOD03 provide exact view and sun angles. The README's own check
  shows heading-oriented footprints give 83 matches vs 81 axis-aligned, so extra geometric precision from a rewrite has little to recover.

Verdict: pure vanity for this project. If asked "what would justify it", the answer is a measured wall-clock bottleneck above about 10 minutes that
blocks a decision. There is none.

## 4. Hardware and on-board detection

What exists (all [S] unless noted; marketing claims are not independently verified):
- **Phi-Sat-1** (ESA): CloudScout CNN on an Intel Myriad 2 VPU, Sentinel-2-derived training data, drops frames over 70 % cloud, reported
  92 % accuracy and 1 % false positives. Giuffrida et al., Remote Sensing 12(14):2205, 2020 (MDPI; not IEEE JSTARS). It is cloud
  detection, not fire.
- **OroraTech** (FOREST-1 prototype, FOREST-2): thermal IR (MWIR and LWIR) with NVIDIA Jetson processing on orbit; FOREST-2 about
  200 m per pixel, 410 km swath. Company slides claim 3-10 minutes from imaging to notification; a 2026 report claims 1-2 minutes for a
  Greek constellation (low-authority source). A 30-minute global revisit is a target of the full constellation, not current.
- **arXiv 2605.06273** (Rötzer et al., 7 May 2026, abstract read [V]): deployed on-orbit wildfire detection on a nine-satellite
  commercial thermal constellation; Jetson Xavier NX with TensorRT FP16; uncalibrated single-band MWIR at 200 m; best 0.699 pixel AP
  and 0.744 event-level F1, under 1 MB model, alert within 10 minutes of overpass as the target. Authors position the work against
  MODIS/VIIRS contextual methods, which they say do not address sub-pixel fire detection.
- **FireSat** (Earth Fire Alliance, Muon Space): protoflight launched March 2025; three operational satellites on 7 July 2026; plans
  for an hourly global revisit by about 2029 from news coverage. I could not confirm the 5 m or 20 m resolution figures that circulate.
- **FUEGO** (Berkeley, 2013 Remote Sensing): geostationary concept, detect 12 m2 fires from GEO; no evidence of a funded build.
- Smaller items: FIRE-SAT on OPS-SAT (smoke from RGB), Tallinn thesis on a 6U CubeSat CNN (about 111 s for a Sentinel-2 scene at 1.5 W).

What a harmonized detector design means for future missions (design lessons, mine):
- The MODIS/VIIRS mismatch is partly a data-product problem: each detection is a binary flag from a sensor-specific algorithm with
  hidden thresholds. Future missions can do better by **recording, per detection and per scene, the information a downstream
  harmonizer needs**: footprint polygon, local time, view and sun angles, MIR and TIR brightness temperatures, background mean and
  MAD, saturation or fold flags, and a minimum-detectable-FRP value (the detection limit for that pixel and background). The
  VNP14IMG fire-pixel arrays already include background statistics [V], so the pattern exists.
- A sensor-conditional detector, with thresholds that are explicit functions of NEdT, pixel area and view angle, is the design
  version of the soft-threshold idea in section 1.3.

What a hackathon can only simulate: radiation upsets, power and thermal limits, flight timing, calibration of an uncooled
microbolometer, any claim about real downlink latency. What a hackathon can do honestly: run the detection arithmetic on recorded
granules in fixed point or FP16 and count operations; quantify how much detection changes under int8 quantisation of BT; show the
schema above. Rank: no gain for the current product; keep to one slide.

## 5. Sampling theory and instrument-design theory

- **Diurnal-cycle sampling is the live, established problem.** Andela et al. 2015 (ACP 15:8831) show that four daily MODIS looks
  give erroneous FRE unless a diurnal climatology is used; ignoring the cycle generally overestimates FRE [S]. Freeborn et al. 2011
  studied MODIS sampling design using SEVIRI [S]; Zheng et al. 2021 combined Himawari-8 diurnal information with VIIRS [S].
  Established, so the novelty of "learn a diurnal cycle" is low; the use for harmonization is high.
- **Orbit drift makes the MODIS record non-stationary**, and NASA is studying it. Giglio, LANCE UWG, May 2025 [V slide text]: affected
  are the sampling of the diurnal cycle, pixel size and spacing (about 1 km to about 970 m along-scan by spring 2025), gap between
  successive scans, bow-tie overlap and spatial sampling patterns; "impact on MODIS fire products is under active investigation".
  Aqua passed 1:45 PM local time in February 2023 and is projected near 3:50 PM by August 2026; Terra was projected to reach about 9:00 AM
  by December 2025 [S, NASA Terra and LAADS pages via search summaries; check current NASA notices].
- **Compressed sensing of fire fields from irregular swaths**: the only item found is a 2023 concept paper for a compressive payload on
  a geostationary satellite (Engineering Proceedings 51:32 [S]). It is a payload concept, not a reconstruction of fire fields from
  swaths. The method needs many incoherent measurements of a roughly static sparse signal; polar swaths are a few snapshots per day
  of a signal that changes in minutes. Poor fit; not worth doing.
- **Constellation design and scheduling for fire** is a crowded literature: NSGA-II LEO design for Australia (arXiv 2209.07038 [S]),
  time-driven multi-objective scheduling (2024 preprint [S]), a mixed-integer program for a NASA constellation (IJCAI 2025 [S]), a
  2026 arXiv paper on CNN detection with Bayesian updating and scheduling [S]. Peer-review status of several is unconfirmed. A diurnal
  cycle learned from our data would only be a prior for a scheduler; it does not improve a MODIS-VIIRS record.

## 6. What I measured on the repo's own data (a diagnostic, not a result)

Method [M]: for each FIRMS row, local solar time = UTC hour + longitude / 15, ignoring the equation of time (about +/-0.25 h); files
`data/modis_7d.csv`, `data/n20_7d.csv`, `data/n21_7d.csv` (26 Oct - 1 Nov 2026 window). Median local time and row counts:

| Satellite and mode | Rows | Median local time (h) | 10th-90th percentile |
|---|---|---|---|
| Aqua day | 38,757 | 15.74 | 15.24-16.09 |
| Aqua night | 3,163 | 3.79 | 3.33-4.25 |
| Terra day | 9,324 | 8.70 | 8.27-9.25 |
| Terra night | 12,517 | 20.58 | 20.14-20.97 |
| NOAA-20 day / night | 263,470 / 89,080 | 13.51 / 1.53 | 12.82-14.22 / 0.91-2.35 |
| NOAA-21 day / night | 263,472 / 86,079 | 13.42 / 1.43 | 12.69-14.06 / 0.75-2.25 |

Reading these numbers:
- The values match NASA's drift statements [S] (Aqua afternoon near 15.7 h; Terra morning near 8.7 h), so the diagnostic is sensible.
- Aqua day / Terra day is 4.2x in raw pixel rows; Terra night / Aqua night is 4.0x; Aqua and Terra combined day plus night is
  41,920 / 21,841 = 1.9x, which is the same size as the 2.0-2.3x Aqua/Terra ratio in `README.md` for 0.05 degree cell sums. The
  Aqua day pass sits near the afternoon activity maximum, and the Terra day pass is in the morning before it; the night order
  reverses the way a diurnal cycle would suggest.
- **This does not prove overpass time is the cause.** Other candidates: smoke and cloud at different local times, sun-glint rejection
  in the morning, pixel size and bow-tie differences, instrument calibration differences, and NRT versus standard processing. A
  proper test needs a diurnal curve from geostationary FRP (GOES, Himawari or SEVIRI) held out from the fit, and pairing detections
  by local time. Treat it as the strongest lead, not a finding.
- The NOAA-20 and NOAA-21 overpasses (about 13.5 h) are close to each other and to the old Aqua slot, so VIIRS-versus-Aqua gaps change
  with Aqua's drift. A MODIS-VIIRS comparison from one year is not comparable with one from another year without a time-of-day term.
  That is a defect in any long record, and it is the proper subject for "one fire record".

Benchmark code and the local-time script are in the session scratchpad, not in the repo. To reproduce, re-implement from the
descriptions above (about 20 lines each).

## 7. Citation and claim verification log

Verified against full text or structured data this session [V]:
- Giglio, Schroeder, Justice 2016, RSE 178:31-41 (C6 MODIS algorithm; Eqs. 1-6; inputs; window up to 21 x 21; MOD03 land mask).
- Schroeder et al. 2014, RSE 143:85-96 (I4 367 K, I5 380 K, M13 634 K, aggregation zones, bow-tie deletion, contextual tests, windows, I4 saturation scenarios, "prevented direct application of the original MODIS detection tests").
- VIIRS C2 375 m Active Fire User Guide v1.2 (June 2025): C2 uses L1B radiance and geolocation; FP_ arrays; FRP from M13 shared across 375 m pixels; 375 m product is "more sensitive" and VNP14 750 m is "more comparable to MYD14".
- Giglio, LANCE UWG May 2025, Terra/Aqua orbit-drift slides (text extracted; slides are sparse).
- NASA CMR granule metadata (sizes, versions, URLs) on 2026-11-02; LAADS download-script page (token authentication).
- Abstracts: arXiv 1808.03318 (Haley et al.), arXiv 2603.08824 (SoftJAX), arXiv 2605.06273 (Rötzer et al.).

Seen only in search snippets or summarising tools [S]; confirm before quoting:
- All of: HotLINK, FireCNN, Kumar 2019, Mandel 2014, Schroeder 2016 Landsat-8, Andela 2015 / Freeborn 2011 / Zheng 2021, Gupta 2021, Liu & Hauskrecht 2021, Koshkina 2017 and thinned LGCP work, Chen 2021 / Auto-STPP details and license, EasyTPP model list, constellation and scheduling papers, compressive-sensing payload paper.
- Phi-Sat-1 / CloudScout numbers (92 % accuracy, 1 % false positives). Venue is Remote Sensing 12(14):2205, not IEEE JSTARS.
- OroraTech latency claims and FOREST-2 specs; FireSat launch dates and plans; FUEGO status.
- Terra/Aqua mean local time projections (the Terra page body mixes old predictions with a 2 Nov 2026 update stamp).
- MODIS band 22 saturation (about 331 K vs about 335 K in different sources); band 21 about 500 K.

Not found or not verified [U]:
- Any published differentiable or soft-threshold contextual fire detector on radiances.
- Any joint MODIS-plus-VIIRS L1B detector for harmonization.
- Whether MOD14/MYD14 treat MODIS bow-tie duplicate pixels specially.
- Whether FIRMS serves VNP14 (750 m); whether LP DAAC downloads need the same token as LAADS.
- Whether MODIS Collection 7 fire products have been released. LAADS lists a V7 L1B collection, while MOD14/MYD14 are still V061 in CMR. A 2024 NASA slide called Collection 7 fire "likely optimistic" for 2024-2025 [S]. Use 6.1 L1B for fidelity to the current fire product [U].
- FireSat 5 m and 20 m resolution numbers; unit of CMR `granule_size` for most products.
- The 0.5 TB/day and 25-year volume figures are my extrapolations from two or three sampled granules per product.

## 8. Suggested order of work (if the team accepts this ranking)

1. Day 1-2: add local solar time and a time-of-day term to every sensor comparison; re-run the Aqua/Terra and NOAA-20/Aqua ratios in
   matched local-time windows; report as a diagnostic with the caveats of section 6.
2. Day 2-3: pull one or two days of VNP14 (750 m) and MYD14 for a few regions; compare counts and FRP at matched time.
3. Day 3-7: write the thinned-likelihood observation model with a simulation-recovery test; fit on FIRMS pixel area, view angle, day/night and local time.
4. Only if time remains: the L1B degradation experiment on about 10 granule pairs.
5. Keep hardware and sampling theory to a design slide; say plainly that those parts are simulated or theoretical.
