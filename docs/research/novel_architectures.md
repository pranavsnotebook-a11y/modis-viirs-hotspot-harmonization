# Novel architectures for a sensor-independent MODIS/VIIRS fire record

Written 2026-11-02. Scope: literature survey, an attack on the team's candidate design, and three designs.
Nothing in `src/`, `data/`, README or SUMMARY was edited. Two small diagnostics were run on `data/*_7d.csv`
(scripts in the session scratchpad, read-only on the repo); their numbers are in section 1.

**Verification legend.**
[F] = I fetched the page this session and a summarizer returned the stated content (abstract or body; not a verbatim read of a PDF).
[S] = seen only in a search-result snippet or secondary summary; treat as unverified detail.
[M] = from my memory, not checked this session.
Every citation below carries one of these. Titles/authors given only as snippets may be slightly off.
Search coverage: about 40 web searches/fetches. No exhaustive Scholar/Semantic Scholar/IGARSS/non-English sweep.
**Absence of a hit is weak evidence of absence**; novelty claims in section 5 are graded accordingly.

---

## 1. What the data already say (new, measured today)

### 1a. Terra and Aqua do not fly at the same time of day any more

Local solar time (UTC acquisition time + lon/15 h) of every FIRMS detection, 26 Oct-1 Nov 2026, global.
Computed from `data/modis_7d.csv`, `n20_7d.csv`, `n21_7d.csv`.

| pass | pixels | median local solar time (5-95%) | summed FRP (MW) |
|---|---|---|---|
| Terra day | 8,625 | **08:40** (08:10-09:26) | 235,316 |
| Terra "night" | 12,401 | **20:34** (20:00-21:05) | 309,755 |
| Aqua day | 37,761 | **15:44** (15:03-16:11) | 1,126,498 |
| Aqua night | 2,773 | **03:45** (03:08-04:23) | 68,160 |
| NOAA-20 day | 256,908 | 13:31 (12:40-14:23) | 2,595,602 |
| NOAA-20 night | 85,483 | 01:32 | 232,779 |
| NOAA-21 day | 255,724 | 13:25 | 3,048,496 |
| NOAA-21 night | 80,582 | 01:25 | 260,864 |

Consistent with NASA's drift projections: Terra reaching ~09:00 around Dec 2025 and Aqua ~15:50 in 2026 [F: https://nsidc.org/ru/node/51980;
that page is an older plan that said both missions end then; both are still reporting in the data].
Giglio's May 2025 LANCE briefing lists diurnal sampling as an affected quantity and says the effect on fire products is still under study [S].

Consequences for the README's open question ("two identical MODIS instruments differ by ~2x, cause not established; overpass time untested"):

* Overpass time is no longer a candidate; the two satellites sample different halves of the fire day (Terra 08:40 / 20:34, Aqua 15:44 / 03:45).
* The pooled Aqua/Terra pixel ratio is 40,534 / 21,026 = **1.93**, which matches the reported 2.0-2.3. But it is a sum of two opposite effects:
  by pass, Aqua/Terra is **4.4x by day** and **0.22x at night** (Terra's evening pass out-detects Aqua's pre-dawn pass 4.5x).
  A "2x at every floor" number pooled over day and night hides a diurnal effect that is roughly 4x in each direction.
* This is a strong hint, **not proof**, that the Aqua/Terra gap is diurnal (Terra morning cloud/sun angle and different scan-geometry mix are not excluded).

### 1b. Cell-day overlap between sensors (0.1 deg cell, day passes, this week)

"both" = cell-days where both satellites have at least one detection.

| pair | both | only first | only second | median log10 ratio of summed FRP (both) |
|---|---|---|---|---|
| NOAA-20 / NOAA-21 (same instrument, median dt 40 min) | 43,493 | 44,933 | 45,320 | -0.08 (x0.84), IQR -0.39..+0.24 |
| NOAA-20 / Aqua (13:31 vs 15:44) | 10,996 | 77,430 | 10,406 | +0.02 |
| Aqua / Terra (15:44 vs 08:40) | 911 | 20,491 | 4,490 | +0.16 |
| NOAA-20 / NOAA-21, night | 16,176 | 13,546 | 12,706 | -0.08 |

Read-offs, with caveats:

* Two *identical* VIIRS instruments 40 minutes apart see the same cell-day only 49% of the time (43,493 / 88,813). A Lincoln-Petersen estimate gives
  N_hat = 88,426 x 88,813 / 43,493 = 180.6k active cell-days vs 133.7k observed in the union, i.e. per-overpass "detection" of about 0.49 at this grain.
  That is a **noise ceiling for any cell-day-level harmonization**: fire changes in 40 min, overpass swaths differ, detection is stochastic, and the independence/closure
  assumptions are violated (heterogeneity biases Lincoln-Petersen low; Link 2003 [S]).
* NOAA-20 recovers 51% of Aqua's cell-days (10,996 / 21,402); NOAA-21 recovers 49% of NOAA-20's. The similarity suggests that part of the "VIIRS sees more" gap
  at fixed phase is not sensor sensitivity but how repeatable a cell-day is. This is a hypothesis for the first experiment, not a finding.
* Aqua and Terra share only 4% of cell-days. Capture-recapture across different phases is invalid because the closure assumption fails: a fire that is not yet burning at 08:40
  cannot be "recaptured". The diurnal cycle changes **occupancy** (is anything burning), not just FRP scale.

---

## 2. Literature: what exists, what does not

### 2.1 MODIS/VIIRS FRP differences and existing harmonization (fire-specific)

