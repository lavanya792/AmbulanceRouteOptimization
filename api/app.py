from flask import Flask, jsonify, request
from flask_cors import CORS
from pathlib import Path
from functools import lru_cache
import subprocess
import json
import csv
import math
ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
DATA_DIR = ROOT / "data"
FRONTEND = ROOT / "frontend"
NODES_FILE = DATA_DIR / "nodes.csv"
EDGES_FILE = DATA_DIR / "edges.csv"
BINARY = BACKEND / "ambulance_cli"
app = Flask(
    __name__,
    static_folder=str(FRONTEND),
    static_url_path=""
)
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "https://lavanya792.github.io"
            ]
        }
    }
)
SOURCES = [
    "main.c",
    "graph.c",
    "dijkstra.c",
    "astar.c",
    "bellman_ford.c",
    "prim.c",
    "kruskal.c",
]
def compile_c():
    """Compile the C backend if source files have changed."""
    paths = [BACKEND / name for name in SOURCES]
    for path in paths:
        if not path.exists():
            raise RuntimeError(
                f"Missing C source file: {path.name}"
            )
    for path in (NODES_FILE, EDGES_FILE):
        if not path.exists():
            raise RuntimeError(
                f"Missing required data file: {path}"
            )
    needs_compile = (
        not BINARY.exists()
        or any(
            path.stat().st_mtime > BINARY.stat().st_mtime
            for path in paths
        )
    )
    if needs_compile:
        command = [
            "gcc",
            "-std=c11",
            "-O2",
            "-Wall",
            "-Wextra",
            "-o",
            str(BINARY),
        ]
        command.extend(str(path) for path in paths)
        command.append("-lm")
        result = subprocess.run(
            command,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=180,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "C compilation failed:\n" + result.stderr
            )
        if result.stderr.strip():
            app.logger.warning(
                "C compiler messages:\n%s",
                result.stderr
            )
    return BINARY
