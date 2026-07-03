// Global Data Pipeline References
let socketInstance = null;
let mapInstance = null;
let markerInstance = null;
let chartInstance = null;
let trailPolyline = null;
let trailPoints = [];
const MAX_TRAIL_POINTS = 300;

// ==========================================
// FRESHNESS TRACKING
// Per MESSAGE_SCHEMA.md section 1: every message carries `ts` (ms epoch).
// If now - ts > STALE_THRESHOLD_MS, the panel is considered stale and
// greyed out. Each telemetry sub-object (vehicle / tyres / gps) is
// tracked independently in case a future firmware revision sends them
// on separate cadences.
// ==========================================
const STALE_THRESHOLD_MS = 3000;
const lastSeenTs = {
    vehicle: 0,
    tyres: 0,
    gps: 0
};

// Initialize Vector Icons
lucide.createIcons();

// Automatically configure sub-modules on window load
window.onload = function() {
    initializeSparklineChart();
    initializeGpsMap();
    setInterval(updateFreshnessIndicators, 500);
};

// ==========================================
// SUB-BRANCH: TELEMETRY CHART INITIALIZATION
// ==========================================
function initializeSparklineChart() {
    const canvasContext = document.getElementById('sparkline-canvas').getContext('2d');
    chartInstance = new Chart(canvasContext, {
        type: 'line',
        data: {
            labels: Array(25).fill(''),
            datasets: [{
                data: Array(25).fill(0), // Starts fully clean at zero line
                borderColor: '#3b82f6',
                borderWidth: 2,
                pointRadius: 0,
                fill: false,
                tension: 0.2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { display: false } }
        }
    });
}

// ==========================================
// SUB-BRANCH: GPS MODULE GEOGRAPHIC MAP INITIALIZATION
// ==========================================
function initializeGpsMap() {
    // Default initialization sets map view globally until an active satellite fix occurs
    mapInstance = L.map('map-frame').setView([0, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapInstance);
    
    const positionIndicator = L.divIcon({ 
        html: '<div class="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg animate-pulse"></div>' 
    });
    markerInstance = L.marker([0, 0], { icon: positionIndicator }).addTo(mapInstance);

    // Breadcrumb trail: grows as fixes arrive, capped at MAX_TRAIL_POINTS
    // so a long drive doesn't unbounded-grow the DOM/memory.
    trailPolyline = L.polyline([], { color: '#3b82f6', weight: 3, opacity: 0.55 }).addTo(mapInstance);
}

// ==========================================
// FRESHNESS INDICATOR TICK
// Runs every 500ms independent of message arrival, so a panel correctly
// goes grey even if the hardware silently stops sending.
// ==========================================
// Card containers that actually display each sub-object's values (as
// opposed to controls, like the SIM800L message console, which stays
// interactive regardless of telemetry staleness).
const STALE_CARD_IDS = {
    vehicle: ['card-vehicle-primary', 'card-vehicle-secondary', 'card-fuel', 'card-engine-health'],
    tyres: ['card-tyres'],
    gps: ['card-gps-readout']
};

function updateFreshnessIndicators() {
    const now = Date.now();
    const vehicleFresh = now - lastSeenTs.vehicle <= STALE_THRESHOLD_MS;
    const tyresFresh = now - lastSeenTs.tyres <= STALE_THRESHOLD_MS;
    const gpsFresh = now - lastSeenTs.gps <= STALE_THRESHOLD_MS;

    setDotState('fresh-vehicle', vehicleFresh);
    setDotState('fresh-tyres', tyresFresh);
    setDotState('fresh-gps', gpsFresh);

    setCardStale(STALE_CARD_IDS.vehicle, !vehicleFresh);
    setCardStale(STALE_CARD_IDS.tyres, !tyresFresh);
    setCardStale(STALE_CARD_IDS.gps, !gpsFresh);
}

function setDotState(elementId, isFresh) {
    const dot = document.getElementById(elementId);
    if (!dot) return;
    dot.classList.toggle('fresh', isFresh);
    dot.classList.toggle('stale', !isFresh);
}

function setCardStale(cardIds, isStale) {
    cardIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('value-stale', isStale);
    });
}

