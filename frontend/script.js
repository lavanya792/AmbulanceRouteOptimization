const DEFAULT_SOURCE = { lat: 28.4089, lng: 77.3178 };
const DEFAULT_DESTINATION = { lat: 28.4212, lng: 77.3070 };

let map;
let sourceMarker;
let destinationMarker;
let routeLayer = null;
let mstLayer = null;
let ambulanceMarker = null;
let ambulanceAnimation = null;
let lastRouteCoordinates = [];
let clickMode = "source";

const sourceSelect = document.getElementById("source");
const destinationSelect = document.getElementById("destination");

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function updateStatus(message) {
    setText("message", message);
    console.log(message);
}

function getCoordinates(marker) {
    const position = marker.getLatLng();

    return {
        lat: position.lat,
        lng: position.lng
    };
}

function updateSelect(select, position, label) {
    if (!select) return;

    const value =
        `${position.lat.toFixed(7)},${position.lng.toFixed(7)}`;

    let option = select.querySelector('option[data-custom="true"]');

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
    updateSelect(sourceSelect, getCoordinates(sourceMarker), "Selected source");
    updateSelect(
        destinationSelect,
        getCoordinates(destinationMarker),
        "Selected destination"
    );
}

function readCoordinates(select, marker) {
    if (select && select.value) {
        const values = select.value.split(",").map(Number);

        if (
            values.length === 2 &&
            values.every(Number.isFinite) &&
            Math.abs(values[0]) <= 90 &&
            Math.abs(values[1]) <= 180
        ) {
            return { lat: values[0], lng: values[1] };
        }
    }

    return getCoordinates(marker);
}

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
        routeLayer = null;
    }

    setText("routeCost", "—");
    setText("nodesExplored", "—");
    setText("executionTime", "—");
    setText("routeStatus", "Ready");
}

function clearMST() {
    if (mstLayer && map) {
        map.removeLayer(mstLayer);
        mstLayer = null;
    }
}

function ensureReplayButton() {
    if (document.getElementById("replayAmbulance")) return;

    const routeButton = document.getElementById("findRoute");
    if (!routeButton) return;

    const button = document.createElement("button");
    button.id = "replayAmbulance";
    button.type = "button";
    button.className = "secondary-btn";
    button.textContent = "Replay Ambulance";
    button.disabled = true;
    button.style.marginTop = "8px";

    routeButton.insertAdjacentElement("afterend", button);

    button.addEventListener("click", () => {
        if (lastRouteCoordinates.length >= 2) {
            animateAmbulance(lastRouteCoordinates);
        }
    });
}

function initializeMap() {
    if (typeof L === "undefined") {
        updateStatus("Leaflet could not load. Check your internet connection.");
        return;
    }

    map = L.map("mapContainer").setView(
        [DEFAULT_SOURCE.lat, DEFAULT_SOURCE.lng],
        14
    );

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }
    ).addTo(map);

    sourceMarker = L.marker(
        [DEFAULT_SOURCE.lat, DEFAULT_SOURCE.lng],
        {
            draggable: true,
            title: "Ambulance starting point"
        }
    ).addTo(map);

    destinationMarker = L.marker(
        [DEFAULT_DESTINATION.lat, DEFAULT_DESTINATION.lng],
        {
            draggable: true,
            title: "Emergency destination"
        }
    ).addTo(map);

    sourceMarker.bindPopup("Ambulance starting point");
    destinationMarker.bindPopup("Emergency destination");

    sourceMarker.on("dragend", handleMarkerChange);
    destinationMarker.on("dragend", handleMarkerChange);

    map.on("click", function (event) {
        if (clickMode === "source") {
            sourceMarker.setLatLng(event.latlng);
            clickMode = "destination";
            updateStatus("Source selected. Click again to select destination.");
        } else {
            destinationMarker.setLatLng(event.latlng);
            clickMode = "source";
            updateStatus("Destination selected. Ready to calculate the route.");
        }

        syncControls();
        clearRoute();
    });

    syncControls();
    ensureReplayButton();

    document.getElementById("findRoute")
        .addEventListener("click", findRoute);

    document.getElementById("showMST")
        .addEventListener("click", showMST);

    document.getElementById("reset")
        .addEventListener("click", resetMap);

    updateStatus("Map ready. Drag markers or click the map to select locations.");

    setTimeout(() => map.invalidateSize(), 100);
}