| Item | What it does | Status |
|---|---|---|
| Sofiev & Kouznetsov 2026, GMD 19, 10123, "Observation operator and detection limits for MODIS and VIIRS FRP products" https://gmd.copernicus.org/articles/19/10123/2026/ | Analytical operators mapping model FRP to what MODIS/VIIRS would report. Pixel level: observed = predicted x logistic detection factor with midpoint D_p linear in pixel area (D_p = lambda A_p + mu), slope r_p hyperbolic in A_p, day/night coefficients; grid level with valid-pixel fraction penalty; thin-cloud attenuation exp(-tau_4). Cross-maps MODIS<->VIIRS at pixel level; total FRP falls 128/177 TW to 88/106 TW after the operator; residual ~23% gap attributed mainly to later Aqua overpass; ad hoc ~1.2 diurnal factor from SEVIRI (range 0-50%). Not learned, no latent field, no pixel splitting, diurnal not modelled. Authors name "assimilate with this operator" as next step. | [F] **This is the nearest prior art to the team's candidate. Detection-curve-by-pixel-area is NOT new.** |
| Li, Zhang, Kondragunta et al. 2018 JGR-A 123:4545; Li et al. 2020 Remote Sens 12:1561; Vadrevu & Lasko 2018; Sperling et al. 2020; Xu & Wooster et al. SLSTR 2020/2021/2023 | Empirical MODIS-VIIRS(-SLSTR) FRP comparisons, view-angle dependence, grid-size dependent adjustments | [S]/[F] as in `literature.md`; SLSTR lower detection limit (more pixels <5 MW) [S] |
| 2026 Remote Sens 18(10):1650 (doi 10.3390/rs18101650): correction-then-fusion of MYD14 and VNP14IMG, 2012-2024, VZA-corrected, daily FRP at MODIS footprint | Empirical viewing-geometry correction + fusion; no deep learning | [S] (authors not read) |
| Remy & Kaiser 2014, ACP 14:13377, "Daily global FRP fields estimation from one or two MODIS instruments" | Corrects the sampling bias when only Terra or only Aqua is available (different overpass times sample different parts of the diurnal cycle); >95% bias reduction | [F abstract] **Existing diurnal-time-bias correction; non-learned.** |
| Andela et al. 2015, ACP 15:8831 | Diurnal-cycle climatology + MODIS detections improves FRE vs ignoring it; SEVIRI as reference | [F abstract] |
| Li, Zhang, Kondragunta, Lu, Csiszar, Schmidt 2022, RSE 281:113237, hourly 3 km emissions from blended ABI + VIIRS 375 m; 5-min FRP diurnal cycle reconstructed with land-cover/ecoregion climatologies; ABI calibrated against VIIRS at 3 km | Operational RAVE | [F abstract: https://repository.library.noaa.gov/view/noaa/67902] **Existing geostationary-polar fusion with learned-from-data diurnal climatology (non-neural).** |
| GFAS day/night factors 1.23 / 0.46 (Kaiser slides) | Regional constants | [S] via `literature.md` |
| Mota, Gobron, Wooster EGU2020 abstract | Frequency-density distributions of FRP per 0.5 deg cell used to estimate each product's minimum detectable FRP | [S] (the FRP analogue of seismology's frequency-magnitude completeness, section 2.3) |
| Haley, Farguell Caus, Kochanski, Schranz, Mandel, arXiv 1808.03318, "Data likelihood of active fires satellite detection..." | Likelihood of the detection outcome given a fire-spread model state: logistic detection regression + Gaussian geolocation error; demonstrated on ignition-point estimation with MODIS and VIIRS | [F abstract] **Detection-likelihood-of-hotspots prior art; fire-spread (PDE) latent, not statistical intensity, not cross-sensor harmonization.** Related Mandel et al. arXiv 1410.6948, 1804.03995 [S titles only] |
| Giglio/Roy/Randerson 2022 (MODIS science team slides); Giglio LANCE UWG May 2025 | Drift impacts; Terra drift as an opportunity (cross-calibration, new local times) | [S]; PDFs unreadable by the fetch tool |

### 2.2 Deep learning on active-fire products

* Landsat-8 active-fire segmentation with U-Nets (dataset paper arXiv 2101.03409; "operational U-Nets" 2304.09721; label-noise study DAFDM, IEEE JSTARS 2025) [S].
* GOES-17 coarse imagery -> VIIRS-resolution fire boundaries, autoencoder (Badhan et al., Remote Sens 2024) [S]; FRP imagery prediction with fused polar+geostationary data (Dong et al., IEEE JSTARS 2024) [S]; GNN medium-range FRP forecast, arXiv 2610.11022 [S, unread].
* Self-supervised hotspot detection from time series (Barco et al., arXiv 2405.20093) [S]. Vision-transformer fire characterisation arXiv 2504.13776 [S].
* **Not found** in my searches: deep learning that harmonizes or translates MODIS FRP <-> VIIRS FRP; deep downscaling of MODIS fire detections to VIIRS grain; any model with explicit sensor operators for fire pixels; any held-out-satellite protocol (leave-one-sensor-out) for fire detections.
  A leave-one-sensor-out search returned only cross-sensor agreement checks (e.g. validating an on-board detector against VIIRS 375 m, arXiv 2605.06273 [S]) and ASTER-referenced detection-rate studies (Csiszar/Morisette/Giglio 2006; Schroeder et al. 2008) [S].

### 2.3 Point processes, detection-corrected models, ecological and seismological analogues

