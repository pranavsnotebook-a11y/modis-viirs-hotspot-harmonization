# 5-minute pitch: "One Fire Record"

**0:00 Hook.** "Fires doubled since 2012." Maybe. Or the satellite changed. Show raw counts stepping up when VIIRS arrives.

**0:45 Problem.** MODIS 1 km vs VIIRS 375 m: different pixels, schemas, confidence scales, overpass times. Nobody can tell
real change from sensor change. Those most hurt are places where small agricultural fires dominate.

**1:30 Core result.** Compare one satellite with one satellite and sum FRP per grid cell before flooring: NOAA-20 / Aqua falls
from 5.45x to about 2x (2.31x at 20 MW, 2.02x at 100 MW) and stops there. Sensitivity explains a lot, not everything. Aqua / Terra,
two identical instruments, also differ by 2.0-2.3x at every floor (`python -m hotspots.floor`). One week of data; overpass time is
a candidate explanation, not yet tested.

**2:30 Method.** Footprint-overlap matching; detection floor scales with pixel area (MODIS smallest daytime fire 5.3 MW at
<=1.5 km2 up to 27.4 MW at >6 km2); unified confidence; FRP uncertainty. Say plainly: the FRP fit (25 pairs) is not
better than 1:1, so we do not sell a correction.

**3:15 Demo.** Explorer: pick a region, calendar, anomaly vs median, download CSV. (Floor-matched view not built: a per-pixel floor proved invalid.)

**4:00 Impact.** Claim Checker (trust), Invisible Burn Ledger (equity: where a MODIS-only record undercounts; the metric is still being defined), Look Ledger
(responders: blank map = unknown). Ideas and critiques in `docs/ideas/`.

**4:40 Limits and next.** 8 days of data today; multi-year build needs FIRMS MAP_KEY; validate on a famous event
(Canada 2023 / Australia 2019-20) against perimeters or burned area.
