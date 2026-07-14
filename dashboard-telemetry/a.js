// Global Data Pipeline References
const EXPECTED_SCHEMA_VERSION = "1.0.0";
let socketInstance = null;
let mapInstance = null;
let markerInstance = null;
let chartInstance = null;
let trailPolyline = null;
let trailPoints = [];
const MAX_TRAIL_POINTS = 300;
let lastVehicleSpeedKmh = null; // for GPS speed_kmh cross-check

// ==========================================
// HISTORY FEATURE (REST) — historical trip data lives in the SQLite
// backend, separate from the live WebSocket stream. Fetched over HTTP.
// ==========================================
const API_BASE = 'https://api.nalusa.space';
const TELEMETRY_HISTORY_URL = `${API_BASE}/api/telemetry/history?limit=100`;
const GPS_TRACK_URL = `${API_BASE}/api/gps/track?limit=200`;
let historyPolyline = null;   // past-trip breadcrumb, distinct from the live trail
let historyChartInstance = null;
let historyRecordsCache = null;

// ==========================================
// DASHBOARD ALERT THRESHOLDS
// Tune these to match the actual vehicle if they differ.
// ==========================================
const RPM_REDLINE = 6500;        // RPM
const FUEL_LOW_PCT = 25;         // amber warning at/below this level
const FUEL_CRITICAL_PCT = 10;    // rose/critical alert at/below this level

