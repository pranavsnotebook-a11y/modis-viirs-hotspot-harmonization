from pathlib import Path
import pandas as pd
from .schema import normalize


def load_firms(path: str | Path, sensor: str) -> pd.DataFrame:
    """Load a FIRMS CSV and return it in the common schema."""
    return normalize(pd.read_csv(path), sensor)
