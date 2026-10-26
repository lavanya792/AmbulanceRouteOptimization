import csv
from pathlib import Path

import osmnx as ox

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

GRAPH_FILE = DATA_DIR / "faridabad_roads.graphml"
NODES_FILE = DATA_DIR / "nodes.csv"
EDGES_FILE = DATA_DIR / "edges.csv"

if not GRAPH_FILE.exists():
    raise FileNotFoundError(
        f"Road graph not found: {GRAPH_FILE}\n"
        "Run python api/download_roads.py first."
    )

print("Loading Faridabad road network...")

G = ox.load_graphml(filepath=GRAPH_FILE)

# Give each intersection a compact integer ID for C.
node_ids = {
    original_id: index
    for index, original_id in enumerate(G.nodes())
}

# Export intersections.
with NODES_FILE.open("w", newline="", encoding="utf-8") as file:
    writer = csv.writer(file)

    writer.writerow(["id", "osm_id", "latitude", "longitude"])

    for original_id, node in G.nodes(data=True):
        writer.writerow([
            node_ids[original_id],
            original_id,
            node["y"],
            node["x"]
        ])

# Export road segments.
with EDGES_FILE.open("w", newline="", encoding="utf-8") as file:
    writer = csv.writer(file)

    writer.writerow([
        "from",
        "to",
        "length_m",
        "road_name",
        "highway"
    ])

    for u, v, key, edge in G.edges(keys=True, data=True):
        writer.writerow([
            node_ids[u],
            node_ids[v],
            float(edge.get("length", 1.0)),
            str(edge.get("name", "")),
            str(edge.get("highway", ""))
        ])

print("\nExport completed!")
print(f"Intersections: {len(G.nodes):,}")
print(f"Road segments: {len(G.edges):,}")
print(f"Nodes file: {NODES_FILE}")
print(f"Edges file: {EDGES_FILE}")