// ==========================================
// TRIP ODOMETER
// No odometer field exists in the telemetry schema, so distance is
// accumulated client-side from consecutive GPS fixes (haversine). Resets
// on reconnect or via the manual "Reset" control in the GPS panel.
// ==========================================
let tripDistanceKm = 0;
let lastOdometerPoint = null; // {lat, lng} of the last fix counted
const MIN_ODOMETER_STEP_KM = 0.002; // ~2m: ignores GPS jitter while stationary

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth radius, km
    const toRad = (deg) => deg * (Math.PI / 180);
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function resetTripOdometer() {
    tripDistanceKm = 0;
    lastOdometerPoint = null;
    const el = document.getElementById('txt-trip-distance');
    if (el) el.innerText = '0.00 km';
}

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

    // History modal: close on backdrop click or Escape
    document.getElementById('modal-history').addEventListener('click', (e) => {
        if (e.target.id === 'modal-history') closeHistoryModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !document.getElementById('modal-history').classList.contains('hidden')) {
            closeHistoryModal();
        }
    });
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

    // Past-trip route, loaded on demand from /api/gps/track. Dashed and a
    // different color so it's never confused with the live trail above.
    historyPolyline = L.polyline([], { color: '#a78bfa', weight: 3, opacity: 0.7, dashArray: '6, 6' }).addTo(mapInstance);
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
    vehicle: ['card-vehicle-primary', 'card-gear-clutch', 'card-brake', 'card-fuel', 'card-engine-health'],
    tyres: ['card-tyres'],
    gps: ['card-gps-readout', 'card-trip-odometer']
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

    // Fresh session: clear anything left over from a previous connection
    // so a reconnect can't draw a bogus straight line across the map
    // (old last-point -> new first-point) or show numbers as "fresh"
    // before any new data has actually arrived.
    trailPoints = [];
    if (trailPolyline) trailPolyline.setLatLngs([]);
    lastSeenTs.vehicle = 0;
    lastSeenTs.tyres = 0;
    lastSeenTs.gps = 0;
    lastVehicleSpeedKmh = null;
    resetTripOdometer();
    const lastUpdateEl = document.getElementById('txt-last-update');
    if (lastUpdateEl) lastUpdateEl.innerText = '--:--:--';
    if (chartInstance) {
        chartInstance.data.datasets[0].data = Array(25).fill(0);
        chartInstance.update('none');
    }
    updateFreshnessIndicators();

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

    if (dataPacket.schema_version !== EXPECTED_SCHEMA_VERSION) {
        const receivedVer = dataPacket.schema_version || 'none (unstamped)';
        logTerminal.innerHTML += `<div class="text-amber-400 font-mono">[WARN] ⚠ SCHEMA MISMATCH: received ${receivedVer}, dashboard expects ${EXPECTED_SCHEMA_VERSION} — data may render incorrectly. Update the dashboard.</div>`;
        logTerminal.scrollTop = logTerminal.scrollHeight;
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

    const lastUpdateEl = document.getElementById('txt-last-update');
    if (lastUpdateEl) {
        lastUpdateEl.innerText = new Date(packetTs).toLocaleTimeString();
    }

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

// Dial scales for the twin instrument gauges in card-vehicle-primary.
// Purely visual (ring fill percentage) — the numeric readout underneath
// always shows the exact value regardless of scale.
const SPEED_DIAL_MAX_KMH = 220;
const RPM_DIAL_MAX = 8000;

function setDialPct(dialId, value, max) {
    const dial = document.getElementById(dialId);
    if (!dial) return;
    const pct = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
    dial.style.setProperty('--pct', pct.toFixed(1));
}

function applyVehicleData(vehicle) {
    // 1. Core CAN Bus mechanical data points
    if (vehicle.speed_kmh !== undefined) {
        lastVehicleSpeedKmh = vehicle.speed_kmh; // tracked for GPS speed cross-check
        document.getElementById('txt-speed').innerText = vehicle.speed_kmh === null ? '--' : vehicle.speed_kmh;
        setDialPct('dial-speed', vehicle.speed_kmh, SPEED_DIAL_MAX_KMH);

        // Shift and update speed timeline sparkline graph elements.
        // A null reading pushes 0 onto the sparkline (not a skip) so a
        // dropped sensor visibly flatlines instead of silently freezing
        // the last-drawn shape.
        chartInstance.data.datasets[0].data.shift();
        chartInstance.data.datasets[0].data.push(vehicle.speed_kmh === null ? 0 : vehicle.speed_kmh);
        chartInstance.update('none');
    }
    if (vehicle.rpm !== undefined) {
        const txtRpm = document.getElementById('txt-rpm');
        const rpmDial = document.getElementById('dial-rpm');
        const redlineBadge = document.getElementById('badge-redline');
        if (vehicle.rpm === null) {
            txtRpm.innerText = '--';
            rpmDial.classList.remove('dial-redline');
            redlineBadge.classList.add('hidden');
            setDialPct('dial-rpm', null, RPM_DIAL_MAX);
        } else {
            txtRpm.innerText = vehicle.rpm.toLocaleString();
            setDialPct('dial-rpm', vehicle.rpm, RPM_DIAL_MAX);
            const overRedline = vehicle.rpm > RPM_REDLINE;
            rpmDial.classList.toggle('dial-redline', overRedline);
            redlineBadge.classList.toggle('hidden', !overRedline);
        }
    }
    if (vehicle.gear !== undefined) {
        document.getElementById('txt-gear').innerText = vehicle.gear === null ? '-' : (vehicle.gear === 0 ? 'N' : vehicle.gear);
    }
    if (vehicle.fuel_mileage_kmpl !== undefined) {
        document.getElementById('txt-fuel').innerHTML = `${fmt(vehicle.fuel_mileage_kmpl, 1)} <span class="text-xs text-slate-500">km/L</span>`;
    }
    if (vehicle.fuel_level_pct !== undefined) {
        document.getElementById('txt-fuel-level').innerText = `${fmt(vehicle.fuel_level_pct, 0)}%`;

        const fuelBadge = document.getElementById('badge-fuel-alert');
        if (vehicle.fuel_level_pct === null) {
            fuelBadge.innerText = '--';
            fuelBadge.className = 'px-2.5 py-1 text-[10px] font-bold rounded-full bg-slate-800 text-slate-500 border border-slate-700';
        } else if (vehicle.fuel_level_pct <= FUEL_CRITICAL_PCT) {
            fuelBadge.innerText = 'CRITICAL';
            fuelBadge.className = 'px-2.5 py-1 text-[10px] font-bold rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse';
        } else if (vehicle.fuel_level_pct <= FUEL_LOW_PCT) {
            fuelBadge.innerText = 'LOW FUEL';
            fuelBadge.className = 'px-2.5 py-1 text-[10px] font-bold rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20';
        } else {
            fuelBadge.innerText = 'OK';
            fuelBadge.className = 'px-2.5 py-1 text-[10px] font-bold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
        }
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
            elementBrakeCard.className = "bg-rose-950/40 border border-rose-800 rounded-xl p-5 transition-colors";
            elementBrakeTxt.innerText = "ACTIVE";
            elementBrakeTxt.className = "text-xs font-bold text-rose-400";
        } else if (vehicle.brake === false) {
            elementBrakeCard.className = "bg-slate-900 border border-slate-800 rounded-xl p-5 transition-colors";
            elementBrakeTxt.innerText = "OFF";
            elementBrakeTxt.className = "text-xs font-bold text-slate-500";
        } else {
            elementBrakeTxt.innerText = "--";
        }
    }

    // 2b. Analog brake pressure (vehicle.brake_pct), independent of the
    // boolean brake flag above so both can update on their own cadence.
    if (vehicle.brake_pct !== undefined) {
        const barBrake = document.getElementById('bar-brake');
        const txtBrakePct = document.getElementById('txt-brake-pct');

        if (vehicle.brake_pct === null) {
            barBrake.style.width = '0%';
            txtBrakePct.innerText = '--%';
        } else {
            barBrake.style.width = `${vehicle.brake_pct}%`;
            txtBrakePct.innerText = `${vehicle.brake_pct}%`;
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

    // Cross-check: schema notes gps.speed_kmh should be compared against
    // vehicle.speed_kmh (OBD-derived). A large disagreement flags a bad
    // reading on one side or the other rather than silently picking one.
    const gpsSpeedElement = document.getElementById('txt-gps-speed');
    const deltaElement = document.getElementById('txt-speed-delta');
    if (gps.speed_kmh !== null && gps.speed_kmh !== undefined) {
        gpsSpeedElement.innerText = `${gps.speed_kmh} KM/H`;
        if (lastVehicleSpeedKmh !== null && lastVehicleSpeedKmh !== undefined) {
            const delta = Math.abs(gps.speed_kmh - lastVehicleSpeedKmh);
            if (delta > 15) {
                deltaElement.innerText = `\u0394 ${delta.toFixed(0)} km/h`;
                deltaElement.className = 'text-[10px] font-bold text-rose-500';
            } else if (delta > 5) {
                deltaElement.innerText = `\u0394 ${delta.toFixed(0)} km/h`;
                deltaElement.className = 'text-[10px] font-bold text-amber-400';
            } else {
                deltaElement.innerText = 'MATCH';
                deltaElement.className = 'text-[10px] font-bold text-emerald-400';
            }
        } else {
            deltaElement.innerText = '';
        }
    } else {
        gpsSpeedElement.innerText = '--';
        deltaElement.innerText = '';
    }

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

    // Trip odometer: accumulate distance between consecutive fixes.
    // Small deltas are ignored as GPS jitter rather than real movement.
    if (lastOdometerPoint) {
        const stepKm = haversineDistanceKm(lastOdometerPoint.lat, lastOdometerPoint.lng, gps.lat, gps.lng);
        if (stepKm >= MIN_ODOMETER_STEP_KM) {
            tripDistanceKm += stepKm;
            document.getElementById('txt-trip-distance').innerText = `${tripDistanceKm.toFixed(2)} km`;
        }
    }
    lastOdometerPoint = { lat: gps.lat, lng: gps.lng };

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
                type: "command",
                schema_version: EXPECTED_SCHEMA_VERSION,
                action: "msg_driver",
                payload: textInputField.value
            };
        socketInstance.send(JSON.stringify(standardizedCommandPacket));
        textInputField.value = "";
    } else {
        console.warn("[BRANCH WARNING] System data tunnel connection state down. Transmission aborted.");
    }
}

