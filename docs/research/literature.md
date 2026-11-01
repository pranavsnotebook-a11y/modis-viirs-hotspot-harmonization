# Literature: harmonizing MODIS and VIIRS active fire detections

Verification legend: [V] = read in a fetched source or search-extracted source text (URL given); [S] = only seen in a search-result snippet / secondary summary; [U] = uncertain or internally inconsistent in source.
Not found / not verified: FireCCI-specific VIIRS merging; GFED-specific MODIS/VIIRS FRP harmonization; Wooster et al. 2021 RSE content; Schroeder 2014 full text (PDF fetch returned only a logo asset).

## 1. Product basics (FIRMS)
- MODIS: 1 km pixels at nadir, growing toward the scan edge; VIIRS I-band: ~375 m at nadir; scan/track fields give actual pixel size. FRP is pixel-integrated, MW, in both. [V] https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs
- MODIS confidence is 0-100 %, binned to low/nominal/high. VIIRS confidence is categorical only (l/n/h): low = daytime sun-glint-affected and/or I4 anomaly <15 K; nominal = no sun glint, anomaly >15 K; high = saturated pixels (day or night). [V] same URL
- Consequence for harmonization: there is no shared numeric confidence. Map MODIS 0-100 to classes using FIRMS bins (MODIS: low <30, nominal 30-80, high >80 is the commonly used bin; I did not verify the cutoffs on the page, [U]) and treat VIIRS "low" as daytime-only.
- Night low-confidence VIIRS detections: NASA docs say they occur only over a limited region (~SAA area); a community catalog says they were removed from NRT. [S] An Oct 2025 arXiv preprint (single independent author, not peer reviewed) reports 0 night low-confidence of 21.5 M VIIRS detections (Jan 2023-Jan 2024) and infers a ~295 K cutoff; its statistics are weak, treat as a hypothesis. [V] https://arxiv.org/html/2510.26816v1 . Practical: do not expect night low-confidence VIIRS pixels.

## 2. Detection limits and pixel-size effects
Sofiev & Kouznetsov 2026, GMD 19, 10123, "Observation operator and detection limits for MODIS and VIIRS FRP products". https://gmd.copernicus.org/articles/19/10123/2026/ [V]
- Detection limit approximated as a linear function of pixel area.
- MODIS C6.1, smallest (~1 km^2, mid-swath) pixels: ~3.7 MW night, ~5.7 MW day. Largest swath-edge pixels: ~39 MW night, ~42 MW day.
- VIIRS smallest pixels: ~0.7 MW night, ~3.7 MW day (abstract says 0.5 MW night; body says 0.7: [U]).
- Global-average probability of detecting "powerful" fires: 78 % MODIS, 88 % VIIRS. Equatorial areas: below 30 % MODIS, below 40 % VIIRS.
- Omission error 20-40 % in fire-prone regions, VIIRS 10-20 points lower than MODIS; equatorial >60 % MODIS, ~40 % VIIRS.
Sperling, Wooster, Malamud 2020, Fire 3(2):11: MODIS detection limit ~5-8 MW, undercounting pixels with FRP <~10 MW; limit rises off nadir; VIIRS 375 m FRP totals many times MODIS in eastern China agricultural areas. [S, PDF unreadable by fetch] https://mdpi-res.com/d_attachment/fire/fire-03-00011/article_deploy/fire-03-00011.pdf
Schroeder et al. 2014, RSE 143:85-96 (VIIRS 375 m algorithm): commission error <1.2 % for nominal-confidence pixels; ~3x more fire pixels by day and ~25x at night vs the 750 m VIIRS baseline product; saturation and the South Atlantic Anomaly affect the mid-IR data. [S: abstract via search] https://earthdata.nasa.gov/s3fs-public/imported/Schroeder_et_al_2014b_RSE.pdf (full text not parsed)

