"use strict";

// ============================================================
// Vitalane — Emergency route command (Faridabad)
// Uses the existing Flask endpoints: /api/graph, /api/route, /api/mst
// ============================================================

const DEFAULT_SOURCE = { lat: 28.4089, lng: 77.3178 };
const DEFAULT_DESTINATION = { lat: 28.4212, lng: 77.3070 };
const AMBULANCE_SPEED_KMH = 45; // used only for the estimated arrival time

const COLORS = {
    route: "#ff4b2b",
    routeCasing: "#0d2b2a",
    road: "#1f5c57",
    node: "#0d2b2a",
    mst: "#6d4aff",
    area: "#6d4aff"
};

let map = null;
let sourceMarker = null;
let destinationMarker = null;
let routeLayer = null;
let routeCasing = null;
let mstLayer = null;
let ambulanceMarker = null;
let ambulanceAnimation = null;
let lastRouteCoordinates = [];
let nodeLayer = null;
let roadLayer = null;
let graphData = null;
let clickMode = "source";

let mstAreaSelectionMode = false;
let mstAreaFirstCorner = null;
let mstAreaBounds = null;
let mstAreaRectangle = null;
let mstSelectionMarkers = [];

const sourceSelect = document.getElementById("source");
const destinationSelect = document.getElementById("destination");

// ---------- Utilities ----------

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function updateStatus(message) {
    setText("message", message);
    console.log("[Vitalane]", message);
}

function getCoordinates(marker) {
    const p = marker.getLatLng();
    return { lat: p.lat, lng: p.lng };
}

function formatDistance(distance) {
    const v = Number(distance);
    if (!Number.isFinite(v)) return "—";
    return v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${v.toFixed(0)} m`;
}

function formatAlgorithm(algorithm) {
    return String(algorithm || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
}

function formatEta(distanceM) {
    const v = Number(distanceM);
    if (!Number.isFinite(v) || v <= 0) return "—";
    const seconds = Math.round(v / (AMBULANCE_SPEED_KMH / 3.6));
    if (seconds < 60) return `${seconds} sec`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes} min ${rest}s` : `${minutes} min`;
}

const getNodeLatitude = node => Number(node.lat ?? node.latitude);
const getNodeLongitude = node => Number(node.lon ?? node.lng ?? node.longitude);