// ==========================================
// SUB-BRANCH: TRIP HISTORY (REST, not WebSocket)
// Historical data lives in the backend's SQLite store and is pulled over
// HTTP, separate from the live telemetry stream above. Two independent
// features live here:
//   1. Past route overlay on the live Leaflet map (loadPastRoute)
//   2. A modal with a historical speed/RPM chart + trip log table
//      (openHistoryModal / loadTelemetryHistory)
//
// NOTE ON DATA SHAPE: the exact field layout of /api/telemetry/history
// records wasn't fully specified (only rpm, speed_kmh, coolant_c,
// battery_mv, and tyre pressures were called out explicitly, plus "etc").
// normalizeHistoryRecord() below tries a flat shape first, then falls
// back to a nested `vehicle` object matching the live telemetry schema,
// so this keeps working whichever shape the backend actually returns.
// If gear / fuel_level_pct come back under different key names, update
// the fallback chain there.
// ==========================================

function formatHistoryTimestamp(ts) {
    if (ts === null || ts === undefined) return '--';
    const parsed = new Date(ts);
    if (isNaN(parsed.getTime())) return '--';
    return parsed.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function normalizeHistoryRecord(record) {
    const vehicle = record.vehicle || {};
    return {
        ts: record.ts ?? record.timestamp ?? null,
        speed_kmh: record.speed_kmh ?? vehicle.speed_kmh ?? null,
        rpm: record.rpm ?? vehicle.rpm ?? null,
        gear: record.gear ?? vehicle.gear ?? null,
        coolant_c: record.coolant_c ?? vehicle.coolant_c ?? null,
        fuel_level_pct: record.fuel_level_pct ?? vehicle.fuel_level_pct ?? null,
        battery_mv: record.battery_mv ?? vehicle.battery_mv ?? null
    };
}

// --- Modal open/close/tabs ---

function openHistoryModal() {
    document.getElementById('modal-history').classList.remove('hidden');
    loadTelemetryHistory();
}

function closeHistoryModal() {
    document.getElementById('modal-history').classList.add('hidden');
}

function switchHistoryTab(tab) {
    const isAnalytics = tab === 'analytics';
    document.getElementById('panel-analytics').classList.toggle('hidden', !isAnalytics);
    document.getElementById('panel-triplog').classList.toggle('hidden', isAnalytics);

    const activeClasses = 'text-xs font-bold px-3 py-1.5 rounded-t-lg border-b-2 border-blue-500 text-blue-400 transition';
    const inactiveClasses = 'text-xs font-bold px-3 py-1.5 rounded-t-lg border-b-2 border-transparent text-slate-500 hover:text-slate-300 transition';

    document.getElementById('tab-btn-analytics').className = isAnalytics ? activeClasses : inactiveClasses;
    document.getElementById('tab-btn-triplog').className = !isAnalytics ? activeClasses : inactiveClasses;
}

// --- Telemetry history: fetch once, feed both the chart and the table ---

async function loadTelemetryHistory() {
    const statusEl = document.getElementById('history-status');
    statusEl.innerText = 'Loading trip history\u2026';
    statusEl.className = 'text-xs text-slate-500 mb-3';

    try {
        const response = await fetch(TELEMETRY_HISTORY_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rawRecords = await response.json();

        if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
            statusEl.innerText = 'No historical records found.';
            renderHistoryChart([]);
            renderHistoryTable([]);
            return;
        }

        const records = rawRecords.map(normalizeHistoryRecord);
        historyRecordsCache = records;

        statusEl.innerText = `Loaded ${records.length} historical record${records.length === 1 ? '' : 's'}.`;
        renderHistoryChart(records);
        renderHistoryTable(records);
    } catch (err) {
        // Most likely cause in practice: the API doesn't send
        // Access-Control-Allow-Origin for this page's origin, and the
        // browser blocks the response before it ever reaches here.
        console.error('[HISTORY ERROR] Failed to fetch telemetry history.', err);
        statusEl.innerText = 'Failed to load trip history \u2014 check the API is reachable and CORS is enabled for this origin.';
        statusEl.className = 'text-xs text-rose-400 mb-3';
        renderHistoryChart([]);
        renderHistoryTable([]);
    }
}

function renderHistoryChart(records) {
    const canvasContext = document.getElementById('history-chart').getContext('2d');

    if (historyChartInstance) {
        historyChartInstance.destroy();
    }

    historyChartInstance = new Chart(canvasContext, {
        type: 'line',
        data: {
            labels: records.map(r => formatHistoryTimestamp(r.ts)),
            datasets: [
                {
                    label: 'Speed (km/h)',
                    data: records.map(r => r.speed_kmh),
                    borderColor: '#3b82f6',
                    backgroundColor: '#3b82f6',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.25,
                    yAxisID: 'y',
                    spanGaps: true
                },
                {
                    label: 'RPM',
                    data: records.map(r => r.rpm),
                    borderColor: '#f59e0b',
                    backgroundColor: '#f59e0b',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.25,
                    yAxisID: 'y1',
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: '#94a3b8', boxWidth: 12, font: { size: 10 } } }
            },
            scales: {
                x: {
                    ticks: { color: '#64748b', maxRotation: 55, minRotation: 30, autoSkip: true, maxTicksLimit: 12, font: { size: 9 } },
                    grid: { color: '#1e293b' }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    ticks: { color: '#3b82f6', font: { size: 9 } },
                    grid: { color: '#1e293b' },
                    title: { display: true, text: 'km/h', color: '#3b82f6', font: { size: 10 } }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    ticks: { color: '#f59e0b', font: { size: 9 } },
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'RPM', color: '#f59e0b', font: { size: 10 } }
                }
            }
        }
    });
}

