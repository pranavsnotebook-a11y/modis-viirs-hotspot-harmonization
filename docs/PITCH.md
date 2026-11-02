# 5-minute pitch: "One Fire Record"

**0:00 Hook.** "Fires doubled since 2012." Maybe. Or the satellite changed. Show raw counts stepping up when VIIRS arrives.

**0:45 Problem.** MODIS 1 km vs VIIRS 375 m: different pixels, schemas, confidence scales, overpass times. Nobody can tell
real change from sensor change. Those most hurt are places where small agricultural fires dominate.

**1:30 Core result.** NOAA-20 VIIRS sees 5.6x as many detections as MODIS. Raise a common FRP floor and the ratio falls:
2.9x at 5 MW, 1.7x at 10 MW, 1.08x at 20 MW (one week, global; `python -m hotspots.floor`). Most of the gap is
sensitivity, not fire. Honest caveats on the slide: one week, FRP definitions differ, ratio dips to 0.70 above 50 MW.

**2:30 Method.** Footprint-overlap matching; detection floor scales with pixel area (MODIS smallest daytime fire 5.3 MW at
<=1.5 km2 up to 27.4 MW at >6 km2); unified confidence; FRP uncertainty. Say plainly: the FRP fit (25 pairs) is not
better than 1:1, so we do not sell a correction.

**3:15 Demo.** Explorer: pick a region, calendar, anomaly vs median, download CSV. Then toggle raw vs floor-matched.

**4:00 Impact.** Claim Checker (trust), Invisible Burn Ledger (equity: districts whose burning MODIS never saw), Look Ledger
(responders: blank map = unknown). Ideas and critiques in `docs/ideas/`.

**4:40 Limits and next.** 8 days of data today; multi-year build needs FIRMS MAP_KEY; validate on a famous event
(Canada 2023 / Australia 2019-20) against perimeters or burned area.
