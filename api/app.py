from flask import Flask, jsonify, request
from pathlib import Path
import subprocess
import json

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
DATA_DIR = ROOT / "data"
FRONTEND = ROOT / "frontend"

BINARY = BACKEND / "ambulance_cli"

app = Flask(
    __name__,
    static_folder=str(FRONTEND),
    static_url_path=""
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
    """Compile the C backend if its source files have changed."""

    paths = [BACKEND / name for name in SOURCES]

    for path in paths:
        if not path.exists():
            raise RuntimeError(f"Missing C source file: {path.name}")

    if not (DATA_DIR / "nodes.csv").exists():
        raise RuntimeError("Missing data/nodes.csv")

    if not (DATA_DIR / "edges.csv").exists():
        raise RuntimeError("Missing data/edges.csv")

    needs_compile = (
        not BINARY.exists()
        or any(path.stat().st_mtime > BINARY.stat().st_mtime
               for path in paths)
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
    """Run the C program and parse its JSON output."""

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


@app.get("/")
def home():
    return app.send_static_file("index.html")


@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "Ambulance Route Optimization API"
    })
@app.post("/api/mst")
def minimum_spanning_tree():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "Request body must be a JSON object"
        }), 400

    algorithm = data.get("algorithm", "prim")

    if algorithm not in {"prim", "kruskal"}:
        return jsonify({
            "error": "Invalid MST algorithm",
            "allowed": ["prim", "kruskal"]
        }), 400

    try:
        result = run_c("mst", algorithm)
        return jsonify(result)

    except subprocess.TimeoutExpired:
        return jsonify({
            "error": "MST computation timed out"
        }), 504

    except RuntimeError as exc:
        app.logger.exception("MST request failed")
        return jsonify({"error": str(exc)}), 500
@app.get("/api/graph")
def graph():
    try:
        result = run_c("graph")
        return jsonify(result)

    except (RuntimeError, subprocess.TimeoutExpired) as exc:
        app.logger.exception("Graph request failed")
        return jsonify({"error": str(exc)}), 500


@app.post("/api/route")
def route():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "Request body must be a JSON object"
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
            )
        }), 400

    coordinates = [
        source_lat,
        source_lon,
        destination_lat,
        destination_lon,
    ]

    import math

    if not all(math.isfinite(value) for value in coordinates):
        return jsonify({
            "error": "Coordinates must be finite numbers"
        }), 400

    if not (-90 <= source_lat <= 90
            and -90 <= destination_lat <= 90
            and -180 <= source_lon <= 180
            and -180 <= destination_lon <= 180):
        return jsonify({
            "error": "Coordinates are outside valid ranges"
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

        status_code = 200 if result.get("found") else 404
        return jsonify(result), status_code

    except subprocess.TimeoutExpired:
        return jsonify({
            "error": "Routing computation timed out"
        }), 504

    except RuntimeError as exc:
        app.logger.exception("Routing request failed")
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5001,
        debug=False,
    )