const COL = {viirs: "#1f77b4", modis: "#e08a00", both: "#d62728"};
const LBL = {viirs: "VIIRS only", modis: "MODIS only", both: "Both sensors"};
fetch("sample.json").then(r => r.json()).then(d => {
  const total = d.counts.viirs + d.counts.modis + d.counts.both;
  document.getElementById("sub").textContent =
    `${total.toLocaleString()} detections (full data); ${d.rows.length.toLocaleString()} plotted`;
  document.getElementById("counts").innerHTML = ["both", "viirs", "modis"].map(k =>
    `<div class="card" style="border-color:${COL[k]}"><b>${d.counts[k].toLocaleString()}</b>${LBL[k]}</div>`).join("");

  const map = L.map("map", {preferCanvas: true}).setView([20, 10], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {maxZoom: 12, attribution: "&copy; OpenStreetMap"}).addTo(map);
  const layers = {};
  for (const k of ["viirs", "modis", "both"]) layers[k] = L.layerGroup().addTo(map);
  for (const [lat, lon, k, frp, mfrp, t] of d.rows) {
    L.circleMarker([lat, lon], {radius: k === "both" ? 4 : 2.5, color: COL[k], weight: 1, fillOpacity: .6})
      .bindPopup(`${LBL[k]}<br>FRP ${frp ?? "n/a"} MW${mfrp ? `<br>MODIS FRP ${mfrp} MW` : ""}<br>${t} UTC`)
      .addTo(layers[k]);
  }
  const ov = {}; for (const k in layers) ov[`<span style="color:${COL[k]}">&#9679;</span> ${LBL[k]}`] = layers[k];
  L.control.layers(null, ov, {collapsed: false}).addTo(map);

  const e = d.hist_edges, mid = e.slice(0, -1).map((v, i) => Math.sqrt(v * e[i + 1]));
  Plotly.newPlot("hist", ["MODIS", "VIIRS"].map(s => ({
    x: mid, y: d.hist[s], type: "bar", name: s, opacity: .65,
    marker: {color: s === "MODIS" ? COL.modis : COL.viirs}})),
    {title: "FRP per detection, by sensor (full data)", barmode: "overlay",
     xaxis: {type: "log", title: "FRP (MW, log scale)"}, yaxis: {title: "detections", type: "log"},
     legend: {orientation: "h"}, margin: {t: 40}}, {responsive: true});
}).catch(e => document.getElementById("sub").textContent = "Failed to load sample.json: " + e);
