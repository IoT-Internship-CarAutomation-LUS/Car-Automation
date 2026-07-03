// Vehicle Control Console — built against MESSAGE_SCHEMA.md
// Outbound: { type: "command", action, ... }
// Inbound:  { type: "platform_status", ts, drive_state, avoidance_state, distance_m,
//             target_distance_m, speed_kmh, target_speed_kmh, obstacle_cm, heading_deg, battery_mv }

lucide.createIcons();

let socket = null;
let lastStatusTs = null;
let freshnessTimer = null;

const STALE_MS = 3000; // matches schema's freshness rule: now - ts > 3000ms => stale

// Every control that actually commands the platform — disabled until a device
// is connected, so these are never just decorative UI.
const CONTROL_IDS = [
    'btn-start', 'btn-stop', 'btn-forward', 'btn-left', 'btn-right',
    'btn-backward', 'btn-brake', 'btn-estop', 'slider-speed'
];

function setControlsEnabled(enabled) {
    CONTROL_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !enabled;
    });
}

// ---------- Connection ----------

function connectPlatformStream() {
    const url = document.getElementById('ws-url').value.trim();
    if (!url) return;

    if (socket) {
        socket.close();
    }

    setConnectionStatus('CONNECTING');
    setControlsEnabled(false);
    logStatus(`Connecting to ${url} ...`);

    try {
        socket = new WebSocket(url);
    } catch (e) {
        setConnectionStatus('OFFLINE');
        logStatus(`Connection failed: ${e.message}`);
        return;
    }

    socket.onopen = () => {
        setConnectionStatus('ONLINE');
        setControlsEnabled(true);
        logStatus('Socket open. Awaiting platform_status frames...');
        startFreshnessWatch();
    };

    socket.onclose = () => {
        setConnectionStatus('OFFLINE');
        setControlsEnabled(false);
        logStatus('Socket closed.');
        stopFreshnessWatch();
    };

    socket.onerror = () => {
        logStatus('Socket error.');
    };

    socket.onmessage = (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            logStatus(`Received non-JSON frame, ignored.`);
            return;
        }
        if (msg.type === 'platform_status') {
            handlePlatformStatus(msg);
        }
        // command/telemetry types are ignored here — this console only consumes platform_status
    };
}

function setConnectionStatus(state) {
    const el = document.getElementById('connection-status');
    const labels = { ONLINE: '🟢 ONLINE', CONNECTING: '🟡 CONNECTING', OFFLINE: '🔴 OFFLINE' };
    el.textContent = labels[state] || state;
    el.className = 'font-mono font-bold ' +
        (state === 'ONLINE' ? 'text-emerald-500' :
         state === 'CONNECTING' ? 'text-amber-500' : 'text-rose-500');
}

// ---------- Outbound commands ----------

function sendCommand(action, extra) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        logCommand(`Cannot send "${action}" — not connected.`);
        return;
    }
    const payload = Object.assign({ type: 'command', action }, extra || {});
    socket.send(JSON.stringify(payload));
    logCommand(JSON.stringify(payload));
}

function onSliderInput() {
    const val = parseFloat(document.getElementById('slider-speed').value).toFixed(1);
    document.getElementById('txt-slider-value').textContent = val;
}

function onSliderCommit() {
    const val = parseFloat(document.getElementById('slider-speed').value);
    // If already driving forward, this changes target speed live; otherwise it just
    // sets the value that "Forward" will use next.
    if (document.getElementById('txt-drive-state').textContent === 'FORWARD') {
        sendCommand('set_speed', { target_speed_kmh: val });
    }
}

// Override the plain "forward" button to include current slider target speed
function sendForward() {
    const val = parseFloat(document.getElementById('slider-speed').value);
    sendCommand('forward', { target_speed_kmh: val });
}

function sendSteer(direction) {
    // NOTE: "left"/"right" (and "start", below) are not yet in MESSAGE_SCHEMA.md
    // — using the same verb-style action pattern as forward/stop/brake until the
    // team lead adds an official entry (and the firmware agrees on it).
    sendCommand(direction);
    flashSteerButton(direction);
}

function flashSteerButton(direction) {
    const btn = document.getElementById(direction === 'left' ? 'btn-left' : 'btn-right');
    btn.classList.add('border-blue-400', 'bg-blue-500/20');
    setTimeout(() => btn.classList.remove('border-blue-400', 'bg-blue-500/20'), 250);
}

function sendEstop() {
    // Official schema action — see MESSAGE_SCHEMA.md section 4:
    // "estop always wins... stays stopped until a fresh forward."
    sendCommand('estop');
    setDriveStateVisual('ESTOP');
    flashEstop();
}

function flashEstop() {
    const btn = document.getElementById('btn-estop');
    btn.classList.add('estop-pulse');
    setTimeout(() => btn.classList.remove('estop-pulse'), 1000);
}

// ---------- Inbound platform_status ----------