## 3. FRP differences between sensors
Li, Zhang, Kondragunta et al. 2018, JGR-Atmos 123(9):4545-4563, "Comparison of FRP estimates from VIIRS and MODIS observations". [V via NOAA repository summary] https://repository.library.noaa.gov/view/noaa/49896
- Matched fire clusters: MODIS and VIIRS FRP closely agree, except large boreal fires where VIIRS FRP is ~47 % smaller.
- Continental scale: strongly correlated, VIIRS slightly higher, gap varies by season.
- Global 1 deg grids: mean difference ~20 % in fire-prone regions, much more variable in fire-limited regions.
- VIIRS FRP is roughly constant across the swath; MODIS depends strongly on view zenith angle (FRP per pixel rises toward the scan edge).
Li, Zhang, Kondragunta 2020, Remote Sens 12(10):1561, Africa: MODIS misses low-intensity fires; daily MODIS FRP underestimated by >=42.8 % vs VIIRS 375 m (abstract on NASA MODIS page; the author of that search could not find it in the full text, [U]); swath-gap effect ~12.5 % of monthly summed FRP; empirical adjustment models for 0.05-0.5 deg grids; underestimate depends on grid size and view angle. [S] https://www.mdpi.com/2072-4292/12/10/1561 (403 on direct fetch) ; https://repository.library.noaa.gov/view/noaa/42501
Vadrevu & Lasko 2018, Remote Sens 10(8):1223? (PMC6108185), Punjab, India. [V] https://pmc.ncbi.nlm.nih.gov/articles/PMC6108185/
- VIIRS fire counts ~4.8x MODIS Aqua+Terra (87,702 vs 18,270 per yr) and ~6.5x Aqua alone (13,489).
- Mean monthly FRP per detection: MODIS Aqua 16.10 MW vs VIIRS 5.25 MW.
- Summed FRP: VIIRS ~622,420 MW vs MODIS ~276,000 MW (~2.25x; abstract says 2.5x, [U]).
- Monthly MODIS vs VIIRS FRP correlation r^2 = 0.98.
- Mechanism: VIIRS adds many small fires (more counts, lower mean FRP, higher total).
Northeast Asia, Remote Sens 12(18):2870: of VIIRS fire pixels, 65 % (forest) and 83 % (low-biomass land) missed by MODIS; of MODIS pixels, 35 % and 53 % missed by VIIRS; monthly MODIS FRP lower than VIIRS overall, but for co-detected fires VIIRS total FRP is lower. [S] https://www.mdpi.com/2072-4292/12/18/2870 (403 on fetch)

## 4. Merging / harmonization methods in existing systems
- GFAS (ECMWF/CAMS): VIIRS-merged analysis bias-constrained to MODIS-only; daytime factor 1.23, night 0.46 (day overestimate attributed to sampling-time effect). [S: slides] https://atmosphere.copernicus.eu/sites/default/files/2018-11/5_181016_CAMSGA_CAMS44_Kaiser.pdf (fetch exceeded size limit)
- Zhang, Wooster & Xu 2017: combined VIIRS I-band (375 m) and M-band (750 m) so that detections come from I-band and FRP from M-band (avoids I4 saturation). [S]
- Kaur et al. 2019: quantile-mapping to correct negative bias in gridded FRP (>=1 deg). [S]
- Li et al. 2020: grid-size and view-angle dependent empirical adjustment of MODIS grid FRP to a VIIRS-375 equivalent. [S]
- GFED5 near-real-time component reportedly VIIRS-based, calibrated to VNP14IMGML 375 m; burned area calibrated to 30 m Landsat/Sentinel. [S, community slides, not located directly]
- Sofiev & Kouznetsov 2026: pixel-level observation operator with cross-mapping of MODIS and VIIRS at granule level. [V]
- Duplicate detections across sensors must be removed before comparing/summing (Remote Sens 12(10):1561 context). [S]

## 5. Implications for our pipeline (derived, not from a single source)
1. Do not sum raw MODIS and VIIRS FRP; per-detection FRP is not comparable (MODIS mean 3x VIIRS in Punjab case) while totals are VIIRS-heavy.
2. Treat sensors as different detection thresholds: normalize via detection-limit-aware model (area-linear threshold) or harmonize to the VIIRS 375 m level.
3. Use pixel size (scan x track) to compute per-pixel area and view-angle weighting; down-weight/flag MODIS off-nadir pixels.
4. Map confidence to common 3 classes; drop VIIRS low confidence (day sun glint) for high-precision use.
5. Spatio-temporal dedupe (a MODIS 1 km pixel contains ~7 VIIRS pixels) before aggregation.
6. Any day/night scaling (GFAS 1.23 / 0.46) is regional and product-version specific; recalibrate on our own collocated data.
