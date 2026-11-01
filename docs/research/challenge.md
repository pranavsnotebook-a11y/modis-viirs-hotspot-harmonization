# Challenge research: Harmonization of MODIS and VIIRS Hot Spots (Space Apps 2026)

Researched 2026-11-02. Legend: [VERIFIED] = read from the official source; [PARTIAL] = official but from a different year/page; [UNVERIFIED] = not confirmed.

## 1. Official challenge text [VERIFIED]

Source: the spaceappschallenge.org public GraphQL API (`https://api.spaceappschallenge.org/graphql`), the same backend that renders
https://www.spaceappschallenge.org/2026/challenges/harmonization-of-modis-and-viirs-hot-spots/
(the page is client-rendered, so plain fetches show no body text). Categories/skills: Earth Science, Software.

**Summary (verbatim):**
> Understanding how burning activity is distributed across our planet over time, including wildfires and agricultural burns intense enough to be detected by satellite sensors, enables us to anticipate critical periods, guide monitoring efforts, and improve fire response. Satellites have tracked active fire hotspots for more than two decades, but the record is split across sensors whose data cannot be compared directly, leaving fire managers without a consistent picture of when and where burning has occurred. Your challenge is to build a web application that harmonizes these records into a burning activity calendar based on active fire hotspots, enabling early warning and emergency responders, scientists, and land managers to examine historical fire patterns, unusual conditions, and critical periods within a selected area of interest.

**Background (key sentences, verbatim):**
> MODIS sensors on board Terra and Aqua satellites provide more than two decades of observations, but they are approaching the end of their operational life and are being replaced by VIIRS sensors. Their records cannot be directly compared without harmonization, since MODIS and VIIRS have different spatial resolutions, sensitivities, and observation schedules.

> ...emergency managers benefit from an updated and consistent hotspot calendar that enables them to rapidly visualize, for example, which month and years had the highest fire activity, and compare the burning activity of the current month against the historical median for a selected area.

> You may consider harmonizing NASA Earthdata FIRMS hotspots, combining the extensive historical series of MODIS with the continuity and greater detail of VIIRS.

**Objectives (verbatim):**
> Your challenge is to develop a harmonized burning activity calendar based on active fire hotspots in a web application, combining the extensive historical series of MODIS with the continuity and greater detail of VIIRS to provide a consistent time series of hotspot activity.

> This challenge could be approached in two parts. The first is MODIS and VIIRS hotspot harmonization, so that by the end of that phase the sensor of origin no longer matters and the patterns, trends, and anomalies become the focus.

> The second involves developing a web application that takes harmonized hotspot data as input. Through this visual tool, a user could select a region and a specific date range, then download analytics and visualizations of fire activity.

> A calendar of burning activity showing the number of hotspots detected from the early 2000s to the present, built on the harmonized hotspots dataset and integrated into the web application, would give emergency managers a view of the fire history of an area: which periods of the year see more fires, which years had more burning activity, and how a current fire compares with previous ones.

> In addition to numerical information, you could consider how color ramps might represent similarities and differences in the number of detected hotspots across months, providing an accessible and intuitive way to visualize fire activity. A downloadable CSV File of hot spots detected during a search would be another useful output.

**Potential considerations ("You may (but are not required to)"), verbatim list:**
- Your target audience can include early warning and emergency responders, scientists, land managers, and firefighters.
- Consider making your web application interactive – for example, a map where users can draw the area of interest, or an option to enter latitude and longitude.
- Consider using accessible color ramps.
- Your tool could depict a burning calendar
- Your tool could focus on a few key indices and figures and present them through data visualizations, such as: Historical comparisons, including anomalies against multi-year averages; Number of fires detected and reported

**Resources tab [VERIFIED as of 2026-11-02]:** body reads only "Resources will be available on Friday, November 13." and the challenge page says "More resources may be added before the hackathon begins." So no official suggested datasets/links exist yet; only the background's mention of NASA Earthdata FIRMS. Re-check on/after Nov 13.

