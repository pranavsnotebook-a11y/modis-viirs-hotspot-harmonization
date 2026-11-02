# Pre-registration: leave-one-satellite-out test

Committed before any model prediction was computed. Run with `python -m hotspots.latent`.

**Question.** Can one shared latent fire activity, one operator per instrument and one daily cycle predict a satellite the model never saw?

**Data.** FIRMS 7-day files, Aqua, Terra, NOAA-20, NOAA-21, FRP summed per satellite, local day and pass in 0.05 deg cells. Target: number
of those cells with at least 20 MW, per 1 deg cell, local solar day and pass (D or N). First and last local days are dropped, as is the
partial final UTC day.

**Model (reduced C-Cox).** y ~ Poisson(exp(alpha[cell,day] + beta*is_viirs + c*cos(2 pi t/24) + s*sin(2 pi t/24))). t is the satellite-pass
median local hour. alpha is profiled with a Gamma shrinkage prior, pseudo-count 0.1. Twins share an operator: Aqua = Terra and NOAA-20 =
NOAA-21. Rows cover every satellite and pass for each cell-day where a training satellite detected anything.

**Primary test.** Train on Aqua, NOAA-20, NOAA-21. Predict Terra, day and night.

**Baselines, all without Terra data.** B0: Terra = Aqua, same cell-day and pass. B1: Terra = mean of Aqua's two passes. B2: the model with no
daily cycle. B3: gradient-boosted trees (Poisson) on latitude, longitude, local hour, instrument and leave-own-satellite-out mean activity.

**Pass criteria, all required.**
1. Mean Poisson deviance on Terra beats every baseline, separately for day and for night.
2. Predicted global Terra totals are within a factor of 1.5 of actual, for day and for night.
3. The Aqua/Terra day-versus-night flip (day ratio above 1, night ratio below 1) is reproduced in at least 5 of 6 regions.

**Controls, reported whatever they show.** Hold out Aqua instead. Hold out NOAA-21: the twin should be predicted well, and no daily-cycle
credit is possible since NOAA-20 shares its local time. Secondary: a second harmonic, and region-specific cycles. Secondary results cannot rescue a failed primary test.

**Known weaknesses, declared up front.**
- The author has already seen Terra's totals and its day/night flip, so this is not blind. Confirm on a later archive week with these exact settings.
- Pass local times come from detection timestamps, including Terra's. That is orbit information, not fire counts, but a clean version would use orbit elements.
- With near-identical twin local times, four phases fit three parameters plus alpha, so one sinusoid is close to exactly determined. The test is whether that shape predicts Terra's phases.
- There is no swath exposure model, so zeros mix "no fire" with "not observed". One week only. Same-week fire activity is shared across satellites.

## Result (added after the run; nothing above was changed)
Output: `docs/research/loso_results.txt`. **Verdict: PASS, at the edge on two criteria.** Terra day / night deviance 0.742 / 0.902 versus the best baseline
(B2, no daily cycle) 1.063 / 1.123; cell-bootstrap gain 0.321 [0.279, 0.361] and 0.222 [0.182, 0.261]. Totals predicted at 1.41x and 1.16x of actual (limit 1.5x).
Flip matches in 5 of 6 regions (limit 5); Europe's actual night ratio is 1.20 on few cells.

**Two implementation errors, found by reviewing the code and fixed before the result above.** (1) Test rows were first chosen using Terra's own detections too,
against this document. (2) Criterion 3 first checked only predicted ratios and printed 6/6.

**Limits on what this shows.**
- Terra cell-days with no training-satellite detection are excluded: 2,076 of 2,382-day and 2,749 of 3,158-night cells remain before dropping edge days, so Terra-only fires are never tested.
- Criterion 3 is weak: a global sinusoid plus Aqua's own day/night counts nearly implies a flip. Regional ratios miss by up to about 3x.
- Controls are mixed. Gradient-boosted trees beat the model on night passes when Aqua (0.341 vs 0.359) or NOAA-21 (0.661 vs 0.888) is held out. The model's edge is at local hours no training satellite saw.
- A second harmonic is not identified (operator -6.31, totals 0.3-0.5x), as declared.
- This is a Poisson GLM with cell-day effects: the reduced baseline of C-Cox, not yet a new architecture. No FRP marks, no swath exposure.
- Not blind, one week. Needs a later week with identical settings, and GOES to check the learned 14.7 h peak independently.