function handleMarkerChange() {
    syncControls();
    clearRoute();
    updateStatus("Location updated. Calculate the route again.");
}

function animateAmbulance(coordinates) {
    stopAmbulanceAnimation();

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        updateStatus("The route is too short to animate.");
        return;
    }

    const replayButton = document.getElementById("replayAmbulance");
    if (replayButton) replayButton.disabled = false;

    const ambulanceIcon = L.divIcon({
        className: "ambulance-div-icon",
        html: '<span class="ambulance-emoji" role="img" aria-label="Ambulance">🚑</span>',
        iconSize: [38, 38],
        iconAnchor: [19, 19]
    });

    ambulanceMarker = L.marker(coordinates[0], {
        icon: ambulanceIcon,
        zIndexOffset: 1000,
        title: "Simulated ambulance"
    }).addTo(map);

    ambulanceMarker.bindTooltip("Ambulance en route", {
        direction: "top",
        offset: [0, -16]
    });

    /*
     * Approximate each route segment's length in screen-independent
     * geographic units. This makes movement progress along the path.
     */
    const cumulative = [0];
    let total = 0;

    for (let i = 1; i < coordinates.length; i++) {
        const a = L.latLng(coordinates[i - 1]);
        const b = L.latLng(coordinates[i]);
        total += a.distanceTo(b);
        cumulative.push(total);
    }

    if (total <= 0) {
        ambulanceMarker.setLatLng(coordinates[coordinates.length - 1]);
        return;
    }

    const durationMs = Math.min(18000, Math.max(5000, total * 2.5));
    let startTime = null;

    function step(timestamp) {
        if (startTime === null) startTime = timestamp;

        const progress = Math.min((timestamp - startTime) / durationMs, 1);
        const travelled = progress * total;

        let segment = 1;

        while (
            segment < cumulative.length - 1 &&
            cumulative[segment] < travelled
        ) {
            segment++;
        }

        const segmentStart = cumulative[segment - 1];
        const segmentLength = cumulative[segment] - segmentStart;
        const localProgress = segmentLength > 0
            ? (travelled - segmentStart) / segmentLength
            : 0;

        const from = coordinates[segment - 1];
        const to = coordinates[segment];

        const lat = from[0] + (to[0] - from[0]) * localProgress;
        const lng = from[1] + (to[1] - from[1]) * localProgress;

        ambulanceMarker.setLatLng([lat, lng]);

        if (progress < 1) {
            ambulanceAnimation = requestAnimationFrame(step);
        } else {
            ambulanceAnimation = null;
            ambulanceMarker.setLatLng(coordinates[coordinates.length - 1]);
            ambulanceMarker.setTooltipContent("Ambulance arrived");
            ambulanceMarker.openTooltip();
            updateStatus("Ambulance simulation complete — destination reached.");
        }
    }

    ambulanceAnimation = requestAnimationFrame(step);
}

