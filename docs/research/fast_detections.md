# Fast detections: INPE 10-minute GOES-19 files

This is a second, coarser observation source. The project has not validated it against ground reports.

## Source
INPE Programa Queimadas publishes a small CSV every 10 minutes:
`https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/10min/focos_10min_YYYYMMDD_HHMM.csv` (UTC).
Columns: `lat,lon,satelite,data`. South America only. About 3.75 days of files are kept. CORS is open (`*`), so a browser can fetch them.
FIRMS (MODIS, VIIRS) reaches the public up to 3 hours after a pass. GOES-19 is geostationary (about 2 km pixels).

## Measured
- Earlier, once, over 543 files on 14 November 2026: GOES-19 detection time was a median of 20 minutes before the file time stamp. NOAA-20, NOAA-21, AQUA and TERRA rows were about 3 hours old, like FIRMS. This is the gap between detection time and file time stamp, not a guaranteed delivery time.
- Live run, 14 November 2026, 18:21 UTC, last 6 hours (37 file slots, all 37 loaded, 0 missing, 0 failed):
  - South America [-82,-56,-34,13]: 1569 detections, 682 pixels (296 flagged on 2 or more scans); newest detection 22 min old.
  - Paraguay [-62.7,-27.7,-54.2,-19.2]: 181 detections, 27 pixels (23 on 2 or more scans); newest detection 182 min old (no newer GOES-19 detection in the box).
- In that run every GOES-19 row was exactly 20 min before its file stamp, on a 10-minute boundary, with no row repeated across files. One run only; not a general result.
- The files also contain MSG-03 rows; the module drops them (only GOES-19 is kept).

## What `web/js/fast-core.js` does
- `FAST.fileTimes`, `FAST.load`: requests the 10-minute files (max 6 at a time), tolerates 404 and network errors per file, caches loaded files by name, keeps GOES-19 rows with a full date and time inside the bbox.
- `FAST.pixels`: groups repeats of the same pixel (lat, lon to 3 decimals) and counts `scans`. One scan is weak evidence; several consecutive scans are stronger. Pages can rank by `scans`.
- `FAST.upwindOfLine`, `FAST.upwindOfPoint`: geometry only, using modelled wind. Gives distance, bearing, downwind yes/no, along-wind distance, travel time (wind speed floored at 1 m/s). An asset closer than 2 km to the pixel centre is `inPixel`: the wind test cannot be trusted there.
- `FAST.SOURCE`: the label and caveats the pages must show.

## What it does not do
- No plume or concentration: there is no fire power, so the FIRELAB plume is not run.
- No confidence value. A single-scan pixel may be a false alarm.

## Limits
About 2 km pixels; no fire power or confidence; more false alarms than MODIS or VIIRS; small or short fires can be missed; cloud hides fires; coverage is South America. A date-only row (no time) is dropped; none were seen in the live run.
