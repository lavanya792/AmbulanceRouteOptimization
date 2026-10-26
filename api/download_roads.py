import time
from pathlib import Path

import osmnx as ox

# Project directories
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

OUTPUT_FILE = DATA_DIR / "faridabad_roads.graphml"

# Faridabad city-centre coordinates
CENTER_LAT = 28.4089
CENTER_LON = 77.3178

# Start with a manageable 3 km radius
RADIUS_METERS = 3000

ox.settings.use_cache = True
ox.settings.log_console = True
ox.settings.requests_timeout = 180

if OUTPUT_FILE.exists():
    print(f"Existing graph found: {OUTPUT_FILE}")
    print("Delete it only if you intentionally want to download fresh data.")
    raise SystemExit(0)

for attempt in range(1, 5):
    try:
        print(
            f"Downloading Faridabad road network "
            f"(attempt {attempt}/4)..."
        )

        graph = ox.graph_from_point(
            (CENTER_LAT, CENTER_LON),
            dist=RADIUS_METERS,
            network_type="drive",
            simplify=True
        )

        if len(graph.nodes) == 0:
            raise RuntimeError("The downloaded road graph is empty.")

        ox.save_graphml(graph, filepath=OUTPUT_FILE)

        print("\nDownload successful!")
        print(f"Intersections: {len(graph.nodes)}")
        print(f"Road segments: {len(graph.edges)}")
        print(f"Saved to: {OUTPUT_FILE}")

        break

    except Exception as error:
        print(f"Attempt {attempt} failed: {error}")

        if attempt == 4:
            print(
                "\nThe road data could not be downloaded after four attempts."
            )
            print(
                "This is likely a temporary Overpass server issue. "
                "Wait before trying again."
            )
            raise SystemExit(1)

        wait_seconds = 15 * (2 ** (attempt - 1))
        print(f"Waiting {wait_seconds} seconds before retrying...")
        time.sleep(wait_seconds)