* **Neural point processes.** Neural Hawkes (Mei & Eisner 2017, arXiv 1612.09328 [S]); Neural Spatio-Temporal Point Processes with Jump/Attentive CNFs (Chen, Amos, Nickel, ICLR 2021, arXiv 2011.04583 [S, abstract level]).
  Imputing missing events with a neural Hawkes model and particle smoothing, valid under MNAR missingness if the missingness mechanism is *known* (Mei, Qin, Eisner, ICML 2019, arXiv 1905.05570 [S]). **Gap:** missingness is assumed known/fixed there, not a learned sensor operator shared across sources.
* **Cox/LGCP.** Log-Gaussian Cox processes for fire scars/ignitions (Pereira & Turkman; Opitz, Bonneu, Gabriel; [S] via search summary); LGCP networks for several correlated point datasets (Aglietti et al., AISTATS 2019 [S]);
  Bayesian zero-inflated areal counts of satellite wildfire counts (Italy, 2026 [S]); Poisson/Hawkes models of Sicilian fires that account for "burstwise, irregular overpass times" (Rost, Gothenburg PhD seminar abstract [F]; sensors not named).
  Marked Hawkes with multi-modal covariates and conformal magnitude intervals for wildfire (Xu et al., arXiv 2207.13250 [S]); Hawkes with spatial coarsening for Alaska wildfire (Holbrook, Ji, Suchard, arXiv 2010.02994 [S]).
  **None of these models the sensor as a thinning operator on hotspot data.**
* **Thinned/fused point patterns.** Two sensors as independent thinnings of one latent pattern, P(either) = 1-(1-p1)(1-p2) (Schliep, Gelfand, et al., arXiv 2310.08397, "Assessing marine mammal abundance: a novel data fusion") [F abstract; the identifiability section was not readable];
  displacement + imperfect detection of spatial point processes with identifiability theory (Collins, Schliep, Gelfand, et al., arXiv 2606.05374, June 2026) [F HTML]: lambda and p are identified if log p and log lambda are linearly independent a.e.; only one log intercept is identified so p_0 must be fixed; no multi-source or mark-dependent detection; ghost points excluded.
  **Ecological data fusion is mature; the identifiability condition is functional-form separation, and absolute scale needs an anchor.**
* **Integrated SDMs / presence-only.** Fithian et al. 2015 (arXiv 1403.7274 [S]), Koshkina et al. 2017 (MEE, presence-background + site-occupancy with imperfect detection [S]), Hastie & Fithian 2013 (Ecography; presence-only data support only *relative* intensity [S]),
  preferential sampling (Diggle, Menezes, Su 2010 JRSS-C [S]).
* **Occupancy / N-mixture / capture-recapture.** MacKenzie 2002 and Royle 2004 [S, texts not read]; Barker, Schofield, Link, Sauer 2018 Biometrics: N-mixture abundance may be non-identifiable, reliable inference is mostly for *relative* abundance [S];
  Link 2003: with unobserved heterogeneous detection, N is not identifiable without untestable assumptions; Holzmann-Munk-Zucchini 2006 give partial qualifications [S]. **No application of capture-recapture to satellite fire detections found** (one search).
* **Seismology (closest structural analogue, and I had not expected it).** Catalog incompleteness with a detection probability dependent on magnitude (and rate), estimated jointly with a Hawkes (ETAS) model: Mizrahi, Nandan, Wiemer 2021, JGR Solid Earth / arXiv 2105.00888 [S];
  probability-based completeness from network properties (Schorlemmer & Woessner 2008, BSSA 98:2103 [S]). Mapping: magnitude <-> FRP, Gutenberg-Richter frequency-magnitude law <-> FRP frequency distribution (unverified for fire, [M]/[U]; Mota et al. use FRP frequency-density [S]),
  network completeness <-> sensor detection limit, **short-term aftershock incompleteness (small events hidden by big ones) <-> smoke/saturation/pixel-sharing near large fires.**
  So "detection curve + shared latent point process" is **not novel conceptually** and has a decade-old counterpart; what fire adds is footprint integration, phase, and orbital physics.

### 2.4 Differentiable observation operators, data assimilation, inverse problems

* Learned inverse observation operator for variational DA (Frerix et al., arXiv 2102.11192 [S]); NN emulators of radiative-transfer operators for microwave radiances, ATMS, SMAP/AMSR2 [S];
  a neural-field retrieval through a differentiable radiative-transfer operator for GOES ABI (ECMWF poster, Tremblay) [S, publication status unknown].
* Joint estimation of unknown sensor geometry and image with neural fields (Gupta et al., "Differentiable uncalibrated imaging", IEEE TCI 2024 [S]); differentiable calibration for NLOS imaging (arXiv 2105.10603 [S]).
* Amortized posterior estimation in retrieval: QRNN for MODIS cloud-top pressure (Pfreundschuh et al., AMT 11:4627, 2018 [S]); neural posterior estimation for exoplanet retrieval (Vasist et al. 2023 [S]).
* **Not found:** a differentiable footprint/leakage/threshold operator for *discrete hotspot detections* with a shared latent; neural SBI for multi-satellite fire records.

### 2.5 Sets, neural operators, EO foundation models

Perceiver IO-style cross-attention for sparse sensor sets (Senseiver, NeurIPS 2022 / Nat. Mach. Intell. 2023 [S]); deep-set operators (VIDON, UQ-SONet; arXiv 2509.25646 [S]); set-based and query-based transformers for irregular satellite image time series (ALISE etc. [S]; the paper lists multi-sensor integration as future work);
EarthNet-style masked autoencoder that fills missing data from other sensors incl. geostationary [S]; HLS-GPT (arXiv 2606.18115 [S]); MODIS -> VIIRS LAI with domain adaptation (transfer component analysis + GRNN, Remote Sens 14:1826 [S]).
**Not found:** swath-level set models whose decoders are physical point-process operators; sensor-masked training for hotspots.

