# VIIRS control for the MODIS orbit drift: results

Rules: `preregistration_viirs_control.md`, committed before any per-year S-NPP count was computed. Code: `hotspots.drift_control`, `hotspots.drift_window`. Data: `viirs_control.csv`, `drift_window.csv`.

## Preregistered test: PASS on all five checks
2025 against 2013-2020, vegetation fires, same countries and months.

| Check | Rule | Result |
|---|---|---|
| Terra/S-NPP day falls | at least 15% | x0.614 |
| Terra/S-NPP night rises | at least 15% | x1.334 |
| Day against the model | within 1.25x | model x0.686 |
| Night against the model | within 1.25x | model x1.515 |
| S-NPP local hour moves | under 0.25 h | day 0.08 h, night 0.15 h |

For scale, the standard deviation of these two ratios across 2013-2020 was 0.019 and 0.022.

Terra ageing predicts both ratios falling, and real fire change predicts both staying about flat. Neither fits as the main cause.

## What limits it
- **Data version.** MODIS `version` is 6.2 for 2013-2017, 6.03 for 2018-2022 and 61.03 for 2023-2025. The last change comes as the drift speeds up, which the preregistration said would limit the claim. Within 61.03, 2023 to 2025, the day ratio still falls x0.727 (model x0.789) and the night ratio rises x1.152 (model x1.285). The 2022 to 2023 step is x0.855 by day against a model x0.933, and it cannot be separated from the version change. The 2018 change (6.2 to 6.03) shows no visible step.
- **Not fully blind.** The Aqua/Terra table had been seen, so a fall in Terra/S-NPP was likely unless Aqua also moved. The new information is that S-NPP did not fall with Terra.
- **Thresholds.** The 15% and 1.25x limits were my choice, and the observed values sit about 10-12% below the model.
- **Model misses.** Night in 2025 is x1.33 against x1.51. Terra/S-NPP night barely moves from 2024 to 2025 while the model keeps rising. Aqua/S-NPP night in 2025 is x0.85 against x0.95, and Aqua/S-NPP day in 2024 is x1.17 against x1.06.
- **S-NPP gaps.** S-NPP has 350 days in 2022 and 347 in 2024, which inflates Terra/S-NPP in those years. 2025, the tested year, has all 365.

## Exploratory, not preregistered
- **Countries.** Among the 54 countries holding over 0.2% of S-NPP detections, Terra/S-NPP fell by day in 53 and rose at night in 52. The day change runs from x0.31 (Angola) to x0.89 (India), so one global daily cycle is too simple. Country ratios here are annual and do not fix the month.
- **Totals.** Against each record's own 2013-2020 mean, 2025 detections are -17.9% in MODIS and -9.7% in S-NPP. Terra by day is -48.1%, S-NPP by day -10.0%. One year.

## Does drift affect our own matching?
Hypothesis, formed after noticing the Harmonized and VIIRS lines meet in 2025: Terra's gap to S-NPP grew from about 168 to about 235 minutes, past the 180 minute window, and this inflates Harmonized. Two years tested, exploratory.

| Share of MODIS pixels matched | 2021, 180 min | 2025, 180 min | 2021, 300 min | 2025, 300 min |
|---|---|---|---|---|
| Terra, day | 24.6% | 9.7% | 34.1% | 28.9% |
| Terra, night | 20.3% | 2.6% | 48.2% | 38.4% |
| Aqua, day | 53.9% | 40.1% | 53.9% | 40.1% |
| Aqua, night | 82.7% | 77.0% | 82.7% | 77.0% |
| All MODIS | 44.3% | 31.9% | 49.6% | 39.4% |
| Harmonized / S-NPP | 92.0% | 100.6% | 88.5% | 96.4% |

The hypothesis is only partly right. The window does account for most of Terra's collapse at 180 minutes. But widening it to 300 minutes barely changes the rise in Harmonized / S-NPP (+8.6 against +7.9 points), and Aqua's match share falls even though Aqua stays inside both windows. The cause of Aqua's fall is not established: the data version, viewing geometry and fire changes between overpasses are all open.

**Consequence.** Harmonized counts after about 2021 are not comparable with earlier years, and a wider fixed window does not fix that. The window was left at 180 minutes and the site says so.