**Deliverables:** The challenge page lists no formal deliverable list beyond: a web application, a harmonized hotspot dataset/time series, a burning activity calendar, region + date-range selection with downloadable analytics/visualizations, optional CSV export. Generic submission items are in section 2.

## 2. Judging criteria and submission rules

**[PARTIAL] 2022 Judging & Awards Guide** (https://spaceapps-prod.s3.amazonaws.com/media/documents/Space_Apps_2022_Judging_and_Awards_Guide.pdf, extracted locally). I could not retrieve a 2026 guide (the current page https://www.spaceappschallenge.org/resources/judging-awards-guide is client-rendered; a search snippet suggests the live page still uses the same five criteria and refers to a "2024 Project Submission Guide"). Treat the following as the best available, [UNVERIFIED] for 2026:

- **Impact:** "How much impact (quality and quantity) can this project have? Does it solve a big problem or a little problem? Will it inspire or help many, or a few?"
- **Creativity:** "How creative/innovative is the approach? Is the project novel and something that hasn't been attempted before, or is it an incremental improvement on something that already exists?"
- **Validity:** "Is the solution scientifically valid? Will it do what it sets out to do? Can it work in the real world?"
- **Relevance:** "Is this project responsive to the challenge for which it was submitted? Is it a complete solution or does it have a long way to go? Is it technically feasible? How usable or user friendly is the solution?"
- **Presentation:** "How well did the team communicate their project? Were they effective in telling the story of the project: the challenge, the solution, and why is it important?" The guide stresses giving presentation equal attention to the other four.

Eligibility minimums (2022 guide, likely unchanged): respond to an official challenge (not "Invent Your Own"); all members registered on the project page (max 6); all required fields completed; English (video may be another language with English subtitles); submit before the deadline; and check the box confirming original work with **all external resources (code, text, images, even open source) listed in the References field**.

**Global awards (2022 list; 2025 winners page shows the same names):** Best Use of Science, Best Use of Data, Best Use of Technology, **Galactic Impact** ("The solution with the most potential to improve life on Earth or in the universe."), Best Mission Concept, Most Inspirational, Best Storytelling, Global Connection, Art & Technology, Local Impact. Process: Local/Universal judging -> Global Nominees (about 1 in 10) -> Global Finalists -> Executive judging -> Global Winners.

Hackathon dates for 2026: [UNVERIFIED]. Resources go live Nov 13 per the challenge page, so the event is later than that.

## 3. What past fire/FIRMS Space Apps projects did well [PARTIAL]

Searches found no FIRMS wildfire project that won a Global Winner or Galactic Impact award. 2025's ten winners (https://www.nasa.gov/learning-resources/stem-engagement-at-nasa/nasa-announces-2025-international-space-apps-challenge-global-winners/) include none on fire; the Galactic Impact winner was Astro Sweepers (orbital debris compliance platform). Only Global Nominee-level fire projects were found (2018-2020 fire challenges "Real-Time Fire App", "Spot That Fire V2.0/V3.0"):

- NasaOnFire (2019, Spot That Fire V2.0; Local People's Choice, Global Nominee): FIRMS near-real-time fire data, ML-for-prediction idea. https://2019.spaceappschallenge.org/challenges/living-our-world/spot-fire-v20/teams/nasaonfire/project/
- Fierr (2020, Spot That Fire V3.0; Global Nominee): drawn burn area -> economic-damage estimate, with current MOD14/VIIRS thermal anomalies on the map. https://2020.spaceappschallenge.org/challenges/confront/spot-fire-3/teams/fierr/
- go:hub / SofiA (2018, Global Nominee): fire-risk model on MODIS+VIIRS FIRMS products. https://2018.spaceappschallenge.org/challenges/volcanoes-icebergs-and-asteroids-oh-my/real-time-fire-app/teams/gohub/
- Fireflies / Fire-Wire (2018, Global Nominee): cross-checked citizen reports with FIRMS. https://2018.spaceappschallenge.org/challenges/volcanoes-icebergs-and-asteroids-oh-my/real-time-fire-app/teams/fireflies/

Pattern (my inference from these, not an official statement): nominees tied FIRMS data to a concrete user action (alerts, damage estimate, citizen-report validation), had a usable map UI, and paired the science with a clear audience story. Because the guide's top-level awards reward Best Use of Data, Science validity, and Presentation, the likely differentiators are scientifically defensible harmonization, a polished demo, and a crisp story.

## 4. Same-challenge 2026 team repos (ideas, not official) [VERIFIED to exist; contents only skimmed]

- FireChronicle: https://github.com/bhavishyaone1/FireChronicle - unique active cells on an equal-area grid shown beside per-sensor counts; do not sum overlapping FRP; do not call hotspots confirmed fires; zero detections are not proof of no fire; claims 11-stage pipeline (FastAPI + Next.js).
- salmahmed6 repo: FIRMS downloader for Punjab, validates and keeps raw API responses.
- Other repos found (not opened): leon-pscl/4-bcc-nasa, itssouradip34/NASA-MODIS-VIIRS-Hotspots-Harmonization, shahmirkhan106/firelens, squadronzero/squadron-zero, the-aris-club/flare-chronos, Vtheonly/NasaSpaceApp2026, mdhabibullahmahmudncs13/Icarus-....
- Search summaries said some teams: map MODIS 0-100 confidence and VIIRS l/n/h onto low/nominal/high, bin to a shared ~0.05 deg grid, calibrate VIIRS to MODIS in the overlap period by regression, and note S-NPP delivery ending 1 Nov 2026 with NOAA-20 as continuity [UNVERIFIED, secondhand].

## 5. Checklist of what the challenge asks for, vs this repo

Repo state read: README.md, docs/SUMMARY.md, file tree (src/hotspots/{io,schema,match,merge,confidence,footprint,frp,detection,analyze,regional,map,report,cli}.py, web/{index.html,app.js,build_sample.py,sample.json}, data/ with 24h CSVs only).

| Challenge ask | Status in repo |
|---|---|
| Harmonize MODIS + VIIRS into one consistent time series where sensor of origin no longer matters | Partial. Schema normalization, confidence classes, footprint, FRP, and pairwise matching exist. But merging is event-level on one 24 h snapshot, not a long-run count series corrected for sensor differences (resolution/sensitivity/overpass). |
| Early-2000s-to-present history | Missing. Data are 24 h global files. Need FIRMS archive (MODIS from 2000/2002, VIIRS from 2012) and an overlap-period calibration/bias model. |
| Web application | Partial. `web/` is a static dashboard on sample.json (source layers, FRP histogram, counts) plus a generated map.html. |
| Burning activity calendar (month x year counts, color ramp) | Missing. |
| Select region/AOI (draw on map or enter lat/lon) and date range | Missing in web UI (regional.py uses coarse boxes in the CLI). |
| Compare current month to historical median / anomalies vs multi-year averages | Missing. |
| Downloadable CSV of hotspots for a search | Partial. CLI writes harmonized.csv; no in-app, query-scoped download. |
| Downloadable analytics and visualizations | Missing. |
| Accessible color ramps | Unknown/not evidenced; verify in style.css. |
| Number of fires detected and reported; key indices | Partial (counts per sensor/event exist for one day only). |
| Audience framing (emergency responders, land managers) | docs/PITCH.md and SUMMARY.md exist; not checked against this checklist. |

Submission hygiene (from the guide): list every external library, dataset, and image in References; keep to an official challenge; prepare a presentable demo and story (Presentation criterion); check Resources tab after Nov 13 for official data links.

## 6. Unverified or gaps in this research
- No 2026 Judging & Awards or Project Submission guide retrieved; criteria are from the 2022 PDF.
- Resources tab empty until Nov 13; no official suggested-data list.
- No confirmed Global Winner/Galactic Impact FIRMS wildfire winner found; only nominee-level 2018-2020 examples.
- 2026 event dates and submission deadline not found.