### 2.6 Identifiable sensor-invariant latents

Multi-view nonlinear ICA lineage (Gresele 2019; Locatello 2020; Lyu & Fu 2020 [S, named in snippets]); Daunhawer et al. ICLR 2023 (arXiv 2303.09166): shared factors identified up to block-wise indeterminacy with per-modality mixing and modality-specific latents [S];
Yao et al. ICLR 2024: information shared across *any subset* of views recoverable up to a smooth bijection, one encoder per view [S].
These results assume injective mixing and contrastive training; they do not cover thresholded (non-injective, censored) point-pattern observations. **Gap: no identifiability theory for latent recovery under censoring operators; I could not close this and do not claim to.**

### 2.7 Conformal / uncertainty

Intensity intervals for spatial point processes with finite-sample coverage (Osama, Zachariah, Stoica, NeurIPS 2019, arXiv 2007.01592 [S]); conformal joint regions for neural marked TPPs (arXiv 2401.04612 [S]);
weighted conformal under covariate shift (Tibshirani, Barber, Candes, Ramdas, NeurIPS 2019, arXiv 1904.06019 [S]); spatial-event conformal on manifolds (arXiv 2607.10008 [S]).
**Key limitation for our problem (my reasoning):** weighted conformal needs the target covariate distribution to be absolutely continuous w.r.t. the source. Sensors occupy a *handful of discrete overpass phases*, so a held-out sensor (Terra at 08:40) has **no overlap** with the training phases; the density ratio does not exist and the guarantee does not apply. Calibration must be checked empirically (leave-sensor-out coverage), not asserted.

### 2.8 Diurnal cycle / geostationary

Sampling bias from overpass time (Remy & Kaiser 2014 [F]); diurnal climatology + MODIS (Andela 2015 [F]); ABI + VIIRS blending with ecoregion diurnal climatology (Li 2022 [F]); Himawari-8 + VIIRS diurnal cycles (Zheng et al., Remote Sens 2021 [S, secondary mention]);
geostationary misses small fires (<30 MW) and regional totals can be bias-corrected with polar imagers [S]; NOAA/UCAR proposal to fit per-pixel FRP curves from GOES-R with RF/NN [S, abstract-level]; fixed one-curve diurnal profiles in HRRR-Smoke [S].
Drift of Terra/Aqua opens "new" local times for fire science (Giglio et al. 2022 [S]).
**Not found:** a diurnal cycle *learned jointly with sensor detection operators* from polar-orbiter pixels alone, using the drifting local times as the identifying variation. FIRMS' own distribution of GOES hotspots was not confirmed (search inconclusive); GOES ABI FDC fire products exist on Earth Engine [S].

---

## 3. Attack on the candidate

Candidate: true fire activity = latent spatio-temporal intensity with learned diurnal cycle; each satellite = differentiable thinning operator (overpass time, pixel area, scan angle, detection curve, pixel splitting); train end-to-end so one latent explains all records.

1. **Prior art covers the framing.** Shared-latent + per-source thinning is standard in ecological data fusion (Koshkina, Fithian, Schliep). Area-linear logistic detection with day/night coefficients and MODIS<->VIIRS cross-mapping is Sofiev & Kouznetsov 2026. Diurnal climatology fusion is Li 2022 / Andela 2015 / Remy & Kaiser 2014.
   Novelty must live in what is *not* in those: footprint/splitting physics, joint learning, phase as identifying variation, held-out-sensor objective.
2. **"Thinning an intensity" is the wrong object.** Unmarked thinning gives only the product p*lambda (Collins 2026: needs log p, log lambda linearly independent; Hastie-Fithian: relative intensity only). Detection here depends on the *mark* (FRP vs area-scaled floor), so the correct operator is **mark-dependent censoring of a heavy-tailed mark distribution**, not a scalar p(s).
3. **Latent scale is a gauge, and the tail below the best sensor's floor is unobservable.** Every sensor's detection limit is above ~0.5-0.7 MW (VIIRS night) [F: Sofiev]. Fire power below that is never seen; any "total fire" estimate there is the prior. The harmonized estimand must be "power from sources above a_0", with a_0 reported, not "true fire activity".
4. **Diurnal shape and detection are confounded unless instruments repeat at different phases.** One sensor = one phase = one product g(tau_s) x detection. Separation needs (a) same instrument at different phases (Terra vs Aqua now: this week, 08:40/20:34 vs 15:44/03:45) and (b) different instruments at similar phases (NOAA-20/21 vs Aqua). That is a real identification strategy; the candidate did not state it. With pure power-law marks, a rate factor u(tau) and a power-scale factor g(tau) are also only jointly identified (u*g^alpha) (section 4.A.4).
5. **Zeros are not observed.** FIRMS lists detections only; absence of a pixel means no fire *or* no coverage *or* cloud/smoke *or* below threshold. Without swath/cloud exposure the likelihood is wrong. Needs orbit-derived coverage (the repo already uses a sun-synchronous heading approximation) and a cloud proxy; cloud is partly caused by the fire (smoke), a preferential-sampling feedback.
6. **Pixel splitting is not a scalar.** FIRMS gives pixel center and scan/track sizes only (no orientation; README), so sub-pixel position and exact overlap are unknown; splitting and detection threshold both reduce observed power, and are separable only through cluster-size statistics (pixels per fire). The earlier per-pixel-floor claim failed exactly here.
7. **Identical-instrument consistency is not guaranteed.** Terra and Aqua may differ in calibration, scan-mirror side, band saturation; the "twin" assumption (same detection operator) is an assumption, testable via NOAA-20/NOAA-21 (twins at the same phase) and via GOES ground truth.
8. **Evidence base is one week, one season.** Seasonal and regional dependence of g and detection is untested; any phase-identification claim built on one week is fragile, and I have already looked at the Terra totals (section 1), so a clean confirmatory test needs a *different* week.
9. **"End-to-end" with neural nets invites non-identifiability.** Free neural operators can absorb the diurnal effect into detection and vice versa. Structure (monotone, conserving, twin-tied) is the guardrail, not an optional extra.