def run_c(*args):
    """Run the C backend and parse its JSON output."""
    binary = compile_c()
    result = subprocess.run(
        [str(binary), *map(str, args)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(
            result.stderr.strip()
            or "C backend execution failed"
        )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            "C backend returned invalid JSON"
        ) from exc
@lru_cache(maxsize=1)
def load_nodes():
    """Load real road-node coordinates from nodes.csv."""
    nodes = []
    with NODES_FILE.open(
        "r",
        newline="",
        encoding="utf-8-sig"
    ) as file:
        reader = csv.DictReader(file)
        required = {"id", "latitude", "longitude"}
        if (
            not reader.fieldnames
            or not required.issubset(reader.fieldnames)
        ):
            raise RuntimeError(
                "nodes.csv must contain id, latitude, longitude"
            )
        for row in reader:
            try:
                node_id = int(row["id"])
                lat = float(row["latitude"])
                lon = float(row["longitude"])
            except (TypeError, ValueError):
                continue
            if not (
                math.isfinite(lat)
                and math.isfinite(lon)
                and -90 <= lat <= 90
                and -180 <= lon <= 180
            ):
                continue
            nodes.append({
                "id": node_id,
                "lat": lat,
                "lon": lon,
            })
    return nodes
@lru_cache(maxsize=1)
def load_edges():
    """Load real road connections from edges.csv."""
    edges = []
    with EDGES_FILE.open(
        "r",
        newline="",
        encoding="utf-8-sig"
    ) as file:
        reader = csv.DictReader(file)
        required = {"from", "to", "length_m"}
        if (
            not reader.fieldnames
            or not required.issubset(reader.fieldnames)
        ):
            raise RuntimeError(
                "edges.csv must contain from, to, length_m"
            )
        for row in reader:
            try:
                source = int(row["from"])
                target = int(row["to"])
                length = float(row["length_m"])
            except (TypeError, ValueError):
                continue
            if (
                source == target
                or not math.isfinite(length)
                or length < 0
            ):
                continue
            edges.append({
                "from": source,
                "to": target,
                "length_m": length,
            })
    return edges
@app.get("/")
def home():
    """Serve the frontend."""
    return app.send_static_file("index.html")
@app.get("/api/health")
def health():
    """Check whether the API is running."""
    return jsonify({
        "status": "ok",
        "service": "Ambulance Route Optimization API",
    })
@app.get("/api/graph")
def graph():
    """Return graph statistics and optional road geometry."""
    try:
        summary = run_c("graph")
        if not summary.get("success"):
            return jsonify(summary), 500
        response = {
            "success": True,
            "vertices": int(summary.get("vertices", 0)),
            "edges": int(summary.get("edges", 0)),
        }
        if (
            request.args.get("include", "").lower()
            == "geometry"
        ):
            response["nodes"] = load_nodes()
            response["edges"] = load_edges()
        return jsonify(response)
    except subprocess.TimeoutExpired:
        return jsonify({
            "success": False,
            "error": "Graph computation timed out",
        }), 504
    except (RuntimeError, OSError, csv.Error) as exc:
        app.logger.exception("Graph request failed")
        return jsonify({
            "success": False,
            "error": str(exc),
        }), 500
@app.post("/api/mst")
def minimum_spanning_tree():
    """
    Calculate Prim's or Kruskal's MST for a selected rectangle.
    Expected JSON:
    {
        "algorithm": "prim",
        "bounds": {
            "south": 28.4000,
            "west": 77.3000,
            "north": 28.4200,
            "east": 77.3300
        }
    }
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({
            "success": False,
            "error": "Request body must be a JSON object",
        }), 400
    algorithm = data.get("algorithm", "prim")
    if algorithm not in {"prim", "kruskal"}:
        return jsonify({
            "success": False,
            "error": "Invalid MST algorithm",
            "allowed": ["prim", "kruskal"],
        }), 400
    bounds = data.get("bounds")
    if not isinstance(bounds, dict):
        return jsonify({
            "success": False,
            "error": (
                "Select an area on the map first. "
                "Provide bounds with south, west, north and east."
            ),
        }), 400
    try:
        south = float(bounds["south"])
        west = float(bounds["west"])
        north = float(bounds["north"])
        east = float(bounds["east"])
    except KeyError as exc:
        return jsonify({
            "success": False,
            "error": (
                f"Missing area coordinate: {exc.args[0]}"
            ),
        }), 400
    except (TypeError, ValueError):
        return jsonify({
            "success": False,
            "error": "Area coordinates must be numeric.",
        }), 400
    coordinates = [south, west, north, east]
    if not all(
        math.isfinite(value) for value in coordinates
    ):
        return jsonify({
            "success": False,
            "error": "Area coordinates must be finite numbers.",
        }), 400
    if not (
        -90 <= south < north <= 90
    ):
        return jsonify({
            "success": False,
            "error": (
                "Latitude bounds must satisfy "
                "-90 <= south < north <= 90."
            ),
        }), 400
    if not (
        -180 <= west < east <= 180
    ):
        return jsonify({
            "success": False,
            "error": (
                "Longitude bounds must satisfy "
                "-180 <= west < east <= 180."
            ),
        }), 400
    try:
        result = run_c(
            "mst_area",
            algorithm,
            south,
            west,
            north,
            east,
        )
        if not result.get("success"):
            return jsonify(result), 400
        return jsonify(result)
    except subprocess.TimeoutExpired:
        return jsonify({
            "success": False,
            "error": "MST computation timed out",
        }), 504
    except (RuntimeError, OSError) as exc:
        app.logger.exception(
            "Selected-area MST request failed"
        )
        return jsonify({
            "success": False,
            "error": str(exc),
        }), 500
@app.post("/api/route")
def route():
    """Find an ambulance route using the selected algorithm."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({
            "error": "Request body must be a JSON object",
        }), 400
    algorithm = data.get("algorithm", "dijkstra")
    allowed = {
        "dijkstra",
        "astar",
        "bellman_ford",
    }
    if algorithm not in allowed:
        return jsonify({
            "error": "Invalid routing algorithm",
            "allowed": sorted(allowed),
        }), 400
    try:
        source_lat = float(data["source_lat"])
        source_lon = float(data["source_lon"])
        destination_lat = float(data["destination_lat"])
        destination_lon = float(data["destination_lon"])
    except (KeyError, TypeError, ValueError):
        return jsonify({
            "error": (
                "Provide source_lat, source_lon, "
                "destination_lat and destination_lon "
                "as numeric coordinates"
            ),
        }), 400
    coordinates = [
        source_lat,
        source_lon,
        destination_lat,
        destination_lon,
    ]
    if not all(
        math.isfinite(value) for value in coordinates
    ):
        return jsonify({
            "error": "Coordinates must be finite numbers",
        }), 400
    if not (
        -90 <= source_lat <= 90
        and -90 <= destination_lat <= 90
        and -180 <= source_lon <= 180
        and -180 <= destination_lon <= 180
    ):
        return jsonify({
            "error": "Coordinates are outside valid ranges",
        }), 400
    try:
        result = run_c(
            "route",
            algorithm,
            source_lat,
            source_lon,
            destination_lat,
            destination_lon,
        )
        status_code = (
            200 if result.get("found") else 404
        )
        return jsonify(result), status_code
    except subprocess.TimeoutExpired:
        return jsonify({
            "error": "Routing computation timed out",
        }), 504
    except (RuntimeError, OSError) as exc:
        app.logger.exception("Routing request failed")
        return jsonify({
            "error": str(exc),
        }), 500
if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5001,
        debug=False,
    )