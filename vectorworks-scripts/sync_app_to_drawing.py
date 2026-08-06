"""
VW Device Manager — Sync app data into the drawing

Run this from Vectorworks' Script Palette (Window > Palettes > Script).
No selection needed. For every object carrying the 'VWDM Sync' record (i.e.
every device linked via link_selected.py) it writes:

  - Device-level fields onto the device's VWDM Sync record: type, MAC,
    location, notes. (IP + subnet are per-port now, so the device-level
    vwdm_ip / vwdm_subnet fields are cleared.)
  - Per-port fields onto each network jack via a 'VWDM Port' record: the
    port's IP, its untagged/native network, and its tagged (trunked) VLANs.

Mostly one-directional (the app DB is the source of truth); the two exceptions
are drawing-owned and pulled INTO the app first each run: device *type* (from
"Model") and *location* (Room/Rack/Rack U/Slot).

Before running:
  - The app can stay open — the SQLite engine coordinates concurrent access
    (no clobber) and the app auto-refreshes to show what this script wrote.
  - One-time: create a Record Format named exactly "VWDM Port" with three Text
    fields — vwdm_ip, vwdm_untagged, vwdm_tagged. (This is the per-jack
    counterpart to the device-level "VWDM Sync" record.)
  - Optional (only if you track switches and want their IPs on the drawing):
    add two Text fields to the "VWDM Sync" record — vwdm_mgmt_ip, vwdm_oob_ip.
    Writing to them is best-effort, so leaving them off does no harm.
  - Recommended for seeing per-port IPs: add a multi-line Text field named
    vwdm_ports to the "VWDM Sync" record. The sync fills it with a summary of
    every jack's IP + VLANs, so it shows in the Object Info palette when you
    select the DEVICE (the per-socket VWDM Port records can't be shown there),
    and a Data Tag on the device can display it. Also best-effort.
  - The project database is found automatically from the drawing's own path
    (Foo.vwx -> Foo.vwdm beside it); save it there via the app's project menu >
    Save a Copy As. No hardcoded paths — works the same on Mac and Windows.
"""

import json
import os
import sqlite3
import vs

# Each project is a SQLite database that lives BESIDE its drawing with a
# matching name (Foo.vwx -> Foo.vwdm). resolve_project_db() derives that path
# from the active document, so the same script finds the right database on any
# machine with NO hardcoded paths. LEGACY_DB_CANDIDATES is only a last-resort
# fallback to the old single shared database during the transition.
PROJECT_EXT = ".vwdm"
LEGACY_DB_CANDIDATES = [
    r"C:\Users\Gabe\Dropbox\Claude\Database Vectorworks\vw-device-manager\data\vw-device-manager.sqlite3",
    "/Users/gabe/Library/CloudStorage/Dropbox/Claude/Database Vectorworks/vw-device-manager/data/vw-device-manager.sqlite3",
]
# The network-signal list is a SHARED library (universal across all projects),
# so it's one fixed file, not per-project — a small candidates list is fine here.
LIBRARY_CANDIDATES = [
    r"C:\Users\Gabe\Dropbox\Claude\Database Vectorworks\vw-device-manager\data\library.json",
    "/Users/gabe/Library/CloudStorage/Dropbox/Claude/Database Vectorworks/vw-device-manager/data/library.json",
]

# Device-level record.
RECORD_NAME = "VWDM Sync"
FIELD_ID = "vwdm_id"
FIELD_IP = "vwdm_ip"
FIELD_SUBNET = "vwdm_subnet"
FIELD_TYPE = "vwdm_type"
FIELD_MAC = "vwdm_mac"
FIELD_LOCATION = "vwdm_location"
FIELD_NOTES = "vwdm_notes"
# Switch-only device IPs. These two fields are OPTIONAL on the VWDM Sync record
# — only add them (Text fields) if you want switch mgmt/OOB IPs on the drawing.
# Writes are best-effort so setups without these fields keep working.
FIELD_MGMT_IP = "vwdm_mgmt_ip"
FIELD_OOB_IP = "vwdm_oob_ip"
# Human-readable summary of ALL this device's ports (jack: IP [untagged] +tagged),
# written onto the DEVICE record so it shows in the Object Info palette (which
# can't show the per-socket records) and can be surfaced by a Data Tag on the
# device. OPTIONAL field — add a multi-line Text field named vwdm_ports to see
# it; best-effort otherwise.
FIELD_PORTS = "vwdm_ports"