What survives and is improved: Design A below. It keeps the shared latent and explicit sensor operators, replaces thinning by mark-censoring with a footprint-leakage kernel, uses twin-tying and phase contrast for identification, adds orbit-derived exposure, and states the estimand honestly.

---

## 4. Designs

Common notation. Cell c (0.1 deg), UTC day d, pass s (satellite, day or night leg), local solar time tau_s(c,d) (known), pixels p with area A_p (scan x track), view angle v_p (inverted from scan size), observed FRP y_p.
Cluster q = 8-connected group of same-pass pixels, power Y_q, pixel count n_q. Instrument family I(s) in {MODIS, VIIRS}; twins: Terra/Aqua, NOAA-20/NOAA-21(/S-NPP).

### Design A. C-Cox: a marked completeness Cox process with footprint-leakage kernels and twin-tied phase contrast

**Generative model.**

1. Cell-day activity: eta_{c,d} ~ GMRF/GP across (c,d); Lambda_{c,d} = exp(eta_{c,d}). (A-lite: free random effect with a spatial smoothness prior. A-full: neural field / ConvGRU over a region.)
2. Burning sources at local time tau form a Poisson process (given eta) on the power axis:
   Gamma_{c,d,tau}(dm) = Lambda_{c,d} * u(tau; z_c) * f_{alpha_c,kappa_c}(m / g(tau; z_c)) dm / g(tau; z_c)
   * u in (0,1]: fraction of the cell's peak-active sources burning at tau (occupancy cycle).
   * g > 0: power scale of a burning source at tau relative to its peak (power cycle); g(13.5 h) = 1 as gauge.
   * f: tempered Pareto, f(a) proportional to a^{-1-alpha} exp(-a/a_*) for a >= a_0. a_0 = reference floor (e.g. 1 MW) is a stated gauge; alpha_c, kappa_c = 1/a_* from a small net of z_c.
   * z_c: region embedding (lat/lon harmonics, month, land cover if available).
   * g, u: periodic, g = exp(sum_{k<=K} a_k cos(2 pi k tau/24 + phi_k)), u = sigmoid(same form, own coefficients); K = 1 for the first test, K = 2 only with extra phases.
3. Sensor operator for pass s: a source of power m at uniform sub-pixel offset omega in [0,1)^2 spreads over up to 4 pixels with weights W_k(omega; rho_s) (triangular/box response with width rho_s, sum_k W_k + loss_s = 1, loss_s >= 0 a learned leakage slot).
   Pixel k is detected with probability sigma_k = sigmoid((log(m W_k) - log D_s(A_k, v_k)) / r_s), D_s = lambda_s A_k + mu_s (Sofiev form as prior), r_s > 0.
   Observed cluster power Y = sum_k m W_k sigma_k (or its sampled version), pixel count n = sum_k sigma_k; source is observed iff at least one pixel is detected; FRP measurement noise log-normal(0, s_s^2).
   Define the **leakage-censoring kernel** K_s(Y | m) (density of Y on {observed}, defect mass = non-detection). Computed on a (omega 16x16) x (log m 64) quadrature grid; fully differentiable.
4. Observed clusters of pass s in cell-day (c,d) form, by the Poisson mapping theorem (Kingman), a Poisson process on Y with intensity measure
   iota_s(Y) = e_{s,c,d} * Lambda_{c,d} * u(tau_s) * integral f(a) K_s(Y | a g(tau_s)) da,
   with e_{s,c,d} in [0,1] the swath exposure fraction (orbit geometry).
5. Likelihood given eta (exact under "sources spatially separated, independent"): sum over passes and cell-days of [ sum_q log iota_s(Y_q) - integral iota_s(Y) dY ], plus log GMRF prior on eta. Empty cell-passes contribute -integral iota_s, which is why exposure e is needed.
   Without exposure: condition on N >= 1 in some pass (zero-truncated), losing the zeros.
6. Fit: MAP + Laplace for eta (10^5 parameters, sparse), L-BFGS/Adam for global parameters (lambda_s, mu_s, r_s, rho_s, loss_s per instrument family with twin-tying, g/u coefficients, alpha/kappa net). A-full replaces step 1 by an amortized neural field.

**Estimand / harmonized product.** The posterior of the observation a *virtual reference sensor* would report: (tau = 13:30, 375 m pixel, nadir, exposure 1) given all real sensors. Output cluster counts and FRP with posterior intervals, and a_0 stated. Historical "sensor" = (tau, A, v) covariates, not an id; Terra in 2005 (10:30) and 2026 (08:40) are the same operator at different tau. The 2000-2026 drift is a continuous phase sweep.

