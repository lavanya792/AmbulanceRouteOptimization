"use strict";
// ============================================================
// VITALANE — Ambulance Route Optimization
// Faridabad road network
// Frontend: GitHub Pages
// Backend: Render Flask API
// Algorithms: Dijkstra, A*, Bellman-Ford, Prim, Kruskal
// ============================================================
const API_BASE_URL = "https://ambulancerouteoptimization.onrender.com";
const DEFAULT_SOURCE = {
    lat: 28.4089,
    lng: 77.3178
};
const DEFAULT_DESTINATION = {
    lat: 28.4212,
    lng: 77.3070
};
const AMBULANCE_SPEED_KMH = 45;
const COLORS = {
    route: "#ff4b2b",
    routeCasing: "#0d2b2a",
    road: "#1f5c57",
    node: "#0d2b2a",
    mst: "#6d4aff",
    area: "#6d4aff"
};
// ============================================================
// GLOBAL STATE
// ============================================================
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
let sourceSelect = null;
let destinationSelect = null;
// ============================================================
// GENERAL UTILITIES
// ============================================================
function getElement(id) {
    return document.getElementById(id);
}
function setText(id, value) {
    const element = getElement(id);
    if (element) {
        element.textContent = String(value);
    }
}
function updateStatus(message) {
    setText("message", message);
    console.log("[Vitalane]", message);
}
function formatDistance(distance) {
    const value = Number(distance);
    if (!Number.isFinite(value)) {
        return "—";
    }
    return value >= 1000
        ? `${(value / 1000).toFixed(2)} km`
        : `${value.toFixed(0)} m`;
}
function formatAlgorithm(algorithm) {
    return String(algorithm || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, character => character.toUpperCase());
}
function formatEta(distanceM) {
    const distance = Number(distanceM);
    if (!Number.isFinite(distance) || distance < 0) {
        return "—";
    }
    const seconds = Math.round(
        distance / (AMBULANCE_SPEED_KMH / 3.6)
    );
    if (seconds < 60) {
        return `${seconds} sec`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds
        ? `${minutes} min ${remainingSeconds}s`
        : `${minutes} min`;
}
function getNodeLatitude(node) {
    return Number(node?.lat ?? node?.latitude);
}
function getNodeLongitude(node) {
    return Number(node?.lon ?? node?.lng ?? node?.longitude);
}
function validCoordinates(lat, lon) {
    return (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180
    );
}
function getCoordinates(marker) {
    const position = marker.getLatLng();
    return {
        lat: position.lat,
        lng: position.lng
    };
}
function pinIcon(kind, letter) {
    return L.divIcon({
        className: "pin-icon",
        html: `
            <div class="pin pin-${kind}">
                <span>${letter}</span>
            </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 34]
    });
}
function addListener(id, eventName, callback) {
    const element = getElement(id);
    if (element) {
        element.addEventListener(eventName, callback);
    }
}
// ============================================================
// API REQUEST HELPER
// ============================================================
async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    let response;
    try {
        response = await fetch(url, {
            ...options,
            headers: {
                ...(options.body
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...options.headers
            }
        });
    } catch (error) {
        throw new Error(
            `Cannot reach the Vitalane API. Check the Render service and CORS settings. ${error.message}`
        );
    }
    const responseText = await response.text();
    let result;
    try {
        result = responseText ? JSON.parse(responseText) : {};
    } catch {
        throw new Error(
            `The API returned an invalid response (HTTP ${response.status}).`
        );
    }
    if (!response.ok) {
        throw new Error(
            result.error ||
            result.message ||
            `API request failed with HTTP ${response.status}.`
        );
    }
    return result;
}
// ============================================================
// TABS
// ============================================================
function initTabs() {
    const tabs = document.querySelectorAll(".tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(otherTab => {
                const active = otherTab === tab;
                otherTab.classList.toggle("is-active", active);
                otherTab.setAttribute(
                    "aria-selected",
                    String(active)
                );
                const paneId = `pane-${otherTab.dataset.tab}`;
                const pane = getElement(paneId);
                if (pane) {
                    pane.hidden = !active;
                }
            });
            // Leaflet sometimes needs recalculation after a hidden
            // panel or tab becomes visible.
            setTimeout(() => {
                if (map) {
                    map.invalidateSize();
                }
            }, 100);
        });
    });
}
// ============================================================
// SOURCE AND DESTINATION CONTROLS
// ============================================================
function updateSelect(select, position, label) {
    if (!select) {
        return;
    }
    const value =
        `${position.lat.toFixed(7)},${position.lng.toFixed(7)}`;
    let option = select.querySelector(
        'option[data-custom="true"]'
    );
    if (!option) {
        option = document.createElement("option");
        option.dataset.custom = "true";
        select.appendChild(option);
    }
    option.value = value;
    option.textContent =
        `${label} (${position.lat.toFixed(5)}, ${position.lng.toFixed(5)})`;
    select.value = value;
}
function syncControls() {
    if (!sourceMarker || !destinationMarker) {
        return;
    }
    updateSelect(
        sourceSelect,
        getCoordinates(sourceMarker),
        "Start"
    );
    updateSelect(
        destinationSelect,
        getCoordinates(destinationMarker),
        "Destination"
    );
}
function readCoordinates(select, marker) {
    if (select && select.value) {
        const values = select.value
            .split(",")
            .map(Number);
        if (
            values.length === 2 &&
            validCoordinates(values[0], values[1])
        ) {
            return {
                lat: values[0],
                lng: values[1]
            };
        }
    }
    return getCoordinates(marker);
}
function handleMarkerChange() {
    syncControls();
    clearRoute();
    updateStatus(
        "Location updated. Find the route again."
    );
}
// ============================================================
// ROUTE CLEANUP
// ============================================================
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
    if (routeLayer && map) {
        map.removeLayer(routeLayer);
    }
    if (routeCasing && map) {
        map.removeLayer(routeCasing);
    }
    routeLayer = null;
    routeCasing = null;
    setText("routeCost", "—");
    setText("etaValue", "—");
    setText("nodesExplored", "—");
    setText("executionTime", "—");
    setText("routeStatus", "Ready");
    const replayButton = getElement("replayAmbulance");
    if (replayButton) {
        replayButton.disabled = true;
    }
}
function clearMST() {
    if (mstLayer && map) {
        map.removeLayer(mstLayer);
    }
    mstLayer = null;
    setText("mstNodeCount", "—");
    setText("mstEdgeCount", "—");
    setText("mstTotalWeight", "—");
    setText("mstResultAlgorithm", "—");
}
// ============================================================
// GRAPH LOADING
// ============================================================
function buildGraphLayers(data) {
    const nodes = Array.isArray(data.nodes)
        ? data.nodes
        : [];
    const edges = Array.isArray(data.edges)
        ? data.edges
        : [];
    if (nodes.length === 0) {
        setText("networkStatus", "No coordinates");
        throw new Error(
            "The graph API did not return any nodes."
        );
    }
    if (nodeLayer && map.hasLayer(nodeLayer)) {
        map.removeLayer(nodeLayer);
    }
    if (roadLayer && map.hasLayer(roadLayer)) {
        map.removeLayer(roadLayer);
    }
    nodeLayer = L.layerGroup();
    roadLayer = L.layerGroup();
    const nodeById = new Map();
    for (const node of nodes) {
        nodeById.set(String(node.id), node);
    }
    let validRoads = 0;
    for (const edge of edges) {
        let from;
        let to;
        if (
            edge.from !== null &&
            typeof edge.from === "object"
        ) {
            from = edge.from;
            to = edge.to;
        } else {
            from = nodeById.get(
                String(edge.from ?? edge.source)
            );
            to = nodeById.get(
                String(edge.to ?? edge.target)
            );
        }
        if (!from || !to) {
            continue;
        }
        const pointA = [
            getNodeLatitude(from),
            getNodeLongitude(from)
        ];
        const pointB = [
            getNodeLatitude(to),
            getNodeLongitude(to)
        ];
        if (
            !validCoordinates(...pointA) ||
            !validCoordinates(...pointB)
        ) {
            continue;
        }
        L.polyline([pointA, pointB], {
            color: COLORS.road,
            weight: 1.4,
            opacity: 0.55,
            interactive: false
        }).addTo(roadLayer);
        validRoads++;
    }
    for (const node of nodes) {
        const lat = getNodeLatitude(node);
        const lon = getNodeLongitude(node);
        if (!validCoordinates(lat, lon)) {
            continue;
        }
        L.circleMarker([lat, lon], {
            radius: 2.2,
            color: "#f5b400",
            weight: 0.8,
            fillColor: COLORS.node,
            fillOpacity: 0.95,
            interactive: false
        }).addTo(nodeLayer);
    }
    updateLayerVisibility();
    setText(
        "networkStatus",
        validRoads === 0 ? "No valid roads" : "Loaded"
    );
    console.log(
        `[Vitalane] Loaded ${nodes.length} nodes and ${validRoads} road segments.`
    );
}
async function loadNetworkStats() {
    setText("networkStatus", "Loading...");
    try {
        const result = await apiRequest(
            "/api/graph?include=geometry"
        );
        if (result.success === false) {
            throw new Error(
                result.error || "Could not load the road graph."
            );
        }
        graphData = result;
        const nodes = Number(
            result.vertices ??
            result.node_count ??
            result.nodes?.length
        );
        const edges = Number(
            result.edges_count ??
            result.edge_count ??
            (
                Array.isArray(result.edges)
                    ? result.edges.length
                    : NaN
            )
        );
        setText(
            "totalNodes",
            Number.isFinite(nodes)
                ? nodes.toLocaleString()
                : "—"
        );
        setText(
            "totalEdges",
            Number.isFinite(edges)
                ? edges.toLocaleString()
                : "—"
        );
        if (
            Array.isArray(result.nodes) &&
            Array.isArray(result.edges)
        ) {
            buildGraphLayers(result);
            updateStatus(
                "Road network loaded. Place a start and destination, then find a route."
            );
        } else {
            setText("networkStatus", "No geometry");
            throw new Error(
                "The graph API returned counts but not node and edge geometry. Ensure the deployed Flask endpoint supports include=geometry."
            );
        }
    } catch (error) {
        console.error(
            "[Vitalane] Network loading error:",
            error
        );
        setText("networkStatus", "Unavailable");
        setText("totalNodes", "—");
        setText("totalEdges", "—");
        updateStatus(
            `Could not load the road network: ${error.message}`
        );
    }
}
// ============================================================
// LAYER VISIBILITY
// ============================================================
function updateLayerVisibility() {
    if (!map) {
        return;
    }
    const nodesToggle = getElement("toggleNodes");
    const roadsToggle = getElement("toggleRoads");
    const nodesEnabled = nodesToggle
        ? nodesToggle.checked
        : true;
    const roadsEnabled = roadsToggle
        ? roadsToggle.checked
        : true;
    const zoom = map.getZoom();
    const showNodes = zoom >= 14;
    if (nodeLayer) {
        if (nodesEnabled && showNodes) {
            if (!map.hasLayer(nodeLayer)) {
                nodeLayer.addTo(map);
            }
        } else if (map.hasLayer(nodeLayer)) {
            map.removeLayer(nodeLayer);
        }
    }
    if (roadLayer) {
        if (roadsEnabled) {
            if (!map.hasLayer(roadLayer)) {
                roadLayer.addTo(map);
            }
        } else if (map.hasLayer(roadLayer)) {
            map.removeLayer(roadLayer);
        }
    }
    if (mstLayer && map.hasLayer(mstLayer)) {
        mstLayer.eachLayer(layer => layer.bringToFront());
    }
    if (routeCasing) {
        routeCasing.bringToFront();
    }
    if (routeLayer) {
        routeLayer.bringToFront();
    }
    setText("zoomLevel", zoom);
    if (nodesEnabled && !showNodes) {
        setText("networkStatus", "Zoom in for nodes");
    } else if (graphData) {
        setText("networkStatus", "Loaded");
    }
}
// ============================================================
// AMBULANCE ANIMATION
// ============================================================
function animateAmbulance(coordinates) {
    stopAmbulanceAnimation();
    if (
        !Array.isArray(coordinates) ||
        coordinates.length < 2
    ) {
        updateStatus(
            "The route is too short to animate."
        );
        return;
    }
    const replayButton = getElement("replayAmbulance");
    if (replayButton) {
        replayButton.disabled = false;
    }
    const icon = L.divIcon({
        className: "ambulance-div-icon",
        html: `
            <span
                class="ambulance-emoji"
                role="img"
                aria-label="Ambulance"
            >🚑</span>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19]
    });
    ambulanceMarker = L.marker(coordinates[0], {
        icon,
        zIndexOffset: 1000,
        title: "Simulated ambulance"
    }).addTo(map);
    ambulanceMarker.bindTooltip(
        "Ambulance en route",
        {
            direction: "top",
            offset: [0, -16]
        }
    );
    const cumulativeDistances = [0];
    let totalDistance = 0;
    for (
        let index = 1;
        index < coordinates.length;
        index++
    ) {
        totalDistance += L.latLng(
            coordinates[index - 1]
        ).distanceTo(
            L.latLng(coordinates[index])
        );
        cumulativeDistances.push(totalDistance);
    }
    if (totalDistance <= 0) {
        return;
    }
    const durationMs = Math.min(
        18000,
        Math.max(5000, totalDistance * 2.5)
    );
    let startTime = null;
    function step(timestamp) {
        if (startTime === null) {
            startTime = timestamp;
        }
        const progress = Math.min(
            (timestamp - startTime) / durationMs,
            1
        );
        const travelled = progress * totalDistance;
        let segment = 1;
        while (
            segment < cumulativeDistances.length - 1 &&
            cumulativeDistances[segment] < travelled
        ) {
            segment++;
        }
        const segmentStart =
            cumulativeDistances[segment - 1];
        const segmentLength =
            cumulativeDistances[segment] - segmentStart;
        const ratio = segmentLength > 0
            ? (travelled - segmentStart) / segmentLength
            : 0;
        const from = coordinates[segment - 1];
        const to = coordinates[segment];
        ambulanceMarker.setLatLng([
            from[0] + (to[0] - from[0]) * ratio,
            from[1] + (to[1] - from[1]) * ratio
        ]);
        if (progress < 1) {
            ambulanceAnimation =
                requestAnimationFrame(step);
        } else {
            ambulanceAnimation = null;
            ambulanceMarker.setLatLng(
                coordinates[coordinates.length - 1]
            );
            ambulanceMarker.setTooltipContent(
                "Ambulance arrived"
            );
            ambulanceMarker.openTooltip();
            updateStatus(
                "Ambulance arrived at the destination."
            );
        }
    }
    ambulanceAnimation = requestAnimationFrame(step);
}
// ============================================================
// ROUTE FINDING
// Dijkstra / A* / Bellman-Ford
// ============================================================
async function findRoute() {
    if (
        !map ||
        !sourceMarker ||
        !destinationMarker
    ) {
        updateStatus("The map is not ready.");
        return;
    }
    const source = readCoordinates(
        sourceSelect,
        sourceMarker
    );
    const destination = readCoordinates(
        destinationSelect,
        destinationMarker
    );
    const algorithmElement = getElement("algorithm");
    const button = getElement("findRoute");
    const algorithm = algorithmElement
        ? algorithmElement.value
        : "dijkstra";
    setText(
        "selectedAlgorithm",
        formatAlgorithm(algorithm)
    );
    if (button) {
        button.disabled = true;
    }
    clearRoute();
    clearMST();
    setText("routeStatus", "Calculating...");
    updateStatus(
        `Calculating route with ${formatAlgorithm(algorithm)}...`
    );
    try {
        const result = await apiRequest(
            "/api/route",
            {
                method: "POST",
                body: JSON.stringify({
                    algorithm,
                    source_lat: source.lat,
                    source_lon: source.lng,
                    destination_lat: destination.lat,
                    destination_lon: destination.lng
                })
            }
        );
        if (
            result.found === false ||
            !Array.isArray(result.path) ||
            result.path.length === 0
        ) {
            setText("routeStatus", "No route");
            updateStatus(
                result.message ||
                "No route was found between these points."
            );
            return;
        }
        const coordinates = result.path.map(node => [
            getNodeLatitude(node),
            getNodeLongitude(node)
        ]);
        if (
            coordinates.some(
                point => !validCoordinates(...point)
            )
        ) {
            throw new Error(
                "The server returned invalid route coordinates."
            );
        }
        const style = {
            lineCap: "round",
            lineJoin: "round"
        };
        routeCasing = L.polyline(
            coordinates,
            {
                ...style,
                color: COLORS.routeCasing,
                weight: 9,
                opacity: 0.9
            }
        ).addTo(map);
        routeLayer = L.polyline(
            coordinates,
            {
                ...style,
                color: COLORS.route,
                weight: 5,
                opacity: 1
            }
        ).addTo(map);
        routeCasing.bringToFront();
        routeLayer.bringToFront();
        lastRouteCoordinates = coordinates;
        map.fitBounds(
            routeLayer.getBounds(),
            {
                padding: [60, 60]
            }
        );
        const distance = Number(
            result.distance_m ??
            result.cost ??
            0
        );
        setText(
            "routeCost",
            formatDistance(distance)
        );
        setText(
            "etaValue",
            formatEta(distance)
        );
        setText(
            "nodesExplored",
            Number(result.explored ?? 0).toLocaleString()
        );
        setText(
            "executionTime",
            `${Number(result.elapsed_ms ?? 0).toFixed(3)} ms`
        );
        setText("routeStatus", "Route found");
        updateStatus(
            `Route found with ${formatAlgorithm(algorithm)}: ` +
            `${formatDistance(distance)}, approximately ` +
            `${formatEta(distance)} at ${AMBULANCE_SPEED_KMH} km/h.`
        );
        animateAmbulance(coordinates);
    } catch (error) {
        console.error(
            "[Vitalane] Route calculation error:",
            error
        );
        setText("routeStatus", "Error");
        updateStatus(
            `Could not calculate route: ${error.message}`
        );
    } finally {
        if (button) {
            button.disabled = false;
        }
    }
}
// ============================================================
// AREA-BASED MINIMUM SPANNING TREE
// Prim / Kruskal
// ============================================================
function cornerMarker(latlng) {
    return L.circleMarker(latlng, {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: COLORS.area,
        fillOpacity: 1
    }).addTo(map);
}
function clearMSTArea() {
    mstAreaSelectionMode = false;
    mstAreaFirstCorner = null;
    mstAreaBounds = null;
    if (mstAreaRectangle && map) {
        map.removeLayer(mstAreaRectangle);
    }
    mstAreaRectangle = null;
    for (const marker of mstSelectionMarkers) {
        if (map) {
            map.removeLayer(marker);
        }
    }
    mstSelectionMarkers = [];
    clearMST();
    const button = getElement("selectMSTArea");
    if (button) {
        button.textContent = "Select MST area";
        button.disabled = false;
    }
    setText(
        "mstAreaStatus",
        "Select an area, then click two opposite corners on the map."
    );
}
function startMSTAreaSelection() {
    clearMSTArea();
    mstAreaSelectionMode = true;
    const button = getElement("selectMSTArea");
    if (button) {
        button.textContent = "Selecting area...";
    }
    setText(
        "mstAreaStatus",
        "Click the first corner of your area on the map."
    );
    updateStatus(
        "Area selection enabled. Click the first corner on the map."
    );
}
function handleMSTAreaClick(latlng) {
    if (!mstAreaSelectionMode) {
        return;
    }
    if (!mstAreaFirstCorner) {
        mstAreaFirstCorner = latlng;
        mstSelectionMarkers.push(
            cornerMarker(latlng)
        );
        setText(
            "mstAreaStatus",
            "First corner set. Click the opposite corner."
        );
        updateStatus(
            "First corner set. Click the opposite corner."
        );
        return;
    }
    const first = mstAreaFirstCorner;
    const south = Math.min(
        first.lat,
        latlng.lat
    );
    const north = Math.max(
        first.lat,
        latlng.lat
    );
    const west = Math.min(
        first.lng,
        latlng.lng
    );
    const east = Math.max(
        first.lng,
        latlng.lng
    );
    if (south === north || west === east) {
        setText(
            "mstAreaStatus",
            "Pick a second corner with both width and height."
        );
        updateStatus(
            "Invalid rectangle. Click another point for the second corner."
        );
        return;
    }
    mstAreaBounds = {
        south,
        west,
        north,
        east
    };
    mstAreaRectangle = L.rectangle(
        [[south, west], [north, east]],
        {
            color: COLORS.area,
            weight: 2,
            fillColor: COLORS.area,
            fillOpacity: 0.1,
            dashArray: "6, 5"
        }
    ).addTo(map);
    mstSelectionMarkers.push(
        cornerMarker(latlng)
    );
    mstAreaSelectionMode = false;
    const button = getElement("selectMSTArea");
    if (button) {
        button.textContent = "Change MST area";
    }
    setText(
        "mstAreaStatus",
        `Area set: ${south.toFixed(5)}, ${west.toFixed(5)} ` +
        `to ${north.toFixed(5)}, ${east.toFixed(5)}.`
    );
    updateStatus(
        "Area set. Choose Prim or Kruskal, then generate the MST."
    );
}
async function showMST() {
    if (!map) {
        updateStatus("The map is not ready.");
        return;
    }
    if (!mstAreaBounds) {
        updateStatus(
            "Select an area first using the Select MST area button."
        );
        setText(
            "mstAreaStatus",
            "No area selected. Pick two opposite corners on the map."
        );
        return;
    }
    const button = getElement("showMST");
    const algorithmElement = getElement("mstAlgorithm");
    const algorithm = algorithmElement
        ? algorithmElement.value
        : "prim";
    if (button) {
        button.disabled = true;
    }
    clearMST();
    stopAmbulanceAnimation();
    updateStatus(
        `Generating minimum spanning forest with ${formatAlgorithm(algorithm)}...`
    );
    try {
        const result = await apiRequest(
            "/api/mst",
            {
                method: "POST",
                body: JSON.stringify({
                    algorithm,
                    bounds: {
                        south: mstAreaBounds.south,
                        west: mstAreaBounds.west,
                        north: mstAreaBounds.north,
                        east: mstAreaBounds.east
                    }
                })
            }
        );
        if (result.success === false) {
            throw new Error(
                result.error || "The MST algorithm failed."
            );
        }
        if (!Array.isArray(result.edges)) {
            throw new Error(
                "The server response does not contain an edges array."
            );
        }
        if (result.edges.length === 0) {
            setText(
                "mstNodeCount",
                result.node_count ?? 0
            );
            setText("mstEdgeCount", 0);
            setText("mstTotalWeight", formatDistance(0));
            setText(
                "mstResultAlgorithm",
                formatAlgorithm(algorithm)
            );
            updateStatus(
                "No road connections were returned. Try a larger region."
            );
            setText(
                "mstAreaStatus",
                "No MST edges returned. Try a larger region."
            );
            return;
        }
        const newMSTLayer = L.layerGroup();
        let displayedEdges = 0;
        for (const edge of result.edges) {
            const from = edge.from;
            const to = edge.to;
            if (!from || !to) {
                continue;
            }
            const pointA = [
                getNodeLatitude(from),
                getNodeLongitude(from)
            ];
            const pointB = [
                getNodeLatitude(to),
                getNodeLongitude(to)
            ];
            if (
                !validCoordinates(...pointA) ||
                !validCoordinates(...pointB)
            ) {
                console.warn(
                    "[Vitalane] Invalid MST edge:",
                    edge
                );
                continue;
            }
            L.polyline(
                [pointA, pointB],
                {
                    color: COLORS.mst,
                    weight: 3,
                    opacity: 0.95,
                    interactive: false
                }
            ).addTo(newMSTLayer);
            displayedEdges++;
        }
        if (displayedEdges === 0) {
            throw new Error(
                "MST edges were returned, but none had valid coordinates."
            );
        }
        mstLayer = newMSTLayer.addTo(map);
        mstLayer.eachLayer(
            layer => layer.bringToFront()
        );
        if (mstAreaRectangle) {
            mstAreaRectangle.bringToFront();
        }
        const totalWeight = Number(
            result.total_weight_m ?? 0
        );
        const nodeCount = Number(
            result.node_count ?? NaN
        );
        const edgeCount = Number(
            result.edge_count ?? displayedEdges
        );
        setText(
            "mstNodeCount",
            Number.isFinite(nodeCount)
                ? nodeCount.toLocaleString()
                : "—"
        );
        setText(
            "mstEdgeCount",
            Number.isFinite(edgeCount)
                ? edgeCount.toLocaleString()
                : displayedEdges.toLocaleString()
        );
        setText(
            "mstTotalWeight",
            formatDistance(totalWeight)
        );
        setText(
            "mstResultAlgorithm",
            formatAlgorithm(algorithm)
        );
        updateStatus(
            `${formatAlgorithm(algorithm)} network drawn: ` +
            `${edgeCount} edges across ${nodeCount} nodes, ` +
            `${formatDistance(totalWeight)} total.`
        );
        setText(
            "mstAreaStatus",
            `Done. ${nodeCount} nodes, ${edgeCount} edges, ` +
            `${formatDistance(totalWeight)}.`
        );
    } catch (error) {
        console.error(
            "[Vitalane] Area MST error:",
            error
        );
        updateStatus(
            `Could not generate area MST: ${error.message}`
        );
        setText(
            "mstAreaStatus",
            `MST error: ${error.message}`
        );
    } finally {
        if (button) {
            button.disabled = false;
        }
    }
}
// ============================================================
// RESET MAP
// ============================================================
function resetMap() {
    if (!map || !sourceMarker || !destinationMarker) {
        return;
    }
    clearRoute();
    clearMSTArea();
    sourceMarker.setLatLng([
        DEFAULT_SOURCE.lat,
        DEFAULT_SOURCE.lng
    ]);
    destinationMarker.setLatLng([
        DEFAULT_DESTINATION.lat,
        DEFAULT_DESTINATION.lng
    ]);
    clickMode = "source";
    map.setView(
        [DEFAULT_SOURCE.lat, DEFAULT_SOURCE.lng],
        14
    );
    syncControls();
    updateLayerVisibility();
    setText("selectedAlgorithm", "Dijkstra");
    updateStatus(
        "Map reset to the default Faridabad locations."
    );
}
// ============================================================
// INITIALIZE MAP
// ============================================================
function initializeMap() {
    initTabs();
    sourceSelect = getElement("source");
    destinationSelect = getElement("destination");
    if (typeof L === "undefined") {
        updateStatus(
            "Leaflet could not load. Check your internet connection."
        );
        return;
    }
    if (!getElement("mapContainer")) {
        console.error(
            'Map container with id="mapContainer" was not found.'
        );
        return;
    }
    map = L.map(
        "mapContainer",
        {
            preferCanvas: true,
            zoomControl: false
        }
    ).setView(
        [DEFAULT_SOURCE.lat, DEFAULT_SOURCE.lng],
        14
    );
    L.control.zoom({
        position: "topright"
    }).addTo(map);
    L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            className: "basemap-tiles",
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">' +
                'OpenStreetMap</a> contributors'
        }
    ).addTo(map);
    sourceMarker = L.marker(
        [DEFAULT_SOURCE.lat, DEFAULT_SOURCE.lng],
        {
            draggable: true,
            icon: pinIcon("start", "A"),
            title: "Ambulance starting point"
        }
    ).addTo(map);
    sourceMarker.bindPopup(
        "Ambulance starting point"
    );
    destinationMarker = L.marker(
        [
            DEFAULT_DESTINATION.lat,
            DEFAULT_DESTINATION.lng
        ],
        {
            draggable: true,
            icon: pinIcon("end", "B"),
            title: "Emergency destination"
        }
    ).addTo(map);
    destinationMarker.bindPopup(
        "Emergency destination"
    );
    sourceMarker.on(
        "dragend",
        handleMarkerChange
    );
    destinationMarker.on(
        "dragend",
        handleMarkerChange
    );
    map.on("click", event => {
        if (mstAreaSelectionMode) {
            handleMSTAreaClick(event.latlng);
            return;
        }
        if (clickMode === "source") {
            sourceMarker.setLatLng(event.latlng);
            clickMode = "destination";
            updateStatus(
                "Start placed. Click again to place the destination."
            );
        } else {
            destinationMarker.setLatLng(event.latlng);
            clickMode = "source";
            updateStatus(
                "Destination placed. Ready to find the route."
            );
        }
        syncControls();
        clearRoute();
    });
    map.on(
        "zoomend",
        updateLayerVisibility
    );
    addListener(
        "findRoute",
        "click",
        findRoute
    );
    addListener(
        "selectMSTArea",
        "click",
        startMSTAreaSelection
    );
    addListener(
        "showMST",
        "click",
        showMST
    );
    addListener(
        "clearMSTArea",
        "click",
        () => {
            clearMSTArea();
            updateStatus(
                "MST area and overlay cleared."
            );
        }
    );
    addListener(
        "reset",
        "click",
        resetMap
    );
    addListener(
        "replayAmbulance",
        "click",
        () => {
            if (lastRouteCoordinates.length >= 2) {
                animateAmbulance(
                    lastRouteCoordinates
                );
            }
        }
    );
    addListener(
        "toggleNodes",
        "change",
        updateLayerVisibility
    );
    addListener(
        "toggleRoads",
        "change",
        updateLayerVisibility
    );
    addListener(
        "algorithm",
        "change",
        event => {
            setText(
                "selectedAlgorithm",
                formatAlgorithm(event.target.value)
            );
        }
    );
    if (sourceSelect) {
        sourceSelect.addEventListener(
            "change",
            () => {
                const coordinates = readCoordinates(
                    sourceSelect,
                    sourceMarker
                );
                sourceMarker.setLatLng([
                    coordinates.lat,
                    coordinates.lng
                ]);
                handleMarkerChange();
            }
        );
    }
    if (destinationSelect) {
        destinationSelect.addEventListener(
            "change",
            () => {
                const coordinates = readCoordinates(
                    destinationSelect,
                    destinationMarker
                );
                destinationMarker.setLatLng([
                    coordinates.lat,
                    coordinates.lng
                ]);
                handleMarkerChange();
            }
        );
    }
    syncControls();
    setText(
        "zoomLevel",
        map.getZoom()
    );
    updateStatus(
        "Map ready. Loading the Faridabad road network..."
    );
    loadNetworkStats();
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 200);
}
document.addEventListener(
    "DOMContentLoaded",
    initializeMap
);