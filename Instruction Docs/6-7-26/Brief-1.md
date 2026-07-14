Brief 1 — Vehicle Research *DOC* (→ Sathish/Venkat/Pavan, verified by Saptha)Goal: Recommend a specific car (make/model/year) that we can borrow/use to validate our data-acquisition system, because not all India-market cars implement OBD-II cleanly. We need one with well-documented, standard-compliant OBD-II so our 32-byte packet actually reads correctly.Deliver a table covering 8–10 common India-market cars (petrol, post-2010, ideally a mix of Maruti Suzuki, Hyundai, Tata, Honda, Toyota — the ones actually available around you), with these exact columns:
Make / Model / Year range
OBD-II protocol used (e.g. ISO 15765 / CAN, ISO 9141-2, KWP2000) — CAN-based (ISO 15765) is what we want
Standard OBD-II PID support — does it expose the standard Mode 01 PIDs we need: RPM (0x0C), speed (0x0D), coolant (0x05), engine load (0x04), throttle (0x11), fuel level (0x2F), intake temp (0x0F), MAF (0x10)? Note any that are known not to report.
Known issues / quirks — anything documented about this model being difficult to read, non-compliant, or needing manufacturer-specific PIDs
Availability to us — does anyone on the team / family / the office have access to this car? (This matters as much as compliance.)
Source link for each compliance claim
Then: a short ranked recommendation — top 3 cars, why, and which is the single best pick considering both clean OBD-II and actually available to borrow.Rules for whoever does this:

Every compliance claim needs a source link — no "I think it supports it."
Do not research TPMS here — Indian cars mostly lack factory TPMS; we're installing our own aftermarket sensors, so factory tyre data is irrelevant to this pick.
If using Claude to help, paste its answer with the source links so Saptha can verify — an unsourced claim gets sent back.
Verification (Saptha): spot-check 2–3 of the compliance claims against the linked source before it comes to me. Reject any row without a working source.