// ==========================================
// SUB-BRANCH: HARDWARE DATA RECEIVER SOCKET LINK
// ==========================================
function connectHardwareStream() {
    const interfaceUrl = document.getElementById('ws-url').value;
    const statusIndicator = document.getElementById('connection-status');
    const logTerminal = document.getElementById('serial-terminal');

    if (socketInstance) { socketInstance.close(); }

    statusIndicator.innerText = "CONNECTING...";
    statusIndicator.className = "text-amber-400 font-mono font-bold";

    socketInstance = new WebSocket(interfaceUrl);

    socketInstance.onopen = () => {
        statusIndicator.innerText = "ONLINE";
        statusIndicator.className = "text-emerald-400 font-mono font-bold animate-pulse";
        logTerminal.innerHTML = `<div class="text-slate-400">[SYS] Local serial streaming tunnel open.</div>`;
    };

    socketInstance.onmessage = (packetFrame) => {
        // Pass incoming packets to our isolated processing engine
        processIncomingMessage(packetFrame.data);
    };

    socketInstance.onclose = () => {
        statusIndicator.innerText = "OFFLINE";
        statusIndicator.className = "text-rose-500 font-mono font-bold";
        logTerminal.innerHTML += `<div class="text-rose-500">[SYS] Connection closed. Check hardware IP.</div>`;
    };
}

// ==========================================
// SUB-BRANCH: MESSAGE ENVELOPE ROUTER
// Per MESSAGE_SCHEMA.md section 1: every WebSocket message is JSON with
// a `type` field. This dashboard (Telemetry / Dashboard 1) only acts on
// `type: "telemetry"`. Other envelope types (platform_status, command)
// belong to the Control Console and are logged but otherwise ignored here.
// ==========================================
function processIncomingMessage(rawPayloadString) {
    const logTerminal = document.getElementById('serial-terminal');

    // Print packet frame to system log terminal block
    logTerminal.innerHTML += `<div class="text-blue-400 font-mono">[RX] ${rawPayloadString}</div>`;
    logTerminal.scrollTop = logTerminal.scrollHeight;

    let dataPacket;
    try {
        // NOTE: the dashboard NEVER parses raw binary here. The 32-byte
        // vehicle packet and 16-byte tyre packet (see MESSAGE_SCHEMA.md
        // section 6) are unpacked once, on the firmware/backend side.
        // This browser only ever receives the JSON envelope below.
        dataPacket = JSON.parse(rawPayloadString);
    } catch (jsonParseError) {
        console.error("[BRANCH ERROR] Malformed serial buffer string packet bypass encountered.", jsonParseError);
        return;
    }

    if (dataPacket.type !== 'telemetry') {
        // Not our envelope type (e.g. platform_status / command belong to
        // the Control Console dashboard) — nothing to render here.
        return;
    }

    applyTelemetryPacket(dataPacket);
}

// ==========================================
// SUB-BRANCH: TELEMETRY METRIC PARSING ENGINE
// EXPECTS the `telemetry` envelope exactly as defined in
// MESSAGE_SCHEMA.md section 2:
// {
//   "type": "telemetry", "ts": <ms epoch>,
//   "vehicle": { rpm, speed_kmh, gear, clutch_pct, brake, throttle_pct,
//                engine_load_pct, fuel_level_pct, fuel_mileage_kmpl,
//                coolant_c, intake_temp_c, maf_gps, ac_on, dtc_count,
//                battery_mv },
//   "tyres": { fl|fr|rl|rr: { pressure_kpa, temp_c } },
//   "gps": { lat, lng, speed_kmh, sats, fix }
// }
// All fields are "optional-safe": a missing sub-object means no data for
// that panel this tick; a field present but `null` means the sensor has
// no reading right now (still counts as "fresh", just shows "--").
// ==========================================
function applyTelemetryPacket(dataPacket) {
    const packetTs = dataPacket.ts || Date.now();

    if (dataPacket.vehicle) {
        lastSeenTs.vehicle = packetTs;
        applyVehicleData(dataPacket.vehicle);
    }
    if (dataPacket.tyres) {
        lastSeenTs.tyres = packetTs;
        applyTyreData(dataPacket.tyres);
    }
    if (dataPacket.gps) {
        lastSeenTs.gps = packetTs;
        applyGpsData(dataPacket.gps);
    }
    // Immediately reflect freshness rather than waiting for the next tick
    updateFreshnessIndicators();
}

function fmt(value, decimals, fallback) {
    if (value === undefined || value === null) return fallback !== undefined ? fallback : '--';
    return Number(value).toFixed(decimals);
}

