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
