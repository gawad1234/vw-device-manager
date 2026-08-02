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
  - Close the VW Device Manager app first (see link_selected.py for why).
  - One-time: create a Record Format named exactly "VWDM Port" with three Text
    fields — vwdm_ip, vwdm_untagged, vwdm_tagged. (This is the per-jack
    counterpart to the device-level "VWDM Sync" record.)
  - Optional (only if you track switches and want their IPs on the drawing):
    add two Text fields to the "VWDM Sync" record — vwdm_mgmt_ip, vwdm_oob_ip.
    Writing to them is best-effort, so leaving them off does no harm.
  - DB_PATH_CANDIDATES below auto-detects the Mac and Windows paths.
"""

import os
import sqlite3
import vs

# The database lives in the same Dropbox folder on every machine, but the
# absolute path to that folder differs per OS/user. Rather than hand-edit
# this on each machine, list every known path and use the first that exists.
# Add a new line here if you set the project up on another machine.
DB_PATH_CANDIDATES = [
    r"C:\Users\Gabe\Dropbox\Claude\Database Vectorworks\vw-device-manager\data\vw-device-manager.sqlite3",
    "/Users/gabe/Library/CloudStorage/Dropbox/Claude/Database Vectorworks/vw-device-manager/data/vw-device-manager.sqlite3",
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


def resolve_db_path():
    for path in DB_PATH_CANDIDATES:
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
    """Signal names (uppercased) the app flags as network ports."""
    try:
        cur = conn.cursor()
        cur.execute("SELECT signal FROM network_signals")
        sigs = {r[0].strip().upper() for r in cur.fetchall() if r[0] and r[0].strip()}
        return sigs or set(DEFAULT_NETWORK_SIGNALS)
    except Exception:
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
    db_path = resolve_db_path()
    if db_path is None:
        vs.AlrtDialog(
            "Could not find the database on this machine. Tried:\n\n"
            + "\n".join(DB_PATH_CANDIDATES)
            + "\n\nIf the project lives somewhere else here, add that path to "
            "DB_PATH_CANDIDATES near the top of this script."
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
            synced += 1

            # Per-jack records.
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
