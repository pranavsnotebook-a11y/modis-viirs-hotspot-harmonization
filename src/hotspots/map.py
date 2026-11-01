"""python -m hotspots.map data/harmonized.csv out.html -- interactive map by detection source."""
import sys
import pandas as pd
import plotly.express as px


def main(argv=None):
    a = argv or sys.argv[1:]
    df = pd.read_csv(a[0])
    df["frp_any"] = df.viirs_frp.fillna(df.modis_frp).clip(lower=0.1)
    if len(df) > 60000:  # keep the HTML light: keep all 'both', sample the rest
        both = df[df.detected_by == "both"]
        df = pd.concat([both, df[df.detected_by != "both"].sample(60000 - len(both), random_state=0)])
    fig = px.scatter_geo(df, lat="latitude", lon="longitude", color="detected_by",
                         size="frp_any", size_max=8, opacity=0.6,
                         color_discrete_map={"both": "#d62728", "viirs": "#1f77b4", "modis": "#ff7f0e"},
                         hover_data=["sensor", "frp_any", "conf_class", "time"],
                         title="MODIS / VIIRS harmonized hot spots")
    fig.write_html(a[1], include_plotlyjs="cdn")


if __name__ == "__main__":
    main()