**A.4 Identifiability (honest).**
* Scale gauge: eta <-> a_0 <-> f amplitude. Fix a_0 and g(13.5) = 1. Identified: power from sources above the *largest* sensor-floor reachable by all passes in a cell, plus tail-model extrapolation below it (prior-driven).
* u vs g: with pure Pareto only u*g^alpha is identified (N(>x) = Lambda u g^alpha x^{-alpha}). The taper a_* gives a knee that shifts horizontally with g and vertically with u, so identifiable **if the knee is observable above the highest detection floor**. FRP above ~100 MW is abundant in 236k pixels/day, so plausible; verify with profile likelihood. Otherwise report only u*g^alpha and say so.
* Detection vs diurnal: with twin tying (Terra = Aqua operator; NOAA-20 = NOAA-21) the Terra/Aqua contrast at fixed operator identifies g,u at four MODIS phases (08:40, 15:44, 20:34, 03:45) without any detection assumption; NOAA-20/Aqua at nearby phases (13:31 vs 15:44, where g is flat near the peak) identifies the VIIRS/MODIS detection contrast. With K = 1 harmonic (3 params each for g, u) this is just-identified; richer g needs more phases (drift years, GOES, Himawari).
* Leakage vs threshold: separated only through cluster-size n_q statistics; mis-specified rho_s trades off against mu_s. Report profile likelihoods; test by injection with the wrong kernel.
* Heterogeneity (Link 2003): the tempered-Pareto family is an untestable parametric assumption. Mitigation: misspecification injections (lognormal-mixture truth), compare against nonparametric mark baseline.
* Preferential-sampling feedback (smoke obscuration grows with Lambda; Mizrahi et al. analogue): extension E1, pi_s -> pi_s * exp(-tau_4(Lambda)) with tau_4 a monotone function of cell activity; not identified without a cloud/AOD covariate.

**What is new at fine grain.** (i) The leakage-censoring kernel K_s as a differentiable layer that makes the per-pixel-floor mistake impossible by construction (floors apply to pixel-level power, aggregation to clusters, Poisson mapping gives exact likelihood). (ii) Twin-tied hierarchical operator bank (equality + shrinkage across Terra/Aqua and NOAA-20/21) *as the identification device for the diurnal operator* (a loss/parameterization-level idea, not a layer). (iii) Orbit-derived exposure in the Poisson compensator, making empty cell-passes informative. (iv) Sensors as covariates (tau, A, v), not ids, which allows zero-shot to a held-out sensor and to drift years. (v) Harmonized product defined as a virtual-reference-sensor predictive law with explicit a_0.

**Falsifiable experiments (free FIRMS).**
* E-A1 **Leave-Terra-out**: fit on Aqua + NOAA-20 + NOAA-21 (+ S-NPP if downloaded) only; predict Terra's day (08:40) and night (20:34) cluster counts and FRP sums per 0.1 deg cell-day and per 1 deg x week. Neither Terra phase is in the training set; both flank training phases (08:40 between 03:45 and 13:31; 20:34 between 15:44 and 01:32), so this tests **diurnal interpolation**, not free lunch: a 1-harmonic g is likely too symmetric. Pass: week-total Terra FRP within +/-25% for each pass, and held-out log-score and 90% interval coverage (target 85-95%) better than all baselines.
  The week I have already inspected cannot be a blind confirmation; freeze the spec first, then confirm on a different week (e.g. Aug 2026 NH, Feb 2026) from the FIRMS archive (free MAP_KEY / archive tool).
* E-A2 **Leave-Aqua-out** and **leave-NOAA-21-out** (twin test): predicting NOAA-21 from NOAA-20 should be near the Lincoln-Petersen ceiling of section 1b; if A beats this ceiling something is leaking, if it falls far short the operator is wrong.
* E-A3 **Injection-recovery**: simulate worlds with known (eta, g, u, alpha, kappa, operator parameters) using the *real* pixel centers/sizes/overpass times as frame; recover g(tau_Terra)/g(tau_Aqua) and detection midpoints; then repeat with wrong splitting kernel, non-Pareto marks, smoke feedback, and unknown exposure. Pass: ratio within 10% when well-specified, bias reported and bounded (target <25%) under each misspecification; failures are the finding.
* E-A4 **Independent ground truth**: validate learned g and u at 08:40 and 20:34 against GOES-R ABI FRP over CONUS/Americas (free; products listed on Earth Engine [S]; FIRMS GOES coverage unconfirmed) aggregated to the same cells.
* E-A5 **Drift sweep (needs archive)**: refit using Terra in 2018, 2022, 2026 as three phases of the same operator; predicted g must be one curve.

**Baselines it must beat.**
B0 no correction (Terra := Aqua; the 0.28 dex README bar for FRP); B1 constant per-pair ratio (GFAS-like, pooled over passes); B2 non-learned diurnal ratio (Remy-Kaiser/Andela-style regional climatology from the same data, no detection model); B3 gradient-boosted trees on other sensors' cell-day count/sum, tau difference, lat/lon, month, neighbour cells (strongest practical black box); B4 A without twin tying (shows tying is what identifies g); B5 A without the leakage kernel (per-pixel threshold).
Honest expectation: B3 may win on point accuracy in dense regions. A should win on calibration, on sparse/new regions, on injection recovery, and on structure (interpretable g, D_s).

**CPU feasibility.** The week has ~10^5 active cell-days per pass type (0.1 deg) and ~6 passes; quadrature tables are tiny; MAP+Laplace with sparse GMRF in PyTorch/scipy is minutes. A-full on a regional neural field (one continent, 0.25 deg) hours on an Apple laptop (my estimate, not measured). Orbit exposure via a sun-synchronous ground-track approximation (already in `hotspots.footprint`) or SGP4 (extra dependency, TLE access [M]).

