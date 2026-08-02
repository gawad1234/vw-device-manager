"""
VW Device Manager — Link selected objects

Run this from Vectorworks' Script Palette (Window > Palettes > Script)
with one or more devices selected in the drawing.

For each selected device this:
  - Creates (or reuses) its app row, capturing the drawing-owned fields —
    device type (from "Model") and location (Room/Rack/Rack U/Slot, combined)
    — read off the Object Info the same one-directional way the name is read.
  - Discovers the device's network jacks (ConnectCAD sockets whose signal is a
    network signal, e.g. "LAN") and creates/refreshes one app *port* per jack,
    matched by the jack's name. You then assign each port's IP + untagged /
    tagged VLANs in the app.

What it does per object, based on its current vwdm_id field:
  - Blank / record not attached  -> attach record, create a new device row
    (named after the ConnectCAD "Name" field), capture type + location, stamp
    the new id onto vwdm_id, discover ports.
  - Non-numeric value -> treated as unlinked (replaces the bad value).
  - Numeric but the id no longer exists in the app -> re-linked as new.
  - Numeric and still exists -> kept; type/location refreshed, ports re-synced.

Before running:
  1. In Vectorworks: Resource Manager > New Resource > Record Format >
     Create. Name it exactly "VWDM Sync" and add these Text fields:
     vwdm_id, vwdm_ip, vwdm_subnet, vwdm_type, vwdm_mac, vwdm_location,
     vwdm_notes. (Per-port IP/VLANs use a separate "VWDM Port" record written
     by sync_app_to_drawing.py — see that script.)
  2. Close the VW Device Manager app (it holds the DB in memory and overwrites
     the file on every change — running this while the app is open can clobber
     whichever side wrote last).
  3. DB_PATH_CANDIDATES below auto-detects the Mac and Windows paths; add a
     line there only if you run this on a third machine.
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
RECORD_NAME = "VWDM Sync"
FIELD_ID = "vwdm_id"

# Object Info fields read FROM the drawing INTO the app (drawing owns these).
# Internal field names confirmed via diagnose_fields.py on a real ConnectCAD
# device — they differ from the Object Info labels (e.g. "Room" -> loc_room).
PIO_FIELD_MODEL = "model"  # Manufacturer "Model" -> device_type
PIO_FIELD_ROOM = "loc_room"  # Location section ...
PIO_FIELD_RACK = "loc_rack"
PIO_FIELD_RACKU = "loc_rackU"
PIO_FIELD_SLOT = "loc_slot"
LOCATION_SEP = " · "  # joins the location parts

# ConnectCAD sockets are contained objects with this parametric record; a jack
# is a network port when its "signal" is one the app flags as a network signal.
# RJ45, SFP, SFP+, QSFP etc. all carry the SAME network signal in ConnectCAD
# (the physical form factor is just label text), so we match on signal, not
# connector. The list is MANAGED IN THE APP (Settings tab) and read from the DB
# at run time — DEFAULT_NETWORK_SIGNALS is only the fallback if that table is
# empty/unreadable. Confirmed via diagnose_sockets.py.
SOCKET_RECORD = "Socket"
SOCKET_FIELD_NAME = "name"
SOCKET_FIELD_SIGNAL = "signal"
DEFAULT_NETWORK_SIGNALS = {"LAN"}


def resolve_db_path():
    for path in DB_PATH_CANDIDATES:
        if os.path.exists(path):
            return path
    return None


def read_type_and_location(h):
    # Device type and location are modeled in ConnectCAD's Object Info, not
    # in the app — so we read them off the object's PIO parameter record the
    # same way get_device_name reads "Name". The Location section has four
    # fields (Room/Rack/Rack U/Slot); we join the non-empty ones into the
    # app's single location column.
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


def get_device_name(h):
    # ConnectCAD devices/sockets carry their own "Name" field (e.g. 'SERV101')
    # inside their PIO parameter record — that's what's actually displayed
    # and renumbered in ConnectCAD, and it's separate from the generic
    # Vectorworks object name (vs.GetName), which ConnectCAD leaves blank.
    rec = vs.GetParametricRecord(h)
    if rec:
        pio_name = vs.GetName(rec)
        if pio_name:
            val = vs.GetRField(h, pio_name, "Name")
            if val is not None and val.strip() != "":
                return val.strip()

    name = vs.GetName(h)
    if name:
        return name
    return "Unnamed device"


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


def upsert_ports(cur, device_id, h, net_signals):
    """Create/refresh one port per network jack, matched by jack name."""
    created = 0
    refreshed = 0
    for jack_name, _child in network_jacks(h, net_signals):
        if not jack_name:
            continue
        cur.execute(
            "SELECT id FROM ports WHERE device_id = ? AND vw_socket_key = ?",
            (device_id, jack_name),
        )
        row = cur.fetchone()
        if row:
            cur.execute(
                "UPDATE ports SET label = ?, updated_at = datetime('now') WHERE id = ?",
                (jack_name, row[0]),
            )
            refreshed += 1
        else:
            cur.execute(
                "INSERT INTO ports (device_id, label, vw_socket_key) VALUES (?, ?, ?)",
                (device_id, jack_name, jack_name),
            )
            created += 1
    return created, refreshed


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
    vs.ForEachObject(lambda h: handles.append(h), "(SEL=TRUE)")

    if not handles:
        vs.AlrtDialog("Nothing selected. Select one or more devices and run again.")
        conn.close()
        return

    linked = 0
    relinked_invalid = 0
    relinked_orphaned = 0
    already_linked = 0
    ports_created = 0
    ports_refreshed = 0
    errors = []

    try:
        cur = conn.cursor()
        net_signals = load_network_signals(conn)
        for h in handles:
            existing_id = vs.GetRField(h, RECORD_NAME, FIELD_ID)

            status = "unlinked"
            numeric_id = None
            if existing_id is not None and existing_id.strip() != "":
                try:
                    numeric_id = int(existing_id.strip())
                except ValueError:
                    status = "invalid"
                else:
                    cur.execute("SELECT 1 FROM devices WHERE id = ?", (numeric_id,))
                    status = "already_linked" if cur.fetchone() else "orphaned"

            device_type, location = read_type_and_location(h)

            if status == "already_linked":
                # Keep the row; refresh the drawing-owned fields.
                device_id = numeric_id
                cur.execute(
                    "UPDATE devices SET device_type = ?, location = ? WHERE id = ?",
                    (device_type, location, device_id),
                )
                already_linked += 1
            else:
                name = get_device_name(h)
                cur.execute(
                    "INSERT INTO devices (name, device_type, location) VALUES (?, ?, ?)",
                    (name, device_type, location),
                )
                device_id = cur.lastrowid
                if existing_id is None:
                    # record not attached yet
                    vs.SetRecord(h, RECORD_NAME)
                vs.SetRField(h, RECORD_NAME, FIELD_ID, str(device_id))
                if status == "unlinked":
                    linked += 1
                elif status == "invalid":
                    relinked_invalid += 1
                elif status == "orphaned":
                    relinked_orphaned += 1

            # Discover network jacks -> ports for every linked device.
            created, refreshed = upsert_ports(cur, device_id, h, net_signals)
            ports_created += created
            ports_refreshed += refreshed

        conn.commit()
    except Exception as e:
        conn.rollback()
        errors.append(str(e))
    finally:
        conn.close()

    msg = "Linked {0} new device(s).\n{1} already linked.".format(linked, already_linked)
    if relinked_invalid:
        msg += "\n{0} object(s) had an invalid vwdm_id and were re-linked.".format(
            relinked_invalid
        )
    if relinked_orphaned:
        msg += (
            "\n{0} object(s) pointed to a deleted app device and were "
            "re-linked as new."
        ).format(relinked_orphaned)
    msg += "\n\nPorts: {0} created, {1} refreshed from network jacks.".format(
        ports_created, ports_refreshed
    )
    if errors:
        msg += "\n\nErrors:\n" + "\n".join(errors)
    vs.AlrtDialog(msg)


main()
