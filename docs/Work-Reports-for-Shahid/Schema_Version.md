# Technical Brief: Implementation of Schema Versioning (v1.0.0)

**To:** Shahid  
**From:** Shaahir (Team Lead) & Backend/Data-Acquisition Team  
**Date:** July 6, 2026  
**Subject:** Implementation of Message Schema Versioning across Backend, Mock Hardware, and Telemetry UI  

---

## 1. Executive Summary & Why We Did This

As we build out our custom in-house data acquisition hardware (ELM327 + ESP32 + TPMS), the JSON payload structure between the vehicle and our dashboards will naturally evolve. Until today, our real-time WebSocket pipeline had **no mechanism to identify which version of the data format a message was using**.

Without versioning, schema mismatches create silent, dangerous bugs: an updated dashboard expecting new sensor fields receives old hardware packets (or vice-versa) and renders garbage data without triggering any errors. 

To eliminate silent drift, we have implemented **Schema Versioning (`v1.0.0`)** across our central backend, simulation hardware, and Telemetry Dashboard (Dashboard 1). Every message now carries an explicit version stamp, and our receivers enforce a **"warn loudly, never crash"** resiliency protocol.

> [!IMPORTANT]
> **Core Resiliency Rule:** A schema version mismatch will **never crash the server or blank the dashboard screen**. Instead, both the server logs and the dashboard terminal block immediately display prominent warnings while still attempting to render whatever valid data fields are present.

---

## 2. Versioning Standard & Governance

We have adopted semantic versioning (**`MAJOR.MINOR.PATCH`**):
* **`MAJOR` (1.x.x):** Incremented for breaking changes (e.g., removing fields, renaming core keys, altering data types).
* **`MINOR` (x.1.x):** Incremented for backwards-compatible additions (e.g., adding a new sensor metric like `brake_pct`).
* **`PATCH` (x.x.1):** Incremented for tiny fixes or documentation adjustments.

