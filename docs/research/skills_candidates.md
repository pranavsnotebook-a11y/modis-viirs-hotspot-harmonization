# Skill / MCP candidates for NASA FIRMS hackathon project

Researched 2026-11-02 via web search + GitHub page fetches. NOTHING was installed or run.
Last-commit dates were not visible in fetched pages; check each repo's commit history before use.
General trust rule: read every SKILL.md and any scripts/ before enabling; for MCP servers read the source, pin a commit, and use a throwaway API key.

## Ranked

1. anthropics/skills - https://github.com/anthropics/skills
   - Official Anthropic skill collection (docx/pdf/pptx/xlsx, skill-creator, webapp-testing, mcp-builder, frontend/design, etc.). ~186k stars, 61 commits.
   - Use: pptx (pitch deck), webapp-testing (verify dashboard), frontend-design, skill-creator.
   - Trust: HIGH (first party). Mixed licence: many Apache-2.0; docx/pdf/pptx/xlsx are source-available, not open source. Some of these skills are also already available in this Claude Code session.

2. nasa/earthdata-mcp - https://github.com/nasa/earthdata-mcp (docs: https://nasa.github.io/earthdata-mcp/)
   - Official NASA hosted MCP (https://cmr.earthdata.nasa.gov/mcp/v1, streamable HTTP, no server auth) for CMR search + Harmony transformations. ~40 stars, 156 commits. Setup guides for Claude Code.
   - Use: discover VIIRS/MODIS/FIRMS-related collections and granules. Does NOT serve FIRMS hotspot rows directly.
   - Trust: HIGH (NASA org). Licence not shown on page.

3. K-Dense-AI/claude-scientific-skills - https://github.com/K-Dense-AI/claude-scientific-skills
   - ~55.6k stars, 762 commits, MIT repo (per-skill licences vary). Has geospatial/remote-sensing category (GeoPandas, GeoMaster), statistics (statsmodels), matplotlib/seaborn/scientific visualisation, scientific writing, scientific slides (python-pptx).
   - No dedicated pandas/scipy or plotly skill.
   - Trust: MEDIUM. Large, popular, community-run; scan scripts; cherry-pick only a few skills rather than installing all.

4. ProgramComputer/NASA-MCP-server - https://github.com/ProgramComputer/NASA-MCP-server
   - General NASA MCP gateway incl. `nasa/firms` (needs FIRMS_MAP_KEY), GIBS, EONET, POWER, CMR, DONKI. ~94 stars, 50 commits, ISC licence. npm package @programcomputer/nasa-mcp-server.
   - Most direct FIRMS-in-Claude option found.
   - Trust: MEDIUM. Single maintainer, npm package execution; read source, pin version, do not auto-run via npx unreviewed.

5. mahdin75/gis-mcp - https://github.com/mahdin75/gis-mcp
   - 90+ GIS tools wrapping Shapely, PyProj, GeoPandas, Rasterio, PySAL; static/interactive maps. ~202 stars, 272 commits, MIT. (Page's own tool counts are inconsistent.)
   - Use: buffers, spatial joins, CRS, clustering/autocorrelation on fire points.
   - Trust: MEDIUM. Active, MIT; runs local Python on your data, so review.

6. podaac/cmr-mcp - https://github.com/podaac/cmr-mcp
   - Older local CMR/Earthaccess MCP from NASA PO.DAAC, run with uv. Supersededish by nasa/earthdata-mcp.
   - Trust: MEDIUM-HIGH (NASA-affiliated org); stars/dates unverified.

7. datalayer/earthdata-mcp-server (and datalayer/jupyter-earth-mcp-server) - https://github.com/datalayer/earthdata-mcp-server
   - Community Earthdata discovery/retrieval and Jupyter geospatial tools. Seen only in aggregator listings; not fetched.
   - Trust: MEDIUM-LOW until inspected.

8. aliafsahnoudeh/wildfire-mcp-server - https://github.com/aliafsahnoudeh/wildfire-mcp-server
   - Tools: FIRMS hotspots by date, reverse geocode, weather forecast, air pollution, fuel check. 2 stars, 53 commits.
   - Trust: LOW-MEDIUM. Custom "Evaluation and Non-Production" licence: production use needs written approval. Fine as reference/inspiration, risky to depend on.

## Other mentions (not verified)
- beita6969/scienceclaw geospatial-analysis skill (GIS, spatial stats, NDVI) - aggregator listing only. Trust LOW until read.
- Dhenenjay/earth-engine-mcp - Google Earth Engine MCP; needs GEE credentials; probably out of scope.
- Katzilla (glama.ai/mcp/servers/codeislaw101/katzilla) - hosted hazards API incl. FIRMS; third-party hosted service, sends your queries off-box; LOW trust.
- GDAL MCP, DuckDB geospatial MCP - appeared in listings, unvalidated.
- Aggregators used (not authoritative): lobehub.com/mcp, mcpmarket.com, glama.ai, claudemarketplaces.com, awesomeskills.dev.

## Gaps
- No dedicated plotly, Leaflet, pandas/scipy, or pitch-writing skill found; use anthropics/skills (pptx, frontend-design) and the K-Dense scientific-slides/writing skills instead.
- Direct FIRMS API (https://firms.modaps.eosdis.nasa.gov/api/) with a free MAP_KEY via plain pandas may be simpler and safer than any MCP.