function applyVehicleData(vehicle) {
    // 1. Core CAN Bus mechanical data points
    if (vehicle.speed_kmh !== undefined) {
        document.getElementById('txt-speed').innerText = vehicle.speed_kmh === null ? '--' : vehicle.speed_kmh;

        // Shift and update speed timeline sparkline graph elements.
        // A null reading pushes 0 onto the sparkline (not a skip) so a
        // dropped sensor visibly flatlines instead of silently freezing
        // the last-drawn shape.
        chartInstance.data.datasets[0].data.shift();
        chartInstance.data.datasets[0].data.push(vehicle.speed_kmh === null ? 0 : vehicle.speed_kmh);
        chartInstance.update('none');
    }
    if (vehicle.rpm !== undefined) {
        document.getElementById('txt-rpm').innerText = vehicle.rpm === null ? '--' : vehicle.rpm.toLocaleString();
    }
    if (vehicle.gear !== undefined) {
        document.getElementById('txt-gear').innerText = vehicle.gear === null ? '-' : (vehicle.gear === 0 ? 'N' : vehicle.gear);
    }
    if (vehicle.fuel_mileage_kmpl !== undefined) {
        document.getElementById('txt-fuel').innerHTML = `${fmt(vehicle.fuel_mileage_kmpl, 1)} <span class="text-xs text-slate-500">km/L</span>`;
    }
    if (vehicle.fuel_level_pct !== undefined) {
        document.getElementById('txt-fuel-level').innerText = `${fmt(vehicle.fuel_level_pct, 0)}%`;
    }
    if (vehicle.clutch_pct !== undefined) {
        const clutchVal = vehicle.clutch_pct === null ? 0 : vehicle.clutch_pct;
        document.getElementById('txt-clutch').innerText = vehicle.clutch_pct === null ? '--%' : `${clutchVal}%`;
        document.getElementById('bar-clutch').style.width = `${clutchVal}%`;
    }

    // 2. Safety brake state transitions
    if (vehicle.brake !== undefined) {
        const elementBrakeCard = document.getElementById('card-brake');
        const elementBrakeTxt = document.getElementById('txt-brake');
        if (vehicle.brake === true) {
            elementBrakeCard.className = "bg-rose-950/40 border border-rose-800 text-rose-400 rounded-xl p-4 flex flex-col items-center justify-center text-center";
            elementBrakeTxt.innerText = "ACTIVE";
        } else if (vehicle.brake === false) {
            elementBrakeCard.className = "bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center text-center";
            elementBrakeTxt.innerText = "OFF";
        } else {
            elementBrakeTxt.innerText = "--";
        }
    }

    // 3. Climate control
    if (vehicle.ac_on !== undefined) {
        const badgeAc = document.getElementById('badge-ac');
        if (vehicle.ac_on === true) {
            badgeAc.className = "px-2.5 py-1 text-xs font-bold rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20";
            badgeAc.innerText = "RUNNING";
        } else if (vehicle.ac_on === false) {
            badgeAc.className = "px-2.5 py-1 text-xs font-bold rounded-full bg-slate-800 text-slate-500 border border-slate-700";
            badgeAc.innerText = "OFF";
        } else {
            badgeAc.innerText = "--";
        }
    }

    // 4. Engine health panel
    if (vehicle.coolant_c !== undefined) {
        document.getElementById('txt-coolant').innerHTML = `${fmt(vehicle.coolant_c, 0)} &deg;C`;
    }
    if (vehicle.intake_temp_c !== undefined) {
        document.getElementById('txt-intake').innerHTML = `${fmt(vehicle.intake_temp_c, 0)} &deg;C`;
    }
    if (vehicle.throttle_pct !== undefined) {
        document.getElementById('txt-throttle').innerText = `${fmt(vehicle.throttle_pct, 0)}%`;
    }
    if (vehicle.engine_load_pct !== undefined) {
        document.getElementById('txt-load').innerText = `${fmt(vehicle.engine_load_pct, 0)}%`;
    }
    if (vehicle.maf_gps !== undefined) {
        document.getElementById('txt-maf').innerText = `${fmt(vehicle.maf_gps, 1)} g/s`;
    }
    if (vehicle.battery_mv !== undefined) {
        document.getElementById('txt-battery').innerText = (vehicle.battery_mv === null)
            ? '--.- V'
            : `${(vehicle.battery_mv / 1000).toFixed(1)} V`;
    }
    if (vehicle.dtc_count !== undefined) {
        const badgeDtc = document.getElementById('badge-dtc');
        if (vehicle.dtc_count === null) {
            badgeDtc.innerText = '-- DTC';
            badgeDtc.className = "px-2.5 py-1 text-[10px] font-bold rounded-full bg-slate-800 text-slate-500 border border-slate-700";
        } else {
            badgeDtc.innerText = `${vehicle.dtc_count} DTC`;
            badgeDtc.className = vehicle.dtc_count > 0
                ? "px-2.5 py-1 text-[10px] font-bold rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20"
                : "px-2.5 py-1 text-[10px] font-bold rounded-full bg-slate-800 text-slate-500 border border-slate-700";
        }
    }
}