async function findRoute() {
    if (!map || !sourceMarker || !destinationMarker) {
        updateStatus("The map is not ready.");
        return;
    }

    const source = readCoordinates(sourceSelect, sourceMarker);
    const destination = readCoordinates(destinationSelect, destinationMarker);
    const algorithm = document.getElementById("algorithm").value;
    const button = document.getElementById("findRoute");

    button.disabled = true;
    clearRoute();
    clearMST();

    setText("routeStatus", "Calculating...");
    updateStatus(`Calculating route using ${algorithm}...`);

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

        if (!result.found || !Array.isArray(result.path) || !result.path.length) {
            setText("routeStatus", "No route");
            updateStatus(result.message || "No route was found.");
            return;
        }

        const coordinates = result.path.map(node => [
            Number(node.lat),
            Number(node.lon)
        ]);

        if (
            coordinates.some(
                point => point.length !== 2 || !point.every(Number.isFinite)
            )
        ) {
            throw new Error("The server returned invalid route coordinates.");
        }

        routeLayer = L.polyline(coordinates, {
            color: "#1677ff",
            weight: 6,
            opacity: 0.9
        }).addTo(map);

        lastRouteCoordinates = coordinates;

        map.fitBounds(routeLayer.getBounds(), { padding: [35, 35] });

        const distance = Number(result.distance_m ?? result.cost ?? 0);

        setText(
            "routeCost",
            distance >= 1000
                ? `${(distance / 1000).toFixed(2)} km`
                : `${distance.toFixed(0)} m`
        );

        setText("nodesExplored", result.explored ?? 0);
        setText("executionTime", `${Number(result.elapsed_ms ?? 0).toFixed(3)} ms`);
        setText("routeStatus", "Route Found");

        updateStatus(
            `Route found using ${algorithm}. Distance: ${(distance / 1000).toFixed(2)} km. Ambulance departing.`
        );

        animateAmbulance(coordinates);

    } catch (error) {
        console.error("Route error:", error);
        setText("routeStatus", "Error");
        updateStatus(`Could not calculate route: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}

async function showMST() {
    if (!map) return;

    const button = document.getElementById("showMST");
    const algorithmSelect = document.getElementById("mstAlgorithm");
    const algorithm = algorithmSelect ? algorithmSelect.value : "prim";

    button.disabled = true;
    clearMST();
    stopAmbulanceAnimation();

    updateStatus(`Generating minimum spanning tree using ${algorithm}...`);

    try {
        const response = await fetch("/api/mst", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ algorithm })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "MST request failed.");
        }

        if (!Array.isArray(result.edges) || result.edges.length === 0) {
            throw new Error("The MST algorithm returned no edges.");
        }

        const lines = [];

        for (const edge of result.edges) {
            const a = edge.from;
            const b = edge.to;

            const coordinates = [
                [Number(a.lat), Number(a.lon)],
                [Number(b.lat), Number(b.lon)]
            ];

            if (coordinates.some(point => !point.every(Number.isFinite))) {
                throw new Error("MST response contains invalid coordinates.");
            }

            lines.push(coordinates);
        }

        mstLayer = L.layerGroup();

        for (const line of lines) {
            L.polyline(line, {
                color: "#e53935",
                weight: 2,
                opacity: 0.65
            }).addTo(mstLayer);
        }

        mstLayer.addTo(map);

        const total = Number(result.total_weight_m ?? 0);
        const formattedTotal = total >= 1000
            ? `${(total / 1000).toFixed(2)} km`
            : `${total.toFixed(1)} m`;

        updateStatus(
            `${algorithm === "prim" ? "Prim's" : "Kruskal's"} spanning network displayed: ` +
            `${result.edge_count} edges, total weight ${formattedTotal}. ` +
            `Disconnected road sections may produce a spanning forest.`
        );

        console.log("MST result:", result);

    } catch (error) {
        console.error("MST error:", error);
        updateStatus(`Could not generate MST: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}

function resetMap() {
    if (!map) return;

    clearRoute();
    clearMST();

    sourceMarker.setLatLng([DEFAULT_SOURCE.lat, DEFAULT_SOURCE.lng]);
    destinationMarker.setLatLng([
        DEFAULT_DESTINATION.lat,
        DEFAULT_DESTINATION.lng
    ]);

    clickMode = "source";
    map.setView([DEFAULT_SOURCE.lat, DEFAULT_SOURCE.lng], 14);

    syncControls();

    const replayButton = document.getElementById("replayAmbulance");
    if (replayButton) replayButton.disabled = true;

    updateStatus("Map reset to the default Faridabad locations.");
}

document.addEventListener("DOMContentLoaded", initializeMap);