### Single Source of Truth
The official schema specifications and version governance reside in [docs/MESSAGE_SCHEMA.md](file:///C:/Users/luisk/OneDrive/Desktop/Work/HIWTHS/Car-Automation/docs/MESSAGE_SCHEMA.md). 

> [!CAUTION]
> **Bump-on-Change Rule:** No team member is permitted to modify message structures in firmware or UI code without first updating [MESSAGE_SCHEMA.md](file:///C:/Users/luisk/OneDrive/Desktop/Work/HIWTHS/Car-Automation/docs/MESSAGE_SCHEMA.md), bumping the version number, and logging the change in the official changelog table.

---

## 3. Detailed Implementation Breakdown

| Component | Responsibility | Status | Key Details |
| :--- | :--- | :--- | :--- |
| **Backend Config** | `backend/config.py` | ✅ Completed | Added central `SCHEMA_VERSION = "1.0.0"` constant. |
| **WebSocket Broker** | `backend/websocket_handler.py` | ✅ Completed | Inspects incoming packets; logs server warnings on mismatch while forwarding as-is. |
| **Telemetry Mock** | `backend/mock_telemetry.py` | ✅ Completed | Independent version constant; stamps `schema_version` on all outbound vehicle packets. |
| **RC Platform Mock** | `backend/mock_rc_platform.py` | ✅ Completed | Independent version constant; stamps `schema_version` on all outbound status packets. |
| **Dashboard 1 (UI)** | `dashboard-telemetry/a.js` | ✅ Completed | Defines `EXPECTED_SCHEMA_VERSION`; warns in UI terminal on mismatch; stamps outbound commands. |
| **Schema Docs** | `docs/MESSAGE_SCHEMA.md` | ✅ Completed | Added Section 0/1 versioning rules; formalized `brake_pct` field; logged v1.0.0 release. |
| **Dashboard 2 (UI)** | `dashboard-control/` | ⏳ Pending | Assigned to subordinate UI team for implementation. |

---

### A. Central Backend & WebSocket Broker ([config.py](file:///C:/Users/luisk/OneDrive/Desktop/Work/HIWTHS/Car-Automation/backend/config.py) & [websocket_handler.py](file:///C:/Users/luisk/OneDrive/Desktop/Work/HIWTHS/Car-Automation/backend/websocket_handler.py))
We centralized the server's version expectation in `config.py`. In `websocket_handler.py`, the WebSocket broker inspects every incoming packet before routing:
```python
# websocket_handler.py inspection snippet
schema_ver = message.get("schema_version")

if schema_ver != config.SCHEMA_VERSION:
    print(f"[WS] ⚠ SCHEMA MISMATCH: Client {client.host} sent version '{schema_ver}' (expected '{config.SCHEMA_VERSION}'). Forwarding as-is.")
```
* **Why forward as-is?** By forwarding the mismatched packet to connected dashboards, we allow the frontend UI to trigger its own visual warning badges for the operator.

### B. Hardware Mock Senders ([mock_telemetry.py](file:///C:/Users/luisk/OneDrive/Desktop/Work/HIWTHS/Car-Automation/backend/mock_telemetry.py) & [mock_rc_platform.py](file:///C:/Users/luisk/OneDrive/Desktop/Work/HIWTHS/Car-Automation/backend/mock_rc_platform.py))
Per team lead architectural decision, mock senders maintain **independent version declarations** at the top of their scripts rather than importing from `config.py`. 
* **Why?** This gives us an immediate testing harness. To purposely test how our server and dashboards react to outdated or future telemetry, an engineer simply changes `SCHEMA_VERSION = "1.1.0"` inside the mock script without altering server configurations.
* Both scripts now stamp `"schema_version": SCHEMA_VERSION` as a top-level attribute alongside `"type"` and `"ts"`. *(Note: `mock_platform.py` was ignored as it is deprecated in favor of `mock_rc_platform.py`).*

### C. Dashboard 1 — Telemetry UI ([dashboard-telemetry/a.js](file:///C:/Users/luisk/OneDrive/Desktop/Work/HIWTHS/Car-Automation/dashboard-telemetry/a.js))
We upgraded the primary telematics dashboard to enforce schema compliance:
1. **Expected Constant:** Added `const EXPECTED_SCHEMA_VERSION = "1.0.0";` at line 2.
2. **Inbound Validation Engine:** Inside `processIncomingMessage()`, incoming JSON frames are checked against the expected version. On mismatch or missing version, a high-visibility yellow alert is injected into the live serial terminal log (`#serial-terminal`):
   ```html
   <div class="text-amber-400 font-mono">[WARN] ⚠ SCHEMA MISMATCH: received 1.1.0, dashboard expects 1.0.0 — data may render incorrectly. Update the dashboard.</div>
   ```
3. **Outbound Command Stamping:** When an operator transmits a driver message from Dashboard 1, the outbound JSON packet is automatically stamped with `"schema_version": EXPECTED_SCHEMA_VERSION`.
4. **Cache-Busting Deployment:** Updated `index.html` script reference to `<script src="a.js?v=2.0.1"></script>` to force web browsers to invalidate stale caches and execute the new validation logic immediately.

### D. Schema Standardization & `brake_pct` Formalization ([MESSAGE_SCHEMA.md](file:///C:/Users/luisk/OneDrive/Desktop/Work/HIWTHS/Car-Automation/docs/MESSAGE_SCHEMA.md))
While updating the documentation for versioning, we also resolved a pending technical debt item:
* Formalized **`vehicle.brake_pct`** (integer `0–100%`, representing analog brake pedal pressure depth) in Section 2.
* Removed `brake_pct` from Section 8 (*Known Drift*), officially sanctioning its use across hardware, backend, and frontend dashboards.
* Added the official `v1.0.0` release entry into the Section 7 changelog.

---

## 4. Verification & Live Testing Results

To prove the resiliency protocol works under real-world conditions, we conducted an intentional mismatch test:

1. **Test Setup:** Temporarily modified `mock_telemetry.py` to transmit `"schema_version": "1.1.0"`.
2. **Server-Side Verification:** Upon connection, the backend terminal immediately flagged the discrepancy without dropping the connection:
   ```
   [WS] Client connected: 127.0.0.1:54321 | Total: 1
   [WS] ⚠ SCHEMA MISMATCH: Client 127.0.0.1 sent version '1.1.0' (expected '1.0.0'). Forwarding as-is.
   ```
3. **Client-Side Verification:** On Dashboard 1, the live serial terminal block displayed the yellow warning badge above the raw RX stream:
   ```
   [WARN] ⚠ SCHEMA MISMATCH: received 1.1.0, dashboard expects 1.0.0 — data may render incorrectly. Update the dashboard.
   [RX] {"type": "telemetry", "schema_version": "1.1.0", "ts": 1783341200000, ...}
   ```
4. **Render Check:** Verified that telemetry cards (RPM, Speed, Brake Pressure Bar) continued to render smoothly without screen blanking or JS console exceptions.
5. **Teardown:** Reverted `mock_telemetry.py` back to `"1.0.0"`.

---

## 5. Next Steps & Subordinate Task Handoff

With the backend, mock hardware, and primary telemetry UI fully compliant and verified, the remaining work is scoped to **Dashboard 2 (Control Console)**:

* **Task Owner:** Subordinate UI Team (Saptha / Sathish)
* **Scope of Work in `dashboard-control/control-console.js`:**
  1. Define `const EXPECTED_SCHEMA_VERSION = "1.0.0";` at the top of the script.
  2. Stamp `"schema_version": EXPECTED_SCHEMA_VERSION` on all outbound control commands (Drive D-pad, Target Speed Slider, E-Stop button).
  3. In the WebSocket message handler, check incoming `platform_status` packets against `EXPECTED_SCHEMA_VERSION`. If mismatched or unstamped, log a warning into `#status-terminal` / `#command-log` while continuing to render distance and battery bars.
