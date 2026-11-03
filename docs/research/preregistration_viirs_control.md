# Preregistration: VIIRS as a control for the MODIS orbit drift result

Written before any per-year S-NPP count or MODIS/S-NPP ratio was computed. The Aqua/Terra table in `modis_drift.csv` had already been seen.

## Question
Does the change in MODIS day and night counts after 2021 follow the overpass time, or does it follow something else: real fire change, Terra ageing, or a change of data version?

## Data
FIRMS yearly country archives, MODIS C6.1 and VIIRS S-NPP 375 m, 2013 to 2025. `type` 0 only (vegetation), so gas flares and volcanoes are excluded. S-NPP is the control because its orbit is maintained, which this run checks by measuring its local hour per year.

## Metric
For each sensor pair, day and night apart, a ratio with geography held fixed: for each country and calendar month stratum, the year's ratio of counts, weighted by that stratum's 2013-2020 S-NPP count. Strata with fewer than 20 detections on either side that year are left out. The result is compared with the 2013-2020 mean of the same metric. Raw totals are reported beside it.

## Prediction
The daily cycle is the Terra-held-out fit from commit 5021b3b, with no refit: `drift.predicted_ratio`, using measured local hours. Predicted change for Terra/S-NPP in 2025 against 2013-2020 is given in `viirs_control.csv` as `pred_*`.

## How each explanation would look
| Explanation | Terra/S-NPP day | Terra/S-NPP night |
|---|---|---|
| Overpass time | falls | rises |
| Terra ageing | falls | falls |
| Real fire change | about flat, since S-NPP sees it too | about flat |

## Pass rule
The overpass explanation is supported only if, for 2025 against 2013-2020 with geography fixed, all of these hold:
1. Terra/S-NPP day falls by at least 15%.
2. Terra/S-NPP night rises by at least 15%.
3. Both changes lie within a factor of 1.25 of the model's predicted change.
4. S-NPP local hour moves by less than 0.25 h over 2013-2025.

If 1 or 2 fails, the overpass explanation is not supported as the main cause. If only 3 fails, the direction is supported and the model's size is not.

## Also reported, not part of the pass rule
Aqua/S-NPP day and night, 2023 and 2024, and the `version` values and days observed per year, since a version change would be a rival explanation. A version change that coincides with the drift would limit the claim whatever the result.
