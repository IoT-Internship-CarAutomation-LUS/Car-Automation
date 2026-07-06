// ======================================================
// PLATFORM HISTORY DASHBOARD
// Part 4.1
// ======================================================

// REST API
const HISTORY_API =
    "https://api.nalusa.space/api/platform/history?limit=100";

// Stores every history record
let historyData = [];

// Chart instances (created later)
let speedChart = null;
let batteryChart = null;
let distanceChart = null;

// ======================================================
// INITIALIZATION
// ======================================================

window.addEventListener("DOMContentLoaded", () => {

    // Lucide Icons
    if (window.lucide) {
        lucide.createIcons();
    }

    // Load history immediately
    loadHistory();

    // Refresh button
    const refreshBtn = document.getElementById("btn-refresh-history");

    if (refreshBtn) {
        refreshBtn.addEventListener("click", loadHistory);
    }

});

// ======================================================
// LOAD HISTORY FROM REST API
// ======================================================

async function loadHistory() {

    try {

        console.log("Loading history...");

        const tbody =
            document.getElementById("history-table-body");

        if (tbody) {

            tbody.innerHTML = `

            <tr>

                <td colspan="7"
                    class="text-center py-10 text-slate-400">

                    Loading history...

                </td>

            </tr>

            `;

        }

        const response = await fetch(HISTORY_API);

        if (!response.ok) {

            throw new Error(
                "Server returned " + response.status
            );

        }

        historyData = await response.json();

        console.log(historyData);

        // Update dashboard
        updateSummaryCards();

        // These functions will be added
        drawCharts();

        renderSafetyEvents();

        renderHistoryTable(historyData);

    }

    catch (error) {

        console.error(error);

        const tbody =
            document.getElementById("history-table-body");

        if (tbody) {

            tbody.innerHTML = `

            <tr>

                <td colspan="7"
                    class="text-center py-10 text-red-400">

                    Failed to load history.

                </td>

            </tr>

            `;

        }

    }

}

// ======================================================
// SUMMARY CARDS
// ======================================================

function updateSummaryCards() {

    if (!historyData.length)
        return;

    const total = historyData.length;

    const speeds =
        historyData.map(item => Number(item.speed_kmh) || 0);

    const distances =
        historyData.map(item => Number(item.distance_m) || 0);

    const batteries =
        historyData.map(item => Number(item.battery_mv) || 0);

    const averageSpeed =
        speeds.reduce((a, b) => a + b, 0) / speeds.length;

    const maxSpeed =
        Math.max(...speeds);

    const maxDistance =
        Math.max(...distances);

    const lowestBattery =
        Math.min(...batteries);

    document.getElementById(
        "card-total-records"
    ).textContent = total;

    document.getElementById(
        "card-average-speed"
    ).textContent = averageSpeed.toFixed(1);

    document.getElementById(
        "card-max-speed"
    ).textContent = maxSpeed.toFixed(1);

    document.getElementById(
        "card-low-battery"
    ).textContent = (lowestBattery / 1000).toFixed(2);

    document.getElementById(
        "card-max-distance"
    ).textContent = maxDistance.toFixed(1);

}

// ======================================================
// CHARTS
// ======================================================

function drawCharts() {

    if (!historyData.length) return;

    const labels = historyData.map(item => {

        const date = new Date(item.ts);

        return date.toLocaleTimeString();

    });

    const speedData = historyData.map(item =>
        Number(item.speed_kmh) || 0
    );

    const batteryData = historyData.map(item =>
        Number(item.battery_mv) / 1000 || 0
    );

    const distanceData = historyData.map(item =>
        Number(item.distance_m) || 0
    );

    // Destroy old charts before recreating
    if (speedChart) speedChart.destroy();
    if (batteryChart) batteryChart.destroy();
    if (distanceChart) distanceChart.destroy();

    createSpeedChart(labels, speedData);

    createBatteryChart(labels, batteryData);

    createDistanceChart(labels, distanceData);

}

// ======================================================
// SPEED CHART
// ======================================================

function createSpeedChart(labels, data) {

    const ctx = document
        .getElementById("speedChart")
        .getContext("2d");

    speedChart = new Chart(ctx, {

        type: "line",

        data: {

            labels,

            datasets: [{

                label: "Speed (km/h)",

                data,

                borderColor: "#3b82f6",

                backgroundColor: "rgba(59,130,246,0.2)",

                fill: true,

                tension: 0.35,

                pointRadius: 2

            }]

        },

        options: {

            responsive: true,

            plugins: {

                legend: {

                    labels: {

                        color: "#ffffff"

                    }

                }

            },

            scales: {

                x: {

                    ticks: {

                        color: "#94a3b8"

                    },

                    grid: {

                        color: "#1e293b"

                    }

                },

                y: {

                    beginAtZero: true,

                    ticks: {

                        color: "#94a3b8"

                    },

                    grid: {

                        color: "#1e293b"

                    }

                }

            }

        }

    });

}

// ======================================================
// BATTERY CHART
// ======================================================

