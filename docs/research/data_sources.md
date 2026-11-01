# Data sources and tooling for MODIS/VIIRS active-fire harmonization

Researched 2026-11-02. Every URL below was returned by a page fetch or search result in this session. Items marked **[UNVERIFIED]** come from background knowledge and were not confirmed. Page content was read through a summarizing fetch tool, so check exact values (especially numeric limits) against the source before hard-coding them.

## 0. Time-critical: Suomi NPP is ending

- The VNP14IMG catalog page and the FIRMS attribute page both state that Suomi NPP delivery ceases on **2 Nov 2026**. A search result quotes the same notice as 1 Nov 2026, so treat the cutoff as "this week."
- The VNP14IMG page recommends moving to VJ214IMG (NOAA-21, primary) or VJ114IMG (NOAA-20, secondary).
- For this project, S-NPP becomes a closed, fixed-length archive: 2012-01 to about 2026-11. Pair it with NOAA-20 (from 2018-04) and NOAA-21 (from 2023-03) for any forward-looking work.
- I found no FIRMS-specific statement on whether S-NPP fire detections stop on the same day as the other S-NPP products. Check the FIRMS and LANCE notices.
- Download and freeze the S-NPP SP/NRT data now.

## 1. FIRMS access

### MAP_KEY
- A free key, requested by email at https://firms.modaps.eosdis.nasa.gov/api/map_key/. The key is emailed to you.
- Rate limit: 5,000 transactions per 10-minute window. Larger requests (for example 7 days) can count as several transactions. NASA offers increases on request.

### Area API
Doc: https://firms.modaps.eosdis.nasa.gov/api/area/

```
/api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north | world]/[DAY_RANGE 1-5]/[YYYY-MM-DD optional]
```