function handlePlatformStatus(msg) {
    lastStatusTs = msg.ts || Date.now();

    setDriveStateVisual(msg.drive_state);
    setAvoidanceBanner(msg.avoidance_state);

    document.getElementById('txt-distance').textContent = fmt(msg.distance_m, 1);
    document.getElementById('txt-target-distance').textContent = fmt(msg.target_distance_m, 1);
    const pct = (msg.distance_m != null && msg.target_distance_m)
        ? Math.min(100, (msg.distance_m / msg.target_distance_m) * 100)
        : 0;
    document.getElementById('bar-distance').style.width = pct + '%';

    document.getElementById('txt-speed').textContent = fmt(msg.speed_kmh, 1);
    document.getElementById('txt-target-speed').textContent = fmt(msg.target_speed_kmh, 1);

    if (msg.obstacle_cm === -1 || msg.obstacle_cm == null) {
        document.getElementById('txt-obstacle').textContent = '--';
        document.getElementById('txt-obstacle-note').textContent = 'no reading';
    } else {
        document.getElementById('txt-obstacle').textContent = fmt(msg.obstacle_cm, 0);
        document.getElementById('txt-obstacle-note').textContent = 'front sensor';
    }

   const headingElement = document.getElementById("txt-heading");

if (msg.heading_deg != null) {

    headingElement.innerHTML = `
        <div class="text-xl font-bold">
            ${fmt(msg.heading_deg, 1)}°
        </div>

        <div class="text-xs text-cyan-400 mt-1">
            ${getHeadingDirection(msg.heading_deg)}
        </div>
    `;

} else {

    headingElement.innerHTML = "--";

}

    document.getElementById('txt-battery').innerHTML =
        (msg.battery_mv != null ? (msg.battery_mv / 1000).toFixed(2) : '--.-') +
        ' <span class="text-xs text-slate-500">V</span>';

    logStatus(JSON.stringify(msg));
    markFresh();
}

function setDriveStateVisual(state) {
    const el = document.getElementById('txt-drive-state');
    el.textContent = state || '--';
    el.className = 'text-2xl font-extrabold font-mono ' +
        (state === 'ESTOP' ? 'text-rose-500' :
         state === 'FORWARD' ? 'text-emerald-400' :
         state === 'BRAKING' ? 'text-orange-400' :
         state === 'STOPPED' ? 'text-amber-400' : 'text-white');
}

function setAvoidanceBanner(state) {
    const banner = document.getElementById('avoidance-banner');
    const text = document.getElementById('avoidance-text');
    const icon = document.getElementById('avoidance-icon');

    const map = {
        CLEAR:   { label: '✅ CLEAR',   bg: 'bg-emerald-500/10 border-emerald-500/30', txt: 'text-emerald-400', ic: 'shield-check' },
        SLOWING: { label: '⚠️ SLOWING', bg: 'bg-amber-500/10 border-amber-500/30',     txt: 'text-amber-400',   ic: 'shield-alert' },
        BRAKING: { label: '🛑 BRAKING', bg: 'bg-rose-500/10 border-rose-500/30',       txt: 'text-rose-400',    ic: 'shield-x' },
    };
    const cfg = map[state] || { label: 'UNKNOWN', bg: 'bg-slate-800/50 border-slate-800', txt: 'text-slate-400', ic: 'shield' };

    banner.className = `px-6 py-3 border-b flex items-center justify-center gap-3 transition-colors ${cfg.bg}`;
    text.className = `text-sm font-bold tracking-widest uppercase ${cfg.txt}`;
    text.textContent = cfg.label;
    icon.setAttribute('data-lucide', cfg.ic);
    icon.className = `w-5 h-5 ${cfg.txt}`;
    lucide.createIcons();
}

// ---------- Freshness indicator ----------

function startFreshnessWatch() {
    stopFreshnessWatch();
    freshnessTimer = setInterval(markFresh, 500);
}

function stopFreshnessWatch() {
    if (freshnessTimer) clearInterval(freshnessTimer);
    freshnessTimer = null;
    document.getElementById('freshness-dot').className = 'w-2 h-2 rounded-full bg-slate-600';
    document.getElementById('txt-freshness').textContent = 'no data';
}

function markFresh() {
    if (lastStatusTs == null) return;
    const age = Date.now() - lastStatusTs;
    const dot = document.getElementById('freshness-dot');
    const label = document.getElementById('txt-freshness');
    if (age > STALE_MS) {
        dot.className = 'w-2 h-2 rounded-full bg-slate-600';
        label.textContent = `⚪ stale (${Math.round(age / 1000)}s ago)`;
    } else {
        dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
        label.textContent = '🟢 live';
    }
}

// ---------- Logs ----------

function logCommand(text) {
    const el = document.getElementById('command-log');
    if (el.textContent.includes('No commands sent yet')) el.textContent = '';
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
}

function logStatus(text) {
    const el = document.getElementById('status-terminal');
    if (el.textContent.includes('Disconnected.')) el.textContent = '';
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
    // keep log from growing unbounded
    while (el.childNodes.length > 100) el.removeChild(el.firstChild);
}

function fmt(v, decimals) {
    if (v == null || Number.isNaN(v)) return '--';
    return Number(v).toFixed(decimals);
}
function getHeadingDirection(degrees) {

    if (degrees === null || degrees === undefined || isNaN(degrees)) {
        return "--";
    }

    degrees = ((degrees % 360) + 360) % 360;

    const directions = [
        "North",
        "North-North-East",
        "North-East",
        "East-North-East",
        "East",
        "East-South-East",
        "South-East",
        "South-South-East",
        "South",
        "South-South-West",
        "South-West",
        "West-South-West",
        "West",
        "West-North-West",
        "North-West",
        "North-North-West"
    ];

    const index = Math.round(degrees / 22.5) % 16;

    return directions[index];
}
