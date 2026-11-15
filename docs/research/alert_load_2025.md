# Alert load in 2025: distance rule vs wind rule

## The question, fixed in advance
For every day of 2025, how many days and fire clusters would each rule flag on a mapped 500 kV line in Paraguay?
1. Distance rule: a fire cluster within 5 km of the line.
2. Wind rule (the DOWNWIND page): a cluster within 25 km of the line, hourly modelled wind for the pass hour and the
   two hours after it, 3 scenario hours, plume axis crosses the line, crossing within 25 km, peak >= 1 ug/m3.

This measures alert load only. Nobody here has the utility's trip log, so it says nothing about accuracy.

## Data and settings
- FIRMS 2025: VIIRS S-NPP, VIIRS NOAA-20, MODIS Terra and Aqua; type 0 only. 20,195 detections lie within 25 km of
  a line. DOWNWIND.cluster at 1.5 km gives 10,970 clusters (per satellite and overpass, so one fire seen by two
  satellites counts twice).
- 35 OpenStreetMap ways with voltage 500000 (107 pieces of up to 25 vertices; pieces over 30 km away are skipped).
- ERA5 hourly wind from the Open-Meteo archive for 76 cells of 0.25 degrees. No cell and no detection lacked weather.
- A day is the UTC date of the pass. Any of the three hours meeting the wind test flags the cluster.
- Check: the plain 5 km rule counted on single detections gives 245 days, as in the replay note. By clusters: 244.

## Results (all from alert_load_2025.json)
| Rule | Flagged days | Flagged clusters | Clusters per flagged day, median | 90th percentile |
|---|---|---|---|---|
| Distance, 5 km | 244 | 2,422 | 7 | 22 |
| Wind rule | 257 | 3,080 | 8 | 31 |
| Wind rule, cluster FRP >= 5 MW | 242 | 2,242 | 6 | 24 |
| Wind rule, cluster FRP >= 10 MW | 215 | 1,498 | 4 | 17.6 |
| Wind rule, fires within 5 km only | 212 | 1,215 | 4 | 13 |
| Wind rule, fires beyond 5 km only | 229 | 1,865 | 5 | 18.2 |

## What it shows
- The wind rule does not cut the number of flagged days. It flags 257 days against 244 for the ring. It flags more
  clusters (3,080 against 2,422) and a heavier worst case (90th percentile 31 against 22 per day).
- The reason is range: 1,865 of the 3,080 wind flags (61%) come from fires farther than 5 km, which a ring misses.
  26 days are flagged only by the wind rule; 13 only by the ring.
- Of the 2,422 clusters a 5 km ring flags, 1,215 (50%) are upwind by the wind test. Days fall from 244 to 212 (13%)
  when the wind test is applied inside the ring.
- A minimum fire size cuts load more than wind does: at 10 MW the wind rule flags 215 days and 1,498 clusters.
- Sanity check, 2025-01-08: the wind rule flags the fires at 25.265 S 56.765 W (3 clusters) and 25.215 S 57.069 W
  (2 clusters), as the replay did.

## Limits
- No ground truth: a flag is not a trip, and a missed flag is not known to be a miss.
- ERA5 is a 0.25 degree reanalysis; direction is unreliable in light wind, and the 8 January winds were 1.6 to 3.4 m/s.
- NOAA-21 is missing from the keyless archive, so detections are undercounted.
- OpenStreetMap lines may be incomplete; fewer mapped lines means fewer flags from both rules.
- Fires are held at observed FRP for the whole scenario; real fires grow, shrink and move.
- "Type 0" can include non-vegetation heat sources. The 1 ug/m3 threshold is the lowest plume band, not a damage level.
- Allowing three hours and any line makes the wind rule more permissive than a single-hour test would be.
