# Replay 8 January 2025: did GOES-16 see the two fires?

Follow-up to `replay_2025-01-08.md`. Every number is in `replay_2025-01-08/goes.json`. Run: `python scripts/replay_goes.py` (numpy, h5py).

## Question, fixed before running

Did GOES-16 (GOES-East, scans the full disk every 10 minutes) flag a fire pixel covering fire A (25.265 S, 56.765 W) or
fire B (25.215 S, 57.069 W) before the 20:01 UTC trip, and when was the first such scan on 8 and on 7 January 2025?
"Covering" means a fire-class pixel centre within 4 km of the fire.
## Data

- NOAA open bucket `noaa-goes16`, product ABI-L2-FDCF (full-disk fire / hot spot). It holds both dates.
- 134 scans: 62 on 8 January (10:00 to 20:10 UTC start times) and 72 on 7 January (12:00 to 23:50).
  60 of the 8 January scans finished before 20:01 UTC.
- Fire classes read from the file: 10 to 15 and 30 to 35 (good, saturated, cloud contaminated, high, medium, low
  probability, and the temporally filtered versions). Cloud classes: the ten cloud tests, codes 200 to 245.
- Pixel size at the fires: about 2.2 km east-west by 2.4 km north-south.
- Projection checks: sub-satellite point 0.0 N, 75.0 W (the file says 75.0 W). A point at Asuncion lands in a pixel whose
  centre is 0.92 km away. Fire A pixel centre 0.99 km, fire B 0.66 km from the fire.
## Result

| Fire | Day | Scans | Scans with a flag | First flag (scan start, UTC) | Classes seen | FRP range |
|---|---|---|---|---|---|---|
| A | 8 Jan | 62 | 0 | none | none | none |
| A | 7 Jan | 72 | 0 | none | none | none |
| B | 8 Jan | 62 | 0 | none | none | none |
| B | 7 Jan | 72 | 6 | 21:20:20 | good (1), temporally filtered good (5) | 27.0 to 68.41 MW |

Fire B on 7 January was flagged in six consecutive scans, 21:20:20 to 22:10:20 UTC, 0.66 km from the fire. It was
not flagged on 8 January.

**Headline: on the day of the trip GOES-16 flagged neither fire in any scan before 20:01 UTC. It flagged fire B
only on the previous evening, for about 50 minutes.**

Cloud was not the reason. On 8 January the pixel over A and over B was classed "processed, no fire" in 54 of 62
scans and in the "solar zenith or glint block-out zone" (no retrieval) in the other 8 (11:40 to 12:50 UTC). Zero scans
had cloud on those pixels or in the 3 by 3 pixels around them. On 7 January the same 8-scan block-out fell at
17:20 to 18:30 UTC, which covers the two polar detections of 7 January (17:24 and 17:47 UTC), so GOES made no fire
retrieval then.

Nearest GOES fire pixel in the roughly 50 km window around each fire on 8 January: 9.16 km from A, 6.63 km from B.
Near Vapor Cue park (30 km radius) GOES showed 0 to 3 fire pixels per pre-trip scan (60 scans). The last scan with any was 18:00:20 UTC; none from 18:10:20 to 20:10:20.
## Lead time (assumption)

Assume data is available 30 minutes after the scan. That figure is NASA's stated typical latency for geostationary data
in FIRMS. It is an assumption here, not measured.

- 8 January: no flag, so no lead time. The 17:05 to 18:08 UTC polar detections remain the only fire evidence for the day.
- 7 January: a flag at 21:20:20 UTC would be available about 21:50 UTC, 1331 minutes (about 22 hours) before the trip.
  That is a fire persisting near a line the evening before, not a warning of the trip.
## Limits

- A 2.2 by 2.4 km pixel cannot say which side of a line a fire is on, or how far from it.
- Low-probability classes produce false alarms. None of the flags at A or B were low probability.
- One event. No miss rate or false-alarm rate can come from it.
- GOES-16 has since been replaced as GOES-East by GOES-19. The same product exists but not the same instrument.
- This does not show that either fire caused the trip.