function validCoordinates(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) &&
        Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function pinIcon(kind, letter) {
    return L.divIcon({
        className: "pin-icon",
        html: `<div class="pin pin-${kind}"><span>${letter}</span></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34]
    });
}

// ---------- Tabs ----------

function initTabs() {
    const tabs = document.querySelectorAll(".tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => {
                const active = t === tab;
                t.classList.toggle("is-active", active);
                t.setAttribute("aria-selected", String(active));
                document.getElementById(`pane-${t.dataset.tab}`).hidden = !active;
            });
        });
    });
}

// ---------- Source / destination controls ----------

function updateSelect(select, position, label) {
    if (!select) return;
    const value = `${position.lat.toFixed(7)},${position.lng.toFixed(7)}`;
    let option = select.querySelector('option[data-custom="true"]');
    if (!option) {
        option = document.createElement("option");
        option.dataset.custom = "true";
        select.appendChild(option);
    }
    option.value = value;
    option.textContent = `${label} (${position.lat.toFixed(5)}, ${position.lng.toFixed(5)})`;
    select.value = value;
}

function syncControls() {
    if (!sourceMarker || !destinationMarker) return;
    updateSelect(sourceSelect, getCoordinates(sourceMarker), "Start");
    updateSelect(destinationSelect, getCoordinates(destinationMarker), "Destination");
}

function readCoordinates(select, marker) {
    if (select && select.value) {
        const v = select.value.split(",").map(Number);
        if (v.length === 2 && v.every(Number.isFinite) &&
            Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180) {
            return { lat: v[0], lng: v[1] };
        }
    }
    return getCoordinates(marker);
}

// ---------- Clear route / animation ----------

function stopAmbulanceAnimation(removeMarker = true) {
    if (ambulanceAnimation !== null) {
        cancelAnimationFrame(ambulanceAnimation);
        ambulanceAnimation = null;
    }
    if (removeMarker && ambulanceMarker && map) {
        map.removeLayer(ambulanceMarker);
        ambulanceMarker = null;
    }
}

function clearRoute() {
    stopAmbulanceAnimation();
    lastRouteCoordinates = [];
    for (const layer of [routeLayer, routeCasing]) {
        if (layer && map) map.removeLayer(layer);
    }
    routeLayer = null;
    routeCasing = null;
    setText("routeCost", "—");
    setText("etaValue", "—");
    setText("nodesExplored", "—");
    setText("executionTime", "—");
    setText("routeStatus", "Ready");
    const replay = document.getElementById("replayAmbulance");
    if (replay) replay.disabled = true;
}

function clearMST() {
    if (mstLayer && map) {
        map.removeLayer(mstLayer);
        mstLayer = null;
    }
    setText("mstNodeCount", "—");
    setText("mstEdgeCount", "—");
    setText("mstTotalWeight", "—");
    setText("mstResultAlgorithm", "—");
}

// ---------- Area MST selection ----------

function clearMSTArea() {
    mstAreaSelectionMode = false;
    mstAreaFirstCorner = null;
    mstAreaBounds = null;
    if (mstAreaRectangle && map) {
        map.removeLayer(mstAreaRectangle);
        mstAreaRectangle = null;
    }
    for (const m of mstSelectionMarkers) {
        if (map) map.removeLayer(m);
    }
    mstSelectionMarkers = [];
    clearMST();
    const btn = document.getElementById("selectMSTArea");
    if (btn) {
        btn.textContent = "Select MST area";
        btn.disabled = false;
    }
    setText("mstAreaStatus", "Select an area, then click two opposite corners on the map.");
}

function startMSTAreaSelection() {
    clearMSTArea();
    mstAreaSelectionMode = true;
    const btn = document.getElementById("selectMSTArea");
    if (btn) btn.textContent = "Selecting area...";
    setText("mstAreaStatus", "Click the first corner of your area on the map.");
    updateStatus("Area selection on. Click the first corner on the map.");
}

function cornerMarker(latlng) {
    return L.circleMarker(latlng, {
        radius: 7, color: "#ffffff", weight: 2,
        fillColor: COLORS.area, fillOpacity: 1
    }).addTo(map);
}

function handleMSTAreaClick(latlng) {
    if (!mstAreaSelectionMode) return;

    if (!mstAreaFirstCorner) {
        mstAreaFirstCorner = latlng;
        mstSelectionMarkers.push(cornerMarker(latlng));
        setText("mstAreaStatus", "First corner set. Click the opposite corner.");
        updateStatus("First corner set. Click the opposite corner.");
        return;
    }

    const first = mstAreaFirstCorner;
    const south = Math.min(first.lat, latlng.lat);
    const north = Math.max(first.lat, latlng.lat);
    const west = Math.min(first.lng, latlng.lng);
    const east = Math.max(first.lng, latlng.lng);

    if (south === north || west === east) {
        setText("mstAreaStatus", "Pick a second corner that gives the rectangle a width and a height.");
        updateStatus("Invalid rectangle. Click another point for the second corner.");
        return;
    }

    mstAreaBounds = { south, west, north, east };
    mstAreaRectangle = L.rectangle([[south, west], [north, east]], {
        color: COLORS.area, weight: 2,
        fillColor: COLORS.area, fillOpacity: 0.1, dashArray: "6, 5"
    }).addTo(map);
    mstSelectionMarkers.push(cornerMarker(latlng));
    mstAreaSelectionMode = false;

    const btn = document.getElementById("selectMSTArea");
    if (btn) btn.textContent = "Change MST area";
    setText("mstAreaStatus",
        `Area set: ${south.toFixed(5)}, ${west.toFixed(5)} to ${north.toFixed(5)}, ${east.toFixed(5)}.`);
    updateStatus("Area set. Choose Prim or Kruskal, then generate the MST.");
}

// ---------- Layer visibility ----------

function updateLayerVisibility() {
    if (!map) return;
    const nodesEnabled = document.getElementById("toggleNodes")?.checked ?? true;
    const roadsEnabled = document.getElementById("toggleRoads")?.checked ?? true;
    const zoom = map.getZoom();
    const showNodes = zoom >= 14;

    if (nodeLayer) {
        if (nodesEnabled && showNodes) {
            if (!map.hasLayer(nodeLayer)) nodeLayer.addTo(map);
        } else if (map.hasLayer(nodeLayer)) {
            map.removeLayer(nodeLayer);
        }
    }
    if (roadLayer) {
        if (roadsEnabled) {
            if (!map.hasLayer(roadLayer)) roadLayer.addTo(map);
        } else if (map.hasLayer(roadLayer)) {
            map.removeLayer(roadLayer);
        }
    }
    // keep results above the base network
    if (mstLayer && map.hasLayer(mstLayer)) mstLayer.eachLayer(l => l.bringToFront());
    if (routeCasing) routeCasing.bringToFront();
    if (routeLayer) routeLayer.bringToFront();

    setText("zoomLevel", zoom);
    if (nodesEnabled && !showNodes) {
        setText("networkStatus", "Zoom in for nodes");
    } else if (graphData) {
        setText("networkStatus", "Loaded");
    }
}

// ---------- Build road network layers ----------

function buildGraphLayers(data) {
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const edges = Array.isArray(data.edges) ? data.edges : [];

    if (nodes.length === 0) {
        setText("networkStatus", "No coordinates");
        console.error("The graph response contains no nodes.");
        return;
    }
    if (nodeLayer && map.hasLayer(nodeLayer)) map.removeLayer(nodeLayer);
    if (roadLayer && map.hasLayer(roadLayer)) map.removeLayer(roadLayer);

    nodeLayer = L.layerGroup();
    roadLayer = L.layerGroup();

    const nodeById = new Map();
    for (const node of nodes) nodeById.set(String(node.id), node);

    let validRoads = 0;
    for (const edge of edges) {
        let from, to;
        if (edge.from !== null && typeof edge.from === "object") {
            from = edge.from;
            to = edge.to;
        } else {
            from = nodeById.get(String(edge.from ?? edge.source));
            to = nodeById.get(String(edge.to ?? edge.target));
        }
        if (!from || !to) continue;

        const a = [getNodeLatitude(from), getNodeLongitude(from)];
        const b = [getNodeLatitude(to), getNodeLongitude(to)];
        if (!validCoordinates(...a) || !validCoordinates(...b)) continue;

        L.polyline([a, b], {
            color: COLORS.road, weight: 1.4, opacity: 0.55, interactive: false
        }).addTo(roadLayer);
        validRoads++;
    }

    for (const node of nodes) {
        const lat = getNodeLatitude(node);
        const lon = getNodeLongitude(node);
        if (!validCoordinates(lat, lon)) continue;
        L.circleMarker([lat, lon], {
            radius: 2.2, color: "#f5b400", weight: 0.8,
            fillColor: COLORS.node, fillOpacity: 0.95, interactive: false
        }).addTo(nodeLayer);
    }

    updateLayerVisibility();
    setText("networkStatus", validRoads === 0 ? "No valid roads" : "Loaded");
}

// ---------- Load graph from Flask ----------

async function loadNetworkStats() {
    setText("networkStatus", "Loading...");
    try {
        const response = await fetch("/api/graph?include=geometry");
        if (!response.ok) throw new Error(`Graph API returned HTTP ${response.status}`);
        const result = await response.json();
        if (result.success === false) {
            throw new Error(result.error || "Could not load the road graph.");
        }
        graphData = result;

        const nodes = Number(result.vertices ?? result.node_count ?? result.nodes?.length);
        const edges = Number(
            result.edges_count ?? result.edge_count ??
            (Array.isArray(result.edges) ? result.edges.length : NaN)
        );
        setText("totalNodes", Number.isFinite(nodes) ? nodes.toLocaleString() : "—");
        setText("totalEdges", Number.isFinite(edges) ? edges.toLocaleString() : "—");

        if (Array.isArray(result.nodes) && Array.isArray(result.edges)) {
            buildGraphLayers(result);
            updateStatus("Road network loaded. Place a start and destination, then find a route.");
        } else {
            setText("networkStatus", "No geometry");
            console.error("The graph API must return nodes and edges arrays (include=geometry).");
        }
    } catch (error) {
        console.error("Network loading error:", error);
        setText("networkStatus", "Unavailable");
        setText("totalNodes", "—");
        setText("totalEdges", "—");
        updateStatus(`Could not load the road network: ${error.message}`);
    }
}

// ---------- Ambulance animation ----------

function animateAmbulance(coordinates) {
    stopAmbulanceAnimation();
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        updateStatus("The route is too short to animate.");
        return;
    }
    const replay = document.getElementById("replayAmbulance");
    if (replay) replay.disabled = false;

    const icon = L.divIcon({
        className: "ambulance-div-icon",
        html: '<span class="ambulance-emoji" role="img" aria-label="Ambulance">🚑</span>',
        iconSize: [38, 38],
        iconAnchor: [19, 19]
    });
    ambulanceMarker = L.marker(coordinates[0], {
        icon, zIndexOffset: 1000, title: "Simulated ambulance"
    }).addTo(map);
    ambulanceMarker.bindTooltip("Ambulance en route", { direction: "top", offset: [0, -16] });

    const cumulative = [0];
    let total = 0;
    for (let i = 1; i < coordinates.length; i++) {
        total += L.latLng(coordinates[i - 1]).distanceTo(L.latLng(coordinates[i]));
        cumulative.push(total);
    }
    if (total <= 0) return;

    const durationMs = Math.min(18000, Math.max(5000, total * 2.5));
    let startTime = null;

    function step(timestamp) {
        if (startTime === null) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / durationMs, 1);
        const travelled = progress * total;

        let segment = 1;
        while (segment < cumulative.length - 1 && cumulative[segment] < travelled) segment++;

        const segStart = cumulative[segment - 1];
        const segLen = cumulative[segment] - segStart;
        const t = segLen > 0 ? (travelled - segStart) / segLen : 0;
        const from = coordinates[segment - 1];
        const to = coordinates[segment];
        ambulanceMarker.setLatLng([
            from[0] + (to[0] - from[0]) * t,
            from[1] + (to[1] - from[1]) * t
        ]);

        if (progress < 1) {
            ambulanceAnimation = requestAnimationFrame(step);
        } else {
            ambulanceAnimation = null;
            ambulanceMarker.setLatLng(coordinates[coordinates.length - 1]);
            ambulanceMarker.setTooltipContent("Ambulance arrived");
            ambulanceMarker.openTooltip();
            updateStatus("Ambulance arrived at the destination.");
        }
    }
    ambulanceAnimation = requestAnimationFrame(step);
}

// ---------- Route (Dijkstra / A* / Bellman-Ford) ----------

async function findRoute() {
    if (!map || !sourceMarker || !destinationMarker) {
        updateStatus("The map is not ready.");
        return;
    }
    const source = readCoordinates(sourceSelect, sourceMarker);
    const destination = readCoordinates(destinationSelect, destinationMarker);
    const algorithm = document.getElementById("algorithm").value;
    const button = document.getElementById("findRoute");

    setText("selectedAlgorithm", formatAlgorithm(algorithm));
    button.disabled = true;
    clearRoute();
    clearMST();
    setText("routeStatus", "Calculating...");
    updateStatus(`Calculating route with ${formatAlgorithm(algorithm)}...`);

    try {
        const response = await fetch("/api/route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                algorithm,
                source_lat: source.lat,
                source_lon: source.lng,
                destination_lat: destination.lat,
                destination_lon: destination.lng
            })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || result.message || "Routing request failed.");
        }
        if (!result.found || !Array.isArray(result.path) || result.path.length === 0) {
            setText("routeStatus", "No route");
            updateStatus(result.message || "No route was found between these points.");
            return;
        }

        const coordinates = result.path.map(n => [getNodeLatitude(n), getNodeLongitude(n)]);
        if (coordinates.some(p => !p.every(Number.isFinite))) {
            throw new Error("The server returned invalid route coordinates.");
        }

        const style = { lineCap: "round", lineJoin: "round" };
        routeCasing = L.polyline(coordinates, {
            ...style, color: COLORS.routeCasing, weight: 9, opacity: 0.9
        }).addTo(map);
        routeLayer = L.polyline(coordinates, {
            ...style, color: COLORS.route, weight: 5, opacity: 1
        }).addTo(map);
        routeCasing.bringToFront();
        routeLayer.bringToFront();
        lastRouteCoordinates = coordinates;
        map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });

        const distance = Number(result.distance_m ?? result.cost ?? 0);
        setText("routeCost", formatDistance(distance));
        setText("etaValue", formatEta(distance));
        setText("nodesExplored", Number(result.explored ?? 0).toLocaleString());
        setText("executionTime", `${Number(result.elapsed_ms ?? 0).toFixed(3)} ms`);
        setText("routeStatus", "Route found");
        updateStatus(
            `Route found with ${formatAlgorithm(algorithm)}: ${formatDistance(distance)}, ` +
            `about ${formatEta(distance)} at ${AMBULANCE_SPEED_KMH} km/h.`
        );
        animateAmbulance(coordinates);
    } catch (error) {
        console.error("Route calculation error:", error);
        setText("routeStatus", "Error");
        updateStatus(`Could not calculate route: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}

// ---------- Area MST ----------

async function showMST() {
    if (!map) {
        updateStatus("The map is not ready.");
        return;
    }
    if (!mstAreaBounds) {
        updateStatus("Select an area first with the Select MST area button.");
        setText("mstAreaStatus", "No area selected. Pick two opposite corners on the map.");
        return;
    }
    const button = document.getElementById("showMST");
    const algorithm = document.getElementById("mstAlgorithm").value;
    button.disabled = true;
    clearMST();
    stopAmbulanceAnimation();
    updateStatus(`Generating minimum spanning forest with ${formatAlgorithm(algorithm)}...`);

    try {
        const response = await fetch("/api/mst", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                algorithm,
                bounds: {
                    south: mstAreaBounds.south,
                    west: mstAreaBounds.west,
                    north: mstAreaBounds.north,
                    east: mstAreaBounds.east
                }
            })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || result.message ||
                `MST request failed with HTTP ${response.status}.`);
        }
        if (result.success === false) {
            throw new Error(result.error || "The MST algorithm failed.");
        }
        if (!Array.isArray(result.edges)) {
            throw new Error("The server response does not contain an edges array.");
        }

        if (result.edges.length === 0) {
            setText("mstNodeCount", result.node_count ?? 0);
            setText("mstEdgeCount", 0);
            setText("mstTotalWeight", formatDistance(0));
            setText("mstResultAlgorithm", formatAlgorithm(algorithm));
            updateStatus("No road connections were returned for this area. Try a larger region.");
            setText("mstAreaStatus", "No MST edges returned. Try a larger region.");
            return;
        }

        mstLayer = L.layerGroup();
        let displayed = 0;
        for (const edge of result.edges) {
            const { from, to } = edge;
            if (!from || !to) continue;
            const a = [getNodeLatitude(from), getNodeLongitude(from)];
            const b = [getNodeLatitude(to), getNodeLongitude(to)];
            if (!validCoordinates(...a) || !validCoordinates(...b)) {
                console.warn("Skipping MST edge with invalid coordinates:", edge);
                continue;
            }
            L.polyline([a, b], {
                color: COLORS.mst, weight: 3, opacity: 0.95, interactive: false
            }).addTo(mstLayer);
            displayed++;
        }
        if (displayed === 0) {
            mstLayer = null;
            throw new Error("The server returned MST edges, but none had valid coordinates.");
        }
        mstLayer.addTo(map);
        mstLayer.eachLayer(l => l.bringToFront());
        if (mstAreaRectangle) mstAreaRectangle.bringToFront();

        const total = Number(result.total_weight_m ?? 0);
        const nodeCount = Number(result.node_count ?? "—");
        const edgeCount = Number(result.edge_count ?? displayed);

        setText("mstNodeCount", Number.isFinite(nodeCount) ? nodeCount.toLocaleString() : "—");
        setText("mstEdgeCount", Number.isFinite(edgeCount) ? edgeCount.toLocaleString() : displayed.toLocaleString());
        setText("mstTotalWeight", formatDistance(total));
        setText("mstResultAlgorithm", formatAlgorithm(algorithm));

        updateStatus(
            `${formatAlgorithm(algorithm)} network drawn: ${edgeCount} edges across ` +
            `${nodeCount} nodes, ${formatDistance(total)} in total.`
        );
        setText("mstAreaStatus",
            `Done. ${nodeCount} nodes, ${edgeCount} edges, ${formatDistance(total)}.`);
    } catch (error) {
        console.error("Area MST error:", error);
        updateStatus(`Could not generate area MST: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}

// ---------- Reset ----------

function resetMap() {
    if (!map || !sourceMarker || !destinationMarker) return;
    clearRoute();
    clearMSTArea();
    sourceMarker.setLatLng([DEFAULT_SOURCE.lat, DEFAULT_SOURCE.lng]);
    destinationMarker.setLatLng([DEFAULT_DESTINATION.lat, DEFAULT_DESTINATION.lng]);
    clickMode = "source";
    map.setView([DEFAULT_SOURCE.lat, DEFAULT_SOURCE.lng], 14);
    syncControls();
    updateLayerVisibility();
    setText("selectedAlgorithm", "Dijkstra");
    updateStatus("Map reset to the default Faridabad locations.");
}

function handleMarkerChange() {
    syncControls();
    clearRoute();
    updateStatus("Location updated. Find the route again.");
}

// ---------- Initialize map ----------

function initializeMap() {
    initTabs();

    if (typeof L === "undefined") {
        updateStatus("Leaflet could not load. Check your internet connection.");
        return;
    }
    if (!document.getElementById("mapContainer")) {
        console.error('Map container with id="mapContainer" was not found.');
        return;
    }

    map = L.map("mapContainer", { preferCanvas: true, zoomControl: false })
        .setView([DEFAULT_SOURCE.lat, DEFAULT_SOURCE.lng], 14);
    L.control.zoom({ position: "topright" }).addTo(map);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        className: "basemap-tiles",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    sourceMarker = L.marker([DEFAULT_SOURCE.lat, DEFAULT_SOURCE.lng], {
        draggable: true, icon: pinIcon("start", "A"), title: "Ambulance starting point"
    }).addTo(map).bindPopup("Ambulance starting point");

    destinationMarker = L.marker([DEFAULT_DESTINATION.lat, DEFAULT_DESTINATION.lng], {
        draggable: true, icon: pinIcon("end", "B"), title: "Emergency destination"
    }).addTo(map).bindPopup("Emergency destination");

    sourceMarker.on("dragend", handleMarkerChange);
    destinationMarker.on("dragend", handleMarkerChange);

    map.on("click", event => {
        if (mstAreaSelectionMode) {
            handleMSTAreaClick(event.latlng);
            return;
        }
        if (clickMode === "source") {
            sourceMarker.setLatLng(event.latlng);
            clickMode = "destination";
            updateStatus("Start placed. Click again to place the destination.");
        } else {
            destinationMarker.setLatLng(event.latlng);
            clickMode = "source";
            updateStatus("Destination placed. Ready to find the route.");
        }
        syncControls();
        clearRoute();
    });
    map.on("zoomend", updateLayerVisibility);

    const on = (id, evt, fn) => document.getElementById(id)?.addEventListener(evt, fn);
    on("findRoute", "click", findRoute);
    on("selectMSTArea", "click", startMSTAreaSelection);
    on("showMST", "click", showMST);
    on("clearMSTArea", "click", () => {
        clearMSTArea();
        updateStatus("MST area and overlay cleared.");
    });
    on("reset", "click", resetMap);
    on("replayAmbulance", "click", () => {
        if (lastRouteCoordinates.length >= 2) animateAmbulance(lastRouteCoordinates);
    });
    on("toggleNodes", "change", updateLayerVisibility);
    on("toggleRoads", "change", updateLayerVisibility);
    on("algorithm", "change", e => setText("selectedAlgorithm", formatAlgorithm(e.target.value)));

    syncControls();
    updateStatus("Map ready. Loading the Faridabad road network...");
    setText("zoomLevel", map.getZoom());
    loadNetworkStats();
    setTimeout(() => map && map.invalidateSize(), 200);
}

document.addEventListener("DOMContentLoaded", initializeMap);