function renderHistoryTable(records) {
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = '';

    if (records.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 5;
        emptyCell.className = 'text-center text-slate-600 px-3 py-6';
        emptyCell.textContent = 'No historical records to display.';
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
        return;
    }

    // Most recent snapshot first
    const ordered = [...records].reverse();

    ordered.forEach((record) => {
        const row = document.createElement('tr');
        row.className = 'border-b border-slate-800/60 hover:bg-slate-800/30';

        const cellValues = [
            formatHistoryTimestamp(record.ts),
            (record.speed_kmh !== null && record.speed_kmh !== undefined) ? `${record.speed_kmh} km/h` : '--',
            (record.gear !== null && record.gear !== undefined) ? (record.gear === 0 ? 'N' : record.gear) : '--',
            (record.coolant_c !== null && record.coolant_c !== undefined) ? `${record.coolant_c}\u00b0C` : '--',
            (record.fuel_level_pct !== null && record.fuel_level_pct !== undefined) ? `${record.fuel_level_pct}%` : '--'
        ];

        cellValues.forEach((value, index) => {
            const cell = document.createElement('td');
            cell.className = 'px-3 py-2 ' + (index === 0 ? 'text-slate-400' : 'text-slate-300');
            cell.textContent = value; // textContent, not innerHTML: this is external API data
            row.appendChild(cell);
        });

        tbody.appendChild(row);
    });
}

