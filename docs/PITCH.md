# 5-minute pitch: "One Fire Record"

**0:00 Hook.** "Against their 2013-2020 averages, MODIS has 2025 fire detections down 18%. VIIRS S-NPP has them down 10%. Same planet, same year. Which do you tell a health officer?"

**0:30 Problem.** Everyone knows MODIS and VIIRS differ in resolution, so raw counts jump in 2012 and you can't splice them. That's the known problem. We found a second one inside MODIS itself.

**1:00 Discovery.** Open Historical Analysis. Terra and Aqua are identical instruments, yet since about 2021 their daytime passes moved from 10.6 h and 13.5 h local time to 9.6 h and 14.7 h. Fires peak in the afternoon, so Terra now looks earlier and Aqua later. Aqua/Terra went from about 2.4 to 3.89 by day and from about 0.47 to 0.34 at night. The record's meaning changed without the instruments changing.

**2:00 Test.** We wrote the pass rule first, then checked against S-NPP, whose orbit held. For 2025 against 2013-2020, in the same countries and months, Terra/S-NPP is x0.61 by day and x1.33 at night. A daily cycle learned from one week of 2026, with Terra held out and no refit, predicted x0.69 and x1.51. Ageing would lower both and real fire change would leave them flat. By country, 53 of 54 fell by day and 52 of 54 rose at night.

**3:00 Say the limits before anyone asks.** MODIS's data version changes in 2023, and that year's step can't be separated from the drift, although the fall continues within the one version. The test wasn't fully blind. The model overstates the night rise. We measured this; we have not corrected it.

**3:30 It hit our own product.** Our Harmonized record started rising against S-NPP after 2021 because fewer pixels match. A wider window didn't fix it, so the site tells you those years aren't comparable. We would rather show this than hide it.

**4:00 Demo.** Calendar: months against years, missing data is not zero. Click a month and the map, statistics and table follow. Map Explorer: 1.2 million real records with source IDs, then the 3D globe. Export only what is filtered, with source IDs preserved.

**4:40 Next.** Correct for drift by region rather than with one global cycle, repeat the held-out test on a separate week, and validate against burned area or perimeters. Sensors matter. So does when they look.