- The date is the start date. The response covers DATE through DATE + DAY_RANGE - 1. If the date is omitted, you get the most recent data.
- Valid SOURCE values: `MODIS_NRT`, `MODIS_SP`, `VIIRS_SNPP_NRT`, `VIIRS_SNPP_SP`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA20_SP`, `VIIRS_NOAA21_NRT`, `VIIRS_NOAA21_SP`, and `LANDSAT_NRT` (US/Canada only).
- RT and URT records are dropped once NRT processing finishes, or after 6 hours.
- Day range is at most 5, so multi-year pulls need a loop over date and tile. Budget the rate limit, and chunk the bounding box for dense regions.

### Data availability endpoint
Doc: https://firms.modaps.eosdis.nasa.gov/api/data_availability/

```
/api/data_availability/csv/[MAP_KEY]/[SENSOR | ALL]
```

Use it to find the date range per source before bulk pulls. The doc page shows no example response, so the CSV columns are unconfirmed.

### Historical archive
- Download page: https://firms.modaps.eosdis.nasa.gov/download/
- Covers data older than 7 days, as SHP, CSV or JSON. Custom requests need an Earthdata login or an emailed code, and the result arrives by email.
- Coverage starts: MODIS C6.1 on 2000-11-01, S-NPP 375 m on 2012-01-20, NOAA-20 on 2018-04-01, NOAA-21 on 2023-03-01, Landsat 30 m on 2022-06-20.
- NRT is later replaced by science-quality SP data, with a lag of about 5 months. **Do not mix NRT and SP in one harmonization run without a flag.** SP is the right basis for validation.
- The same page points to University of Maryland sftp for MODIS/VIIRS burned-area files (credentials are in the user guides). That is an alternative route to MCD64A1 and VNP64A1.

### Field definitions
Source: https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs

| Field | MODIS | VIIRS 375 m |
|---|---|---|
| confidence | 0-100 percent | categorical: low, nominal, high |
| brightness | Ch 21/22 brightness temperature (K) | `Bright_ti4`, band I-4 (K) |
| second brightness | `bright_t31` (Ch 31, K) | `Bright_ti5`, band I-5 (K), shown as "Brightness_2" in web services |
| scan, track | 1 km at nadir, grows to the scan edge | about 375 m at nadir |
| satellite | A = Aqua, T = Terra | N = S-NPP, N20, N21 |
| version | e.g. `6.1URT`, `6.1NRT`, `6.1` (no suffix means standard) | `1.0NRT` or `1.0` (standard) |
| type | 0 vegetation fire, 1 volcano, 2 other static source, 3 offshore (MCD14ML standard only) | not listed |
| frp | MW | MW (sub-pixel characterization is reliable only for small or low-intensity fires) |
| daynight | D or N | D or N |

Harmonization notes:
- Confidence is not comparable across sensors. One is numeric and the other is a 3-class label. A mapping is needed, and high-confidence VIIRS pixels are tied to saturated pixels.
- Scan and track grow toward the swath edge for both sensors. Pixel-area normalization matters for FRP and for density comparisons.
- The version suffix is the NRT/SP flag. Keep it as a column.

### Product docs (swath-level, for per-pixel work and overpass time)
- **VNP14IMG v002** (S-NPP, 375 m, 6-min swaths, 2012-01-17 to present, netCDF-4, 25 science datasets including fire mask, FRP, brightness temperatures, solar zenith angle). Geolocation comes from VNP03MODLL.
  - Catalog: https://www.earthdata.nasa.gov/data/catalog/lpcloud-vnp14img-002
  - User guide: https://lpdaac.usgs.gov/documents/427/VNP14_User_Guide_V1.pdf
  - ATBD: https://lpdaac.usgs.gov/documents/133/VNP14_ATBD.pdf
  - DOI: https://doi.org/10.5067/VIIRS/VNP14IMG.002
- **MOD14 v061** (Terra, 1 km, 5-min swaths, 2000-02-24 to present, HDF4).
  - Catalog: https://www.earthdata.nasa.gov/data/catalog/lpcloud-mod14-061
  - User guide: https://lpdaac.usgs.gov/documents/1005/MOD14_User_Guide_V61.pdf
  - ATBD: https://lpdaac.usgs.gov/documents/87/MOD14_ATBD.pdf
  - File spec: https://ladsweb.modaps.eosdis.nasa.gov/filespec/MODIS/61/MOD14
  - DOI: https://doi.org/10.5067/MODIS/MOD14.061
  - The catalog page does not define the FireMask classes; read the user guide. MYD14 (Aqua) is the sibling product, but I did not fetch its page.
- The VJ114IMG and VJ214IMG pages exist (a search result lists the NRT VJ114IMGTDL page), but I did not fetch them.

## 2. Validation data

### Burned area
- **MCD64A1 v061**: 500 m, monthly, global, 2000-11-01 to present, HDF-EOS2 sinusoidal tiles. It uses MODIS 500 m reflectance plus MODIS 1 km active fires.
  - Layers: Burn Date (day of year), Burn Date Uncertainty, First Day, Last Day, QA.
  - Catalog: https://www.earthdata.nasa.gov/data/catalog/lpcloud-mcd64a1-061
  - User guide: https://lpdaac.usgs.gov/documents/1006/MCD64_User_Guide_V61.pdf
  - DOI: https://doi.org/10.5067/MODIS/MCD64A1.061
  - **Circularity warning**: its input includes MODIS active fires, so it is not independent for validating MODIS. It is more independent for VIIRS.
- **VNP64A1 v002**: 500 m, monthly, 2012-03-01 to present, same layers. v001 was decommissioned on 31 Jul 2025, so use v002 only.
  - Catalog: https://www.earthdata.nasa.gov/data/catalog/lpcloud-vnp64a1-002
  - User guide: https://lpdaac.usgs.gov/documents/2124/VNP64_User_Guide_v1.1.pdf
  - DOI: https://doi.org/10.5067/VIIRS/VNP64A1.002
  - It is an S-NPP product, so it is also subject to the Nov 2026 cessation notice.
  - The v001 guide notes false burns from cloud-mask artifacts and cropland burning.
- A day-of-burn layer allows a temporal match: does a hotspot fall on a pixel burned within plus or minus N days?
- Both products have a monthly cadence and a 500 m grid, so they suit omission and commission checks, not per-overpass checks.

### Fire perimeters (US)
- NIFC Open Data hub: https://data-nifc.opendata.arcgis.com/ (the landing page rendered no dataset list, so I could not read dataset names from it).
- A search surfaced two relevant layers:
  - "InterAgencyFirePerimeterHistory All Years View": multi-agency final perimeters, reported complete through the 2024 season, with agency-specific minimum-size thresholds. Mirror: https://wifire-data.sdsc.edu/dataset/interagencyfireperimeterhistory-all-years-view
  - "WFIGS Wildland Fire Perimeters Full History": mirror at https://wifire-data.sdsc.edu/ja/dataset/wfigs-wildland-fire-perimeters-full-history
- I did not verify a live ArcGIS REST endpoint or a prescribed-burn layer. **[UNVERIFIED]** Locate the feature service URL from the hub and test a query before coding against it.
- Caveats: perimeters are incomplete, the thresholds differ by agency, and final perimeters carry no hourly progression. They validate "was there a fire here" and not "was this pixel burning at overpass time."

### Geostationary: GOES ABI fire (FDC / HSC)
- ABI Fire/Hot Spot Characterization gives a fire mask plus temperature, area and FRP at 2 km pixels. The full disk updates every 10 minutes.
- GOES-19 became operational on 2025-04-07.
- Earth Engine catalog: https://developers.google.com/earth-engine/datasets/catalog/NOAA_GOES_19_FDCF
- AWS open data buckets (verified): `noaa-goes16`, `noaa-goes18`, `noaa-goes19`, region us-east-1. Registry: https://registry.opendata.aws/noaa-goes/
- The registry page lists no product prefix. **[UNVERIFIED]** The `ABI-L2-FDCF` and `ABI-L2-FDCC` layout is from background knowledge; list the bucket to confirm.
- Use it as a sub-hourly "was it burning at overpass time" check. Match polar overpass time to the nearest 10-minute ABI scan. It covers the Americas only and misses small fires because of the 2 km pixel.

### Landsat and Sentinel-2
- FIRMS serves **LANDSAT_NRT** at 30 m for the US and Canada only, from 2022-06-20, via the same area API. That is the only verified, already-integrated option, and it needs no new client code. It is NRT, with no SP.
- Sentinel-2 fire detection (the SWIR-based hotspot detection in the literature) has no ready archive that I verified. **[UNVERIFIED]** Treat it as a custom algorithm on Sentinel-2 L1C and not as a downloadable product.
- Both have revisit times of days, so they give high spatial fidelity but sparse temporal matches.

## 3. Satellite overpass and orbit information

All orbits are sun-synchronous. Times are local mean solar time at the equator.

| Platform | Instrument | Nominal crossing | Status and notes |
|---|---|---|---|
| Terra | MODIS | 10:30 descending | Last inclination maneuver Feb 2020, so crossing time is drifting earlier. Projected 10:15 by Oct 2022 and about 9:00 by Dec 2025. Exited the A-Train and was lowered to 694 km. |
| Aqua | MODIS | 13:30 ascending | Last maneuver Mar 2021, drifting later. Projected past 13:45 by Feb 2023 and about 15:50 around Aug 2026. |
| S-NPP | VIIRS | about 13:30 ascending | Delivery ends 2 Nov 2026. |
| NOAA-20 | VIIRS | about 13:30 ascending | Same design orbit. |
| NOAA-21 | VIIRS | about 13:30 ascending | Same design orbit. **[UNVERIFIED]** It is phased about half an orbit (about 50 min) from NOAA-20; I did not confirm this. The NESDIS NOAA-21 page URL I tried returned 404. |

Sources:
- NSIDC notice on Terra/Aqua drift (the projections above come from here, and the page is old, with its mission-end dates now stale): https://nsidc.org/data/user-resources/data-announcements/ongoing-changes-terra-and-aqua-orbits-impacting-modis-snow-and-sea-ice-products
- NASA technical paper on drift impact on MODIS: https://ntrs.nasa.gov/api/citations/20240001409/downloads/2023_SPIE_Twedt_MODIS_EV_orbit_drift_manuscript_v4.pdf
- Terra mission status deck (2023): https://modis.gsfc.nasa.gov/sci_team/meetings/202305/presentations/thome.pdf
- Terra orbit drift visualization: https://svs.gsfc.nasa.gov/4938

Caveats:
- Terra and Aqua mission-end dates conflict across sources (Dec 2025 or Feb 2027 for Terra; Aug 2026 or end of 2026 for Aqua). **I could not confirm either platform's current status.** Check before assuming MODIS data exists past 2026.
- The drift means any fixed "10:30 / 13:30" assumption is wrong for 2020 onward. Aqua and VIIRS were about 13:30 at the same local time earlier, but by 2026 Aqua is about 2 hours later than VIIRS.
- For same-overpass matching, do not use nominal times. Use the per-pixel acquisition time instead:
  - FIRMS `acq_date` and `acq_time` (UTC), or
  - the swath start time in the MOD14/VNP14IMG granule name (5- and 6-minute granules), or the per-pixel time in the geolocation product.
- For historical orbit checks, compute the true local time from the TLE history. **[UNVERIFIED]** Space-Track.org and CelesTrak archives are the usual sources; I did not fetch them.
- A coincidence window of about plus or minus 15 to 30 minutes between a MODIS and a VIIRS pixel only happens at high latitudes, where swaths overlap. At the equator the sensors are separated by hours, so use a geostationary or burned-area bridge instead of direct matching.
- At the equator Terra (descending, morning) and VIIRS (afternoon) never share a pass. This is a structural limit on same-overpass matching.

## 4. Recommended additions

See the ranked list in the project report. In short:
1. Freeze the S-NPP archive and add a `source` and `nrt_or_sp` flag.
2. Add a FIRMS area-API client with data_availability checks.
3. Per-pixel timestamp-based overpass matching, with drift-aware local-time calculation.
4. VNP64A1 v002 and MCD64A1 burned-area validation.
5. GOES ABI FDC as a temporal bridge.
