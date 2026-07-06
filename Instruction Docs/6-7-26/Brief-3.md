Brief — Add Schema Versioning (→ Saptha + Shaahir)
Why: Our data format will change as we build the acquisition standard. Right now nothing marks which version of the format a message is using, which is how mismatches creep in silently (a dashboard expecting old fields, hardware sending new ones, and no error — just wrong data). Adding a version stamp means any mismatch is caught loudly instead of showing garbage. This is a small, mechanical change — no data fields change, we're just stamping every message with a version.
The change — three parts:
1. Every message carries a schema_version field.
Add a top-level field to every message (telemetry, platform_status, command), right next to type and ts:
json{
  "type": "telemetry",
  "schema_version": "1.0.0",
  "ts": 1719750000000,
  "vehicle": { ... },
  "tyres": { ... },
  "gps": { ... }
}

Current version is 1.0.0. (We use this format: MAJOR.MINOR.PATCH — bump MAJOR when a change breaks old readers, MINOR when we add fields safely, PATCH for tiny fixes. For now, everything is 1.0.0.)
Backend/mock senders (Shaahir): stamp "schema_version": "1.0.0" on every outgoing message from the mock scripts (mock_telemetry, mock_rc_platform, mock_platform) and anything the backend generates.
Dashboards (Saptha + Sathish's Dashboard 2): stamp it on every command the dashboard sends too.

2. Both dashboards define the version they expect, in one place.
At the top of each dashboard's main JS file, a single constant:
javascriptconst EXPECTED_SCHEMA_VERSION = "1.0.0";
Not scattered — one constant per dashboard, so when the version changes there's exactly one line to update.
3. On every message received, check the version — warn on mismatch, don't crash.
When a dashboard receives a message, compare its schema_version against EXPECTED_SCHEMA_VERSION:

Match → process normally, as today.
Mismatch → log a clear, visible warning to the dashboard's terminal/console panel — e.g. ⚠ SCHEMA MISMATCH: received 1.1.0, dashboard expects 1.0.0 — data may render incorrectly. Update the dashboard. — but still attempt to render (don't blank the screen). The point is a loud, visible signal, not a crash.
If a message arrives with no schema_version at all, treat that as a mismatch too (it's an old/unstamped sender) and warn: ⚠ message has no schema_version — sender needs updating.

Where the version lives as the source of truth: add a ## Schema Version section near the top of docs/MESSAGE_SCHEMA.md stating the current version is 1.0.0, and a rule: any change to the schema bumps this version and gets logged in the change-log table — and no schema change ships without updating this number. (This is the rule that stops drift.)
Definition of done:

Every mock sender and both dashboards stamp schema_version: "1.0.0" on every message.
Each dashboard has one EXPECTED_SCHEMA_VERSION constant and warns visibly on mismatch or missing version, without crashing.
MESSAGE_SCHEMA.md states the current version and the "bump-on-change" rule.
Test it: temporarily change one mock sender to send "1.1.0", confirm the dashboard shows the warning, then change it back. (This proves the check actually works — don't skip it.)

Verification (you): have them show you the mismatch warning firing in the test, not just tell you it's done. That test is the whole point — a version check that's never been seen to fire might not work.