// --- Past GPS route: draws once onto the live map, separate layer from the live trail ---

async function loadPastRoute() {
    const statusEl = document.getElementById('route-status');
    const btn = document.getElementById('btn-load-route');
    statusEl.innerText = 'Loading past route\u2026';
    statusEl.className = 'text-[10px] text-slate-500';
    btn.disabled = true;

    try {
        const response = await fetch(GPS_TRACK_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const points = await response.json();

        // Spec says the backend already filters to fix == true, but guard
        // defensively anyway in case a point slips through without one.
        const validPoints = Array.isArray(points)
            ? points.filter(p => p && p.fix !== false && p.lat !== null && p.lat !== undefined && p.lng !== null && p.lng !== undefined)
            : [];

        if (validPoints.length === 0) {
            statusEl.innerText = 'No past route points found.';
            return;
        }

        const latLngs = validPoints.map(p => [p.lat, p.lng]);
        historyPolyline.setLatLngs(latLngs);
        mapInstance.fitBounds(historyPolyline.getBounds(), { padding: [30, 30] });

        statusEl.innerText = `Loaded ${validPoints.length} past route point${validPoints.length === 1 ? '' : 's'}.`;
        statusEl.className = 'text-[10px] text-emerald-400';
    } catch (err) {
        console.error('[HISTORY ERROR] Failed to fetch past GPS track.', err);
        statusEl.innerText = 'Failed to load past route \u2014 check network/CORS.';
        statusEl.className = 'text-[10px] text-rose-500';
    } finally {
        btn.disabled = false;
    }
}