**Novelty confidence: moderate-low.** Combination appears unpublished in my searches; components are not new (Sofiev operator, ecological thinning fusion, seismic completeness). I give about 40% that no equivalent combination exists; about 10% that the leakage-kernel + twin-tying identification trick by itself is unpublished (it is simple, and a statistician would call it "an instrument-by-phase fixed-effects design").

---

### Design B. COSA: Conserving-Operator Set Autoencoder (neural, amortized, sensor-masked)

Purpose: replace A's per-cell random effects and parametric operators by an amortized set encoder and *learned but structurally constrained* operators, so the model can scale to 2000-2026 and to regions with little data. Needs multi-year archive data to be worth it; do not start here.

**Architecture.**
* Tokens: each pixel -> (dx, dy, dt to window anchor, log y, log A, v, T_4-anomaly, T_11 or T_31-like brightness if present, confidence class, pass local time tau, instrument-family embedding). **No satellite id**: sensors enter only through covariates (tau, A, v, family), so the trunk is sensor-agnostic by construction.
* Encoder: Perceiver-style cross-attention from a latent array anchored on a 0.1 deg grid over a 1 deg x 3 day window; shared weights across passes; output q_phi(eta_{c,d}, alpha_c, kappa_c, g/u coefficients | pixels).
* Decoders = **ECMS layers** (Energy-Conserving Monotone Sensor layers), one per instrument family with per-pass offsets delta_s ~ N(0, t^2):
  * detection pi_s(m, A, v) = sigmoid(Mono_s(log m, log A, v)), network with non-negative weights so it is increasing in log m and decreasing in A; initialised at, and L2-regularised toward, Sofiev's logistic (physics-prior residual).
  * splitting weights W_k = (1 - loss_s) * softmax_k(...), explicit loss slot (cannot create power).
  * observed intensity via the same Poisson mapping likelihood as A (exact), integrals by quadrature.
* Objective (ELBO): sum_s E_q[log p(pixels_s | latents, ECMS_s)] - KL(q || GMRF/hierarchical prior) + physics-prior terms.
* **Sensor-masked training (loss-level novelty)**: with probability p drop a whole pass group from the encoder input and score it only through its decoder given latents from the rest. This trains exactly the held-out-satellite predictive law that the evaluation uses. The evaluation hold-out (Terra) is excluded from training entirely.

**Identifiability.** Multi-view results (Daunhawer 2023; Yao 2024) say shared content is recoverable up to a bijection/block under injective mixing and contrastive training [S]. Ours is generative with censored (non-injective) decoders, so those theorems do not apply. Remaining indeterminacy I expect: the gauge group {eta + c, a_0 rescale, (u, g) coupled shift}, a phase-shift of g if tau is not anchored, and the sensor-specific offset delta_s absorbing real signal if t is too large. Structural constraints (monotone, conservation, twin-tying, exposure) are what keep this from the generic non-identifiable VAE; this is a conjecture to test by injection-recovery, not a theorem.

**New at fine grain.** ECMS layer (monotone + conserving + physics-prior residual, as a drop-in decoder for hotspot sets); covariate-conditioned sensor-blind trunk; sensor-masked ELBO as the training objective. Closest existing: masked multi-sensor EO pretraining (EarthNet-style [S]), NN observation-operator emulators for radiances [S], Senseiver/Perceiver IO [S], point-process decoders (neural STPP [S]). The *combination with censoring operators for hotspots* was not found.

**Experiment.** Same leave-Terra-out/twin tests as A, plus: (i) region-hold-out (train on Africa+Asia, test Australia/Americas), where amortization should beat A-lite's per-cell fitting; (ii) multi-year: train 2023-2025 Aqua+NOAA-20/21, predict 2018 Terra (10:30) from covariates alone; (iii) ablations: no monotone constraint, no conservation, with sensor ids, no masking. A claim of "B > A" requires region/phase hold-outs, not in-distribution.
**Baselines.** A (parametric), B3, and B with a plain MLP decoder.
**CPU.** ~1-3 M parameters, token sets up to ~2k per window; PyTorch CPU/MPS on a laptop for a few regions and weeks in hours (estimate). Global multi-year training is not laptop-scale.
**Novelty confidence: low-moderate** (~30%). The risk is that it is "A plus amortization" with a weaker identification story.

---

### Design C. SnapSBI: simulation-based posterior for the virtual-reference sensor, with misspecification-robust calibration

Purpose: the safety net and the uncertainty engine. When the likelihood in A is mis-specified (merged sources, saturation, unknown bow-tie, smoke), a simulator can include all of it.

**Model.** A stochastic simulator S(theta, geometry): sample (eta, alpha, kappa, g, u, operator forms from an *ensemble*: logistic/probit/step detection, box/triangular response, random rho, saturation, merging, smoke attenuation, unknown exposure) -> sources with Monte Carlo sub-pixel positions -> pixel lists for the real pass geometry (real pixel centers/sizes/overpass times as frame) -> clusters.
Summary/inference network: set transformer over pixel sets + pass covariates -> conditional normalizing flow (or mixture density) q_psi(target | data), target = (cluster count, FRP sum) of the virtual reference sensor and optionally g(tau). Train by NPE on simulations.
Calibration: simulation-based calibration rank test on simulations [M: Talts et al. 2018]; then **leave-sensor-out empirical coverage on real data**, with a split-conformal recalibration step across *held-out sensor groups* (marginal only; see section 2.7: weighted conformal is unavailable because the held-out phase has no overlap).