// TPMS pressure comes over the wire in kPa (see MESSAGE_SCHEMA.md
// section 2). The gauge is displayed in PSI to match the rest of the
// panel; 1 kPa = 0.145038 PSI.
function kpaToPsi(kpa) {
    return kpa * 0.145038;
}

function applyTyreData(tyres) {
    const axialKeys = ['fl', 'fr', 'rl', 'rr'];

    axialKeys.forEach((key) => {
        const wheel = tyres[key];
        if (!wheel) return;

        const textPressureElement = document.getElementById(`press-${key}`);
        const textTempElement = document.getElementById(`temp-${key}`);
        const visualTyreChassisElement = document.getElementById(`tyre-${key}`);

        const psi = wheel.pressure_kpa !== null && wheel.pressure_kpa !== undefined
            ? kpaToPsi(wheel.pressure_kpa)
            : null;

        textPressureElement.innerText = psi !== null ? `${psi.toFixed(1)} PSI` : '-- PSI';
        textTempElement.innerHTML = (wheel.temp_c !== null && wheel.temp_c !== undefined)
            ? `${wheel.temp_c.toFixed(1)} &deg;C`
            : '-- &deg;C';

        const isLowPressure = psi !== null && psi < 26; // Critical low threshold verification limit
        const isHighTemp = wheel.temp_c !== null && wheel.temp_c !== undefined && wheel.temp_c > 90; // schema-defined high-temp alert
        const isAlert = isLowPressure || isHighTemp;

        const positionClasses = (key.startsWith('f') ? 'top-4' : 'bottom-4') + ' ' + (key.endsWith('l') ? '-left-3' : '-right-3');

        if (isAlert) {
            textPressureElement.className = "text-sm font-mono font-bold text-rose-500";
            textTempElement.className = isHighTemp ? "text-[10px] font-mono text-rose-500" : "text-[10px] font-mono text-slate-600";
            visualTyreChassisElement.className = `absolute w-2.5 h-7 bg-rose-600 rounded animate-pulse ${positionClasses}`;
        } else {
            textPressureElement.className = "text-sm font-mono font-bold text-emerald-400";
            textTempElement.className = "text-[10px] font-mono text-slate-600";
            visualTyreChassisElement.className = `absolute w-2.5 h-7 bg-slate-700 rounded ${positionClasses}`;
        }
    });
}

function applyGpsData(gps) {
    const hasFix = gps.fix === true && gps.lat !== null && gps.lat !== undefined && gps.lng !== null && gps.lng !== undefined;

    document.getElementById('txt-lat').innerText = (gps.lat !== null && gps.lat !== undefined) ? gps.lat.toFixed(6) : '--';
    document.getElementById('txt-lng').innerText = (gps.lng !== null && gps.lng !== undefined) ? gps.lng.toFixed(6) : '--';
    document.getElementById('txt-sats').innerText = (gps.sats !== null && gps.sats !== undefined) ? gps.sats : '--';

    const fixLabel = document.getElementById('txt-fix');
    if (hasFix) {
        fixLabel.innerText = 'FIX OK';
        fixLabel.className = 'text-emerald-400';
    } else {
        fixLabel.innerText = 'NO FIX';
        fixLabel.className = 'text-rose-500';
    }

    if (!hasFix) return; // Don't move the marker or extend the trail on a bad/absent fix

    const geographicCoordinates = new L.LatLng(gps.lat, gps.lng);

    markerInstance.setLatLng(geographicCoordinates);
    mapInstance.setView(geographicCoordinates, 16); // Direct zoom locking update on target host tracking focus

    // Breadcrumb trail: append and cap
    trailPoints.push(geographicCoordinates);
    if (trailPoints.length > MAX_TRAIL_POINTS) {
        trailPoints.shift();
    }
    trailPolyline.setLatLngs(trailPoints);
}

// ==========================================
// SUB-BRANCH: COMMAND PACKET SIM800L TRANSMITTER LINK
// ==========================================
function transmitDriverCommand() {
    const textInputField = document.getElementById('input-msg');
    if (socketInstance && socketInstance.readyState === WebSocket.OPEN && textInputField.value.trim() !== "") {
        const standardizedCommandPacket = {
            command: "msg_driver",
            payload: textInputField.value
        };
        socketInstance.send(JSON.stringify(standardizedCommandPacket));
        textInputField.value = "";
    } else {
        console.warn("[BRANCH WARNING] System data tunnel connection state down. Transmission aborted.");
    }
}