# Per-jack record (one-time setup in VW — see docstring).
PORT_RECORD = "VWDM Port"
PORT_FIELD_IP = "vwdm_ip"
PORT_FIELD_UNTAGGED = "vwdm_untagged"
PORT_FIELD_TAGGED = "vwdm_tagged"

# Object Info fields read FROM the drawing INTO the app (drawing owns these).
# Internal field names confirmed via diagnose_fields.py on a real ConnectCAD
# device — they differ from the Object Info labels (e.g. "Room" -> loc_room).
PIO_FIELD_MODEL = "model"  # Manufacturer "Model" -> device_type
PIO_FIELD_ROOM = "loc_room"  # Location section ...
PIO_FIELD_RACK = "loc_rack"
PIO_FIELD_RACKU = "loc_rackU"
PIO_FIELD_SLOT = "loc_slot"
LOCATION_SEP = " · "  # joins the location parts

# Network-jack identification (see link_selected.py). The signal list is
# managed in the app (Settings tab) and read from the DB; this is the fallback.
SOCKET_RECORD = "Socket"
SOCKET_FIELD_NAME = "name"
SOCKET_FIELD_SIGNAL = "signal"
DEFAULT_NETWORK_SIGNALS = {"LAN"}


def active_doc_path():
    """Full path of the active drawing, or '' if it's unsaved/unavailable."""
    try:
        p = vs.GetFPathName()
    except Exception:
        p = None
    return (p or "").strip()


def resolve_project_db():
    """The project database for the current drawing: same folder + same base
    name + .vwdm. Falls back to the legacy single-DB paths if there's no match
    (e.g. an unsaved drawing during the transition). None if nothing is found."""
    doc = active_doc_path()
    if doc:
        candidate = os.path.splitext(doc)[0] + PROJECT_EXT
        if os.path.exists(candidate):
            return candidate
    for path in LEGACY_DB_CANDIDATES:
        if os.path.exists(path):
            return path
    return None


def set_field_safe(h, record, field, value):
    """SetRField that never aborts the sync if the field isn't on the record
    (e.g. the optional switch mgmt/OOB fields the user hasn't added)."""
    try:
        vs.SetRField(h, record, field, value)
    except Exception:
        pass


def read_type_and_location(h):
    # Device type and location are modeled in ConnectCAD's Object Info, not
    # in the app. Each sync pulls them off the object's PIO record into the
    # app first, then writes them back out — so vwdm_type / vwdm_location
    # mirror the current Model / Location.
    rec = vs.GetParametricRecord(h)
    pio = vs.GetName(rec) if rec else None

    def field(name):
        if not pio:
            return ""
        val = vs.GetRField(h, pio, name)
        return val.strip() if val else ""

    device_type = field(PIO_FIELD_MODEL) or None

    parts = []
    room = field(PIO_FIELD_ROOM)
    rack = field(PIO_FIELD_RACK)
    rack_u = field(PIO_FIELD_RACKU)
    slot = field(PIO_FIELD_SLOT)
    if room:
        parts.append(room)
    if rack:
        parts.append(rack)
    if rack_u:
        parts.append("U" + rack_u)  # rack unit, e.g. "U5"
    if slot:
        parts.append("Slot " + slot)
    location = LOCATION_SEP.join(parts) or None
    return device_type, location


def load_network_signals(conn):
    """Signal names (uppercased) the app flags as network ports, read from the
    SHARED library (data/library.json) — signals are universal across projects
    now (see library.ts), not stored in the project database. `conn` is unused.
    Falls back to DEFAULT_NETWORK_SIGNALS if the library can't be read."""
    for path in LIBRARY_CANDIDATES:
        try:
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                sigs = {s.strip().upper() for s in data.get("networkSignals", []) if s and s.strip()}
                if sigs:
                    return sigs
        except Exception:
            pass
    return set(DEFAULT_NETWORK_SIGNALS)


def network_jacks(h, net_signals):
    """(jack_name, socket_handle) for each network socket contained in device h."""
    jacks = []
    child = vs.FInGroup(h)
    while child:
        rec = vs.GetParametricRecord(child)
        if rec and vs.GetName(rec) == SOCKET_RECORD:
            signal = vs.GetRField(child, SOCKET_RECORD, SOCKET_FIELD_SIGNAL) or ""
            if signal.strip().upper() in net_signals:
                name = vs.GetRField(child, SOCKET_RECORD, SOCKET_FIELD_NAME) or ""
                jacks.append((name.strip(), child))
        child = vs.NextObj(child)
    return jacks


def build_ports_summary(cur, device_id):
    """One readable line per port for the device-level vwdm_ports field, e.g.:
        1GB A: 10.46.20.102 [Mgmt] +Prod, Guest
        1GB B: [Prod]
    This is what the Object Info palette / a Data Tag on the device can show,
    since the per-socket records aren't reachable there."""
    cur.execute(
        """
        SELECT p.label, p.ip_address, s.name
        FROM ports p
        LEFT JOIN subnets s ON s.id = p.untagged_subnet_id
        WHERE p.device_id = ?
        ORDER BY p.label COLLATE NOCASE
        """,
        (device_id,),
    )
    lines = []
    for label, ip_address, untagged_name in cur.fetchall():
        cur.execute(
            """
            SELECT s.name FROM port_tagged_vlans t
            JOIN subnets s ON s.id = t.subnet_id
            WHERE t.port_id = (SELECT id FROM ports WHERE device_id = ? AND label = ?)
            ORDER BY s.name COLLATE NOCASE
            """,
            (device_id, label),
        )
        tagged = ", ".join(r[0] for r in cur.fetchall())
        parts = []
        if ip_address:
            parts.append(ip_address)
        if untagged_name:
            parts.append("[" + untagged_name + "]")
        if tagged:
            parts.append("+" + tagged)
        if parts:
            lines.append("{0}: {1}".format(label, " ".join(parts)))
        else:
            lines.append("{0}:".format(label))
    return "\n".join(lines)


def write_port_records(cur, device_id, h, net_signals):
    """For each network jack, write its port's IP + VLANs onto a VWDM Port record."""
    written = 0
    for jack_name, sock in network_jacks(h, net_signals):
        if not jack_name:
            continue
        cur.execute(
            """
            SELECT p.id, p.ip_address, s.name
            FROM ports p
            LEFT JOIN subnets s ON s.id = p.untagged_subnet_id
            WHERE p.device_id = ? AND p.vw_socket_key = ?
            """,
            (device_id, jack_name),
        )
        prow = cur.fetchone()
        if prow is None:
            continue  # jack not linked to a port yet — run link_selected.py
        port_id, ip_address, untagged_name = prow

        cur.execute(
            """
            SELECT s.name FROM port_tagged_vlans t
            JOIN subnets s ON s.id = t.subnet_id
            WHERE t.port_id = ? ORDER BY s.name COLLATE NOCASE
            """,
            (port_id,),
        )
        tagged = ", ".join(r[0] for r in cur.fetchall())

        # Attach the record the first time, then fill it.
        if vs.GetRField(sock, PORT_RECORD, PORT_FIELD_IP) is None:
            vs.SetRecord(sock, PORT_RECORD)
        vs.SetRField(sock, PORT_RECORD, PORT_FIELD_IP, ip_address or "")
        vs.SetRField(sock, PORT_RECORD, PORT_FIELD_UNTAGGED, untagged_name or "")
        vs.SetRField(sock, PORT_RECORD, PORT_FIELD_TAGGED, tagged)
        written += 1
    return written


def main():
    db_path = resolve_project_db()
    if db_path is None:
        doc = active_doc_path()
        expected = os.path.splitext(doc)[0] + PROJECT_EXT if doc else "(save the drawing first)"
        vs.AlrtDialog(
            "No project database found for this drawing.\n\n"
            "In the app, use the project menu > Save a Copy As to save your "
            "project next to this drawing with a matching name:\n\n"
            + expected
            + "\n\nThen re-run. (If the drawing is untitled, save the .vwx first.)"
        )
        return

    try:
        conn = sqlite3.connect(db_path)
    except Exception as e:
        vs.AlrtDialog("Could not open database at:\n" + db_path + "\n\n" + str(e))
        return

    handles = []
    criteria = "(R IN ['{0}'])".format(RECORD_NAME)
    vs.ForEachObject(lambda h: handles.append(h), criteria)

    if not handles:
        vs.AlrtDialog(
            "No linked objects found. Run link_selected.py on your devices first."
        )
        conn.close()
        return

    synced = 0
    ports_written = 0
    orphaned = 0
    skipped_blank = 0
    skipped_invalid = 0

    try:
        cur = conn.cursor()
        net_signals = load_network_signals(conn)
        for h in handles:
            id_str = vs.GetRField(h, RECORD_NAME, FIELD_ID)
            if id_str is None or id_str.strip() == "":
                skipped_blank += 1
                continue

            try:
                device_id = int(id_str.strip())
            except ValueError:
                # vwdm_id should only ever be auto-filled by link_selected.py.
                skipped_invalid += 1
                continue

            # Pull drawing-owned type/location into the app before writing out.
            device_type_in, location_in = read_type_and_location(h)
            cur.execute(
                "UPDATE devices SET device_type = ?, location = ? WHERE id = ?",
                (device_type_in, location_in, device_id),
            )

            cur.execute(
                "SELECT device_type, mac_address, location, notes, management_ip, oob_ip "
                "FROM devices WHERE id = ?",
                (device_id,),
            )
            row = cur.fetchone()
            if row is None:
                orphaned += 1
                # This object's vwdm_id points to a device that no longer exists
                # in the app (e.g. it was deleted/renumbered). Don't leave stale
                # port data lingering — overwrite the summary so the drawing makes
                # it obvious the object needs re-linking.
                set_field_safe(
                    h, RECORD_NAME, FIELD_PORTS, "NOT LINKED IN APP — run Link Selected"
                )
                continue
            device_type, mac_address, location, notes, mgmt_ip, oob_ip = row

            # Device-level record. IP/subnet are per-port now, so clear them.
            vs.SetRField(h, RECORD_NAME, FIELD_IP, "")
            vs.SetRField(h, RECORD_NAME, FIELD_SUBNET, "")
            vs.SetRField(h, RECORD_NAME, FIELD_TYPE, device_type or "")
            vs.SetRField(h, RECORD_NAME, FIELD_MAC, mac_address or "")
            vs.SetRField(h, RECORD_NAME, FIELD_LOCATION, location or "")
            vs.SetRField(h, RECORD_NAME, FIELD_NOTES, notes or "")
            # Switch mgmt/OOB IPs — optional fields, best-effort (see constants).
            set_field_safe(h, RECORD_NAME, FIELD_MGMT_IP, mgmt_ip or "")
            set_field_safe(h, RECORD_NAME, FIELD_OOB_IP, oob_ip or "")
            # Device-level summary of every port — this is what the OIP / a Data
            # Tag on the device can actually show. Optional field, best-effort.
            set_field_safe(h, RECORD_NAME, FIELD_PORTS, build_ports_summary(cur, device_id))
            synced += 1

            # Per-jack records (still written for worksheets/Data Tags that can
            # reach socket sub-objects; harmless if only the summary is used).
            ports_written += write_port_records(cur, device_id, h, net_signals)

        conn.commit()  # persist the type/location pulled in from the drawing
    finally:
        conn.close()

    msg = "Synced {0} device(s), {1} port(s).".format(synced, ports_written)
    if orphaned:
        msg += "\n{0} linked object(s) point to a device no longer in the app.".format(
            orphaned
        )
    if skipped_blank:
        msg += "\n{0} object(s) had the record but no id (skipped).".format(skipped_blank)
    if skipped_invalid:
        msg += (
            "\n{0} object(s) had a non-numeric vwdm_id (skipped) — clear that "
            "field and use link_selected.py instead of typing into it by hand."
        ).format(skipped_invalid)
    vs.AlrtDialog(msg)


main()