function createBatteryChart(labels, data) {

    const ctx = document
        .getElementById("batteryChart")
        .getContext("2d");

    batteryChart = new Chart(ctx, {

        type: "line",

        data: {

            labels,

            datasets: [{

                label: "Battery (V)",

                data,

                borderColor: "#10b981",

                backgroundColor: "rgba(16,185,129,.15)",

                fill: true,

                tension: 0.35,

                pointRadius: 2

            }]

        },

        options: {

            responsive: true,

            plugins: {

                legend: {

                    labels: {

                        color: "#ffffff"

                    }

                }

            },

            scales: {

                x: {

                    ticks: {

                        color: "#94a3b8"

                    },

                    grid: {

                        color: "#1e293b"

                    }

                },

                y: {

                    ticks: {

                        color: "#94a3b8"

                    },

                    grid: {

                        color: "#1e293b"

                    }

                }

            }

        }

    });

}

// ======================================================
// DISTANCE CHART
// ======================================================

function createDistanceChart(labels, data) {

    const ctx = document
        .getElementById("distanceChart")
        .getContext("2d");

    distanceChart = new Chart(ctx, {

        type: "line",

        data: {

            labels,

            datasets: [{

                label: "Distance (m)",

                data,

                borderColor: "#f59e0b",

                backgroundColor: "rgba(245,158,11,.18)",

                fill: true,

                tension: 0.35,

                pointRadius: 2

            }]

        },

        options: {

            responsive: true,

            plugins: {

                legend: {

                    labels: {

                        color: "#ffffff"

                    }

                }

            },

            scales: {

                x: {

                    ticks: {

                        color: "#94a3b8"

                    },

                    grid: {

                        color: "#1e293b"

                    }

                },

                y: {

                    beginAtZero: true,

                    ticks: {

                        color: "#94a3b8"

                    },

                    grid: {

                        color: "#1e293b"

                    }

                }

            }

        }

    });

}// ======================================================
// SAFETY EVENTS
// ======================================================

function renderSafetyEvents() {

    const tbody = document.getElementById("safety-events-body");

    tbody.innerHTML = "";

    const events = historyData.filter(item => {

        return (
            item.avoidance_state === "BRAKING" ||
            item.avoidance_state === "SLOWING" ||
            (item.obstacle_cm != null && item.obstacle_cm < 50)
        );

    });

    document.getElementById("event-count").textContent =
        `${events.length} Events`;

    if (events.length === 0) {

        tbody.innerHTML = `

        <tr>

            <td colspan="4"
                class="text-center py-8 text-slate-500">

                No Safety Events

            </td>

        </tr>

        `;

        return;

    }

    events.forEach(item => {

        const row = document.createElement("tr");

        if (item.avoidance_state === "BRAKING") {

            row.className = "danger-row";

        }

        else if (item.avoidance_state === "SLOWING") {

            row.className = "warning-row";

        }

        row.innerHTML = `

            <td class="px-4 py-3">

                ${new Date(item.ts).toLocaleTimeString()}

            </td>

            <td class="px-4 py-3">

                ${item.drive_state}

            </td>

            <td class="px-4 py-3">

                ${item.avoidance_state}

            </td>

            <td class="px-4 py-3">

                ${item.obstacle_cm} cm

            </td>

        `;

        tbody.appendChild(row);

    });

}

// ======================================================
// HISTORY TABLE
// ======================================================

function renderHistoryTable(records) {

    const tbody = document.getElementById("history-table-body");

    tbody.innerHTML = "";

    if (!records.length) {

        tbody.innerHTML = `

        <tr>

            <td colspan="7"
                class="text-center py-8 text-slate-500">

                No History Found

            </td>

        </tr>

        `;

        return;

    }

    records.forEach(item => {

        const row = document.createElement("tr");

        if (item.avoidance_state === "BRAKING") {

            row.classList.add("danger-row");

        }

        else if (item.avoidance_state === "SLOWING") {

            row.classList.add("warning-row");

        }

        row.innerHTML = `

        <td class="px-4 py-3">

            ${new Date(item.ts).toLocaleString()}

        </td>

        <td class="px-4 py-3">

            ${item.drive_state}

        </td>

        <td class="px-4 py-3">

            ${item.avoidance_state}

        </td>

        <td class="px-4 py-3">

            ${Number(item.distance_m).toFixed(1)} m

        </td>

        <td class="px-4 py-3">

            ${Number(item.speed_kmh).toFixed(1)} km/h

        </td>

        <td class="px-4 py-3">

            ${item.obstacle_cm} cm

        </td>

        <td class="px-4 py-3">

            ${(item.battery_mv/1000).toFixed(2)} V

        </td>

        `;

        tbody.appendChild(row);

    });

}

// ======================================================
// SEARCH
// ======================================================

const searchBox = document.getElementById("search-history");

if (searchBox) {

    searchBox.addEventListener("keyup", function () {

        const value = this.value.toLowerCase().trim();

        if (value === "") {

            renderHistoryTable(historyData);

            return;

        }

        const filtered = historyData.filter(item => {

            return (

                String(item.drive_state).toLowerCase().includes(value) ||

                String(item.avoidance_state).toLowerCase().includes(value) ||

                String(item.speed_kmh).includes(value) ||

                String(item.distance_m).includes(value) ||

                String(item.obstacle_cm).includes(value) ||

                new Date(item.ts)
                    .toLocaleString()
                    .toLowerCase()
                    .includes(value)

            );

        });

        renderHistoryTable(filtered);

    });

}