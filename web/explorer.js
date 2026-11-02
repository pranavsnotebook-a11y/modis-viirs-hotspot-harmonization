const PRESETS = {"Global":[-90,90,-180,180],"North America":[15,72,-170,-50],"South America":[-56,15,-92,-34],
 "Europe":[35,72,-12,40],"Africa":[-35,37,-18,52],"Asia":[-10,75,40,150],"Oceania":[-50,-10,110,180],
 "California":[32,42,-125,-114],"Amazon basin":[-15,5,-75,-50],"Central Africa":[-15,10,10,35]};
const $ = id => document.getElementById(id);
const COLORSCALE = "Viridis"; // colour-blind-safe, perceptually uniform
let D, map, layer;

const med = a => { const s=[...a].sort((x,y)=>x-y), n=s.length; return n? (n%2? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2) : 0; };
const csvDl = (name, rows) => { const b=new Blob([rows.map(r=>r.join(",")).join("\n")],{type:"text/csv"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=name; a.click(); };

function sel() {
  const [la0,la1,lo0,lo1] = ["la0","la1","lo0","lo1"].map(i=>+$(i).value);
  const d0=+$("d0").value, d1=+$("d1").value, k=D.cols.indexOf($("metric").value);
  const rows = D.cells.filter(c => c[0]>=d0 && c[0]<=d1 && c[1]>=Math.floor(la0) && c[1]<Math.ceil(la1) && c[2]>=Math.floor(lo0) && c[2]<Math.ceil(lo1));
  return {rows,k,d0,d1};
}

function render() {
  const {rows,k,d0,d1} = sel(), metric=$("metric").selectedOptions[0].text;
  const perDay = D.days.map(()=>Array(4).fill(0));
  D.cells.forEach(c => { if (c[1]>=Math.floor(+$("la0").value) && c[1]<Math.ceil(+$("la1").value) && c[2]>=Math.floor(+$("lo0").value) && c[2]<Math.ceil(+$("lo1").value)) { for(let j=0;j<4;j++) perDay[c[0]][j]+=c[3+j]; }});
  const series = perDay.map(p=>p[k-3]), idx = D.days.map((_,i)=>i).filter(i=>i>=d0&&i<=d1);
  const total = idx.reduce((s,i)=>s+series[i],0);
  $("status").textContent = `${total.toLocaleString()} ${metric.toLowerCase()} in region, ${D.days[d0]} to ${D.days[d1]}. Note: last day may be partial.`;

  // map: cells aggregated over date range
  layer.clearLayers(); const agg={};
  rows.forEach(c=>{const key=c[1]+","+c[2]; agg[key]=(agg[key]||0)+c[k];});
  const mx=Math.max(1,...Object.values(agg));
  Object.entries(agg).forEach(([key,v])=>{const [la,lo]=key.split(",").map(Number);
    L.circleMarker([la+.5,lo+.5],{radius:3+9*Math.sqrt(v/mx),color:"#440154",weight:1,fillColor:"#fde725",fillOpacity:.7})
     .bindTooltip(`${v} in 1° cell (${la},${lo})`).addTo(layer);});

  // calendar: month x year if span >= 2 years else week x weekday
  const spanYears = new Set(D.days.map(d=>d.slice(0,4))).size;
  if (spanYears >= 2) {
    const years=[...new Set(D.days.map(d=>d.slice(0,4)))], z=years.map(()=>Array(12).fill(null));
    D.days.forEach((d,i)=>{ if(i>=d0&&i<=d1){const y=years.indexOf(d.slice(0,4)), m=+d.slice(5,7)-1; z[y][m]=(z[y][m]||0)+series[i];}});
    $("calt").textContent = "Burning activity calendar (month × year)";
    Plotly.react("cal",[{z,x:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],y:years,type:"heatmap",colorscale:COLORSCALE,colorbar:{title:"count"}}],{margin:{t:10,l:50,r:10,b:40},height:320},{responsive:true});
  } else {
    const dates=idx.map(i=>D.days[i]), wd=dates.map(d=>new Date(d+"T00:00:00Z").getUTCDay());
    const first=new Date(dates[0]+"T00:00:00Z"), wk=dates.map(d=>Math.floor((new Date(d+"T00:00:00Z")-first)/864e5+first.getUTCDay())/7|0);
    const nw=Math.max(...wk)+1, z=Array.from({length:7},()=>Array(nw).fill(null)), t=Array.from({length:7},()=>Array(nw).fill(""));
    dates.forEach((d,j)=>{z[wd[j]][wk[j]]=series[idx[j]]; t[wd[j]][wk[j]]=d;});
    $("calt").textContent = "Activity calendar (day grid; shows month × year once ≥ 2 years of data are loaded)";
    Plotly.react("cal",[{z,text:t,hovertemplate:"%{text}: %{z}<extra></extra>",x:[...Array(nw).keys()].map(w=>"wk "+(w+1)),y:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],type:"heatmap",colorscale:COLORSCALE,colorbar:{title:"count"}}],{margin:{t:10,l:40,r:10,b:40},height:320,yaxis:{autorange:"reversed"}},{responsive:true});
  }

  // anomaly vs median of the other loaded days
  const base=med(idx.map(i=>series[i])), anom=idx.map(i=>base? 100*(series[i]-base)/base : 0);
  Plotly.react("anom",[{x:idx.map(i=>D.days[i]),y:anom,type:"bar",marker:{color:anom.map(a=>a>=0?"#d95f02":"#1b9e77")},hovertemplate:"%{x}: %{y:.1f}% vs median<extra></extra>"}],
   {margin:{t:10,l:50,r:10,b:40},height:320,yaxis:{title:"% vs median of selected days"},annotations:[{xref:"paper",yref:"paper",x:0,y:1.1,showarrow:false,text:`baseline median = ${Math.round(base).toLocaleString()} (${idx.length} days only)`}]},{responsive:true});

  // sensor comparison
  const sums=[0,1,2].map(j=>idx.reduce((s,i)=>s+perDay[i][j],0)), vo=idx.reduce((s,i)=>s+perDay[i][3],0);
  const ratio=sums[0]?(sums[1]/sums[0]).toFixed(2):"n/a";
  Plotly.react("cmp",[{x:["MODIS","VIIRS (NOAA-20+21)","Combined detections"],y:sums,type:"bar",marker:{color:["#ff7f0e","#1f77b4","#7570b3"]}}],
   {margin:{t:30,l:60,r:10,b:40},height:320,yaxis:{title:"detections"},title:{text:`Raw pixel counts — VIIRS/MODIS = ${ratio} (2 VIIRS vs 2 MODIS satellites)`,font:{size:13}}},{responsive:true});
  $("gap").textContent=sums[1]?`${(100*vo/sums[1]).toFixed(1)}% of VIIRS pixels here had no overlapping MODIS detection the same day. This is not the share of fire MODIS can never see: overpass time, cloud and matching distance all move it (NOAA-20 global: 82% with no buffer, 60% with a 5 km buffer).`:"";

  $("dl1").onclick=()=>csvDl("daily_counts.csv",[["date","modis","viirs","combined_detections","viirs_no_modis_same_day"],...idx.map(i=>[D.days[i],...perDay[i]])]);
  $("dl2").onclick=()=>csvDl("cells.csv",[["date","lat_cell","lon_cell","modis","viirs","combined_detections","viirs_no_modis_same_day"],...rows.map(c=>[D.days[c[0]],...c.slice(1)])]);
}

fetch("data.json").then(r=>r.json()).then(d=>{
  D=d; $("sub").textContent=`${D.days.length} days (${D.days[0]} → ${D.days.at(-1)}), 1° cells. Combined detections = VIIRS pixels plus MODIS pixels with no overlapping VIIRS pixel that day. Pixels, not fires.`;
  $("preset").innerHTML=Object.keys(PRESETS).map(n=>`<option>${n}</option>`).join("");
  const tot=D.days.map((_,i)=>D.cells.reduce((s,c)=>s+(c[0]===i?c[5]:0),0)), partial=tot.at(-1)<0.5*med(tot);
  const lastDay=partial&&D.days.length>2?D.days.length-2:D.days.length-1;  // default-exclude a clearly partial final day
  ["d0","d1"].forEach((id,j)=>{$(id).innerHTML=D.days.map((x,i)=>`<option value="${i}" ${i==(j?lastDay:0)?"selected":""}>${x}${partial&&i==D.days.length-1?" (partial)":""}</option>`).join("");});
  const setBox=b=>{["la0","la1","lo0","lo1"].forEach((id,i)=>$(id).value=b[i]);};
  setBox(PRESETS.Global);
  map=L.map("emap").setView([20,0],2); L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(map); layer=L.layerGroup().addTo(map);
  $("preset").onchange=()=>{const b=PRESETS[$("preset").value]; setBox(b); map.fitBounds([[b[0],b[2]],[b[1],b[3]]]); render();};
  $("usemap").onclick=()=>{const b=map.getBounds(); setBox([Math.max(-90,b.getSouth()).toFixed(0),Math.min(90,b.getNorth()).toFixed(0),Math.max(-180,b.getWest()).toFixed(0),Math.min(180,b.getEast()).toFixed(0)]); render();};
  document.querySelectorAll(".controls select, .controls input").forEach(e=>e.id!=="preset"&&e.addEventListener("change",render));
  render();
});