**Identifiability.** Inherits A's, plus the simulator's. NPE does not create identifiability; non-identifiable directions show up as wide/ridged posteriors. Domain randomization over operator forms turns operator misspecification into posterior width.

**New at fine grain.** Misspecification-ensemble simulator with Monte Carlo splitting as the observation model; calibration protocol that treats a *held-out sensor* as the calibration unit. Existing: NPE/SBI in general; QRNN retrievals for MODIS [S]. **Application to multi-satellite fire pixels not found; the SBI machinery itself is standard, so novelty is low (~20%) and I would present it as a robust companion, not the headline.**

**Experiment.** Compare C's intervals with A's Laplace intervals and B3's quantile-GBM on leave-Terra-out and on injection worlds with wrong splitting/exposure; report coverage vs width. **Baselines:** A, B3 with quantile loss, and conformalized B3.
**CPU.** 10^5 vectorised numpy simulations of small windows in minutes; set-transformer + flow training on CPU in hours (estimate).

---

## 5. Comparison and recommendation

| | A: C-Cox | B: COSA | C: SnapSBI |
|---|---|---|---|
| Class | explicit marked Cox + operators | amortized neural + constrained operators | simulation-based amortized posterior |
| Core identification device | twin-tied phase contrast, mark censoring | same + learned operators (weaker) | inherits; shows non-identifiability as width |
| Works on one week of data | yes (A-lite) | no (needs archive/multi-region) | partly (simulator-driven) |
| Main risk | tail/kernel misspecification, mark family untestable | non-identifiable VAE-like drift, amortization gap | simulator-real gap |
| Novelty confidence | ~40% combination; components known | ~30% | ~20% |
| Strongest claim if it works | diurnal + detection separated from polar pixels alone | scales, generalizes across regions/years | calibrated uncertainty under misspecification |

**Recommendation: build A-lite first; use C as the calibration and stress test; build B only after the FIRMS archive (multi-year, multi-region) is in hand.**
The publishable core is probably **not the architecture** but the *identification result plus the held-out-satellite test*: "overpass phase and detection are separable from polar pixels because Terra and Aqua now sample different phases", validated against geostationary data. If the held-out test fails against B3, that is also a result.

## 6. First experiment (2-3 days, laptop)

**A0 = A reduced to a GLM.** Per 0.1 deg cell-day-pass, with swath exposure approximated or rows restricted to cells where at least one pass saw a detection (zero-truncated):
count ~ Poisson(e * exp(eta_{c,d} + log u(tau_s) + log pi_I(s)(mean A))), cluster-sum FRP | count ~ log-normal with mean shifted by log g(tau_s) + log leakage_I(s);
u, g 1-harmonic periodic; pi, leakage per instrument family **tied across twins**; eta_{c,d} as a random effect with 1 deg neighbour shrinkage.
1. Freeze the spec and success criteria in writing (above).
2. Fit on Aqua + NOAA-20 + NOAA-21 only. Predict Terra day and night. Score against B0-B3 with log-score, week/1 deg total error, 90% coverage.
3. Run the NOAA-21-from-NOAA-20 twin test and compare to the 0.49 Lincoln-Petersen ceiling.
4. Injection-recovery with the real geometry; then rerun on a different archive week for confirmation.
5. If g(08:40)/g(15:44) from the fit disagrees with GOES-R ABI by more than ~30%, the twin assumption or the exposure model is wrong, and the project learns which.
Decision rule: if A0 does not beat B1/B2 on held-out-Terra log-score, abandon the phase-contrast story; if it beats B1/B2 but loses to B3 only on point error while winning calibration, proceed to A with leakage kernels.

## 7. Unverified or weak items to resolve before citing

* Sofiev & Kouznetsov: details come from a fetch summarizer (equation numbers, 23% residual, 20% diurnal factor); the abstract's 0.5 MW vs body's 0.7 MW night VIIRS limit is flagged in `literature.md`. Read the PDF before quoting.
* Schliep et al. (arXiv 2310.08397) identifiability section not read; Collins et al. (arXiv 2606.05374) theorem paraphrased from a summarizer.
* Mizrahi et al. (2105.00888), Schorlemmer & Woessner 2008, Hastie & Fithian 2013, Barker et al. 2018, Link 2003, Royle 2004, MacKenzie 2002, Daunhawer 2023, Yao 2024, Tibshirani 2019, Osama 2019, Chen 2021, Mei 2017/2019: search-snippet level only.
* The 2026 arXiv/Remote Sensing items (2607.10008, 2610.11022, 2606.18115, 2605.06273, rs18101650) appeared in search results; not opened. Treat as possibly misdescribed.
* Terra/Aqua local-time schedule: NSIDC page is an old plan; the measured local times in section 1 are the better evidence. Giglio's 2025 slides could not be read.
* The FRP "Gutenberg-Richter" power-law assumption for fire marks is [M]/[U]; fit it before trusting it.
* The NOAA-20/NOAA-21 median offset of 40 min is measured; S-NPP's current phase was not measured (not in the 7-day files).
* FIRMS GOES hotspot distribution not confirmed; GOES ABI FDC on Earth Engine [S].
* "FRP = function of mid-IR brightness and area" for MODIS (Kaufman/Wooster) could give an extra physical consistency check between `brightness`, `bright_t31` and `frp`; [M], not verified.
* NRT (`6.1NRT`, `2.0NRT`) vs standard-processing differences were not checked; if the confirmation week comes from the archive it may be standard processing, adding a processing-version covariate.
