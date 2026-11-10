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
  2. The app can stay OPEN — the database engine (real SQLite) coordinates
     concurrent access, so this script and the app no longer clobber each other,
     and the app auto-refreshes to show what this script wrote.
  3. Save the drawing, and save its project database next to it with a matching
     name (Foo.vwx -> Foo.vwdm) via the app's project menu > Save a Copy As.
     The script finds the database from the drawing's own path automatically —
     no hardcoded paths, works the same on Mac and Windows.
"""

import json
import os
import sqlite3
import vs

# Each project is a SQLite database that lives BESIDE its drawing with a
# matching name (Foo.vwx -> Foo.vwdm). resolve_project_db() derives that path
# from the active document, so the same script finds the right database on any
# machine with NO hardcoded paths.
PROJECT_EXT = ".vwdm"
# Fallback for projects last saved by an older app (see load_network_signals).
LIBRARY_CANDIDATES = [
    os.path.expanduser(r"~\Dropbox\Claude\Database Vectorworks\vw-device-manager\data\library.json"),
    os.path.expanduser("~/Library/CloudStorage/Dropbox/Claude/Database Vectorworks/vw-device-manager/data/library.json"),
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


# The record formats this script writes. Created on first run if the drawing
# doesn't have them yet, so there's no manual Resource Manager setup.
RECORD_FORMATS = {
    "VWDM Sync": ["vwdm_id", "vwdm_ip", "vwdm_subnet", "vwdm_type", "vwdm_mac",
                  "vwdm_location", "vwdm_notes", "vwdm_mgmt_ip", "vwdm_oob_ip", "vwdm_ports"],
    "VWDM Port": ["vwdm_ip", "vwdm_untagged", "vwdm_tagged"],
}


def ensure_record_formats():
    """Create any missing VWDM record format (all Text fields). An existing
    format is left exactly as it is."""
    for rec, fields in RECORD_FORMATS.items():
        if not vs.GetObject(rec):
            for f in fields:
                vs.NewField(rec, f, "", 4, 0)  # 4 = Text


def has_record(h, rec):
    """True if record format `rec` is attached to object h. (GetRField can't
    tell: it returns '' for an unattached record in Vectorworks 2027.)"""
    for i in range(1, vs.NumRecords(h) + 1):
        if vs.GetName(vs.GetRecord(h, i)) == rec:
            return True
    return False


def active_doc_path():
    """Full path of the active drawing, or '' if it's unsaved/unavailable."""
    try:
        p = vs.GetFPathName()
    except Exception:
        p = None
    return posix_path((p or "").strip())


def posix_path(p):
    """Vectorworks on Mac can report an old colon path ("Macintosh HD:Users:me:Foo.vwx")."""
    if os.name == "nt" or not p or p.startswith("/") or ":" not in p:
        return p
    parts = p.split(":")
    home_style = "/" + "/".join(parts[1:])
    return home_style if os.path.exists(os.path.dirname(home_style)) else "/Volumes/" + "/".join(parts)


def resolve_project_db():
    """The project database for the current drawing: same folder + same base
    name + .vwdm. None if there isn't one: never guess, or another show's data
    lands on this drawing."""
    doc = active_doc_path()
    if doc:
        candidate = os.path.splitext(doc)[0] + PROJECT_EXT
        if os.path.exists(candidate):
            return candidate
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
    """Signal names (uppercased) the app flags as network ports. The app copies its
    list into the project, so this works wherever its library lives; older projects
    fall back to the library file, then DEFAULT_NETWORK_SIGNALS."""
    try:
        row = conn.execute(
            "SELECT value FROM project_meta WHERE key = 'networkSignals'"
        ).fetchone()
        if row and row[0]:
            sigs = {s.strip().upper() for s in json.loads(row[0]) if s and s.strip()}
            if sigs:
                return sigs
    except Exception:
        pass
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
        if not row:
            # A port added by hand in the app with this name: take it over rather
            # than leave its IP on a duplicate.
            cur.execute(
                "SELECT id FROM ports WHERE device_id = ? AND label = ? AND vw_socket_key IS NULL",
                (device_id, jack_name),
            )
            row = cur.fetchone()
        if row:
            cur.execute(
                "UPDATE ports SET label = ?, vw_socket_key = ?, updated_at = datetime('now') WHERE id = ?",
                (jack_name, jack_name, row[0]),
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

    ensure_record_formats()

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
    reused_by_name = 0
    ports_created = 0
    ports_refreshed = 0
    copies = 0
    skipped = 0
    errors = []
    stamps = []  # written after commit: a rollback would otherwise leave ids in the drawing

    # A copied device keeps its id, so count who else holds each one.
    id_counts = {}

    def count_id(h):
        v = (vs.GetRField(h, RECORD_NAME, FIELD_ID) or "").strip()
        if v:
            id_counts[v] = id_counts.get(v, 0) + 1

    vs.ForEachObject(count_id, "(R IN ['{0}'])".format(RECORD_NAME))

    try:
        cur = conn.cursor()
        net_signals = load_network_signals(conn)
        for h in handles:
            if not vs.GetParametricRecord(h):
                skipped += 1  # text, a line, a cable: not a device
                continue
            existing_id = vs.GetRField(h, RECORD_NAME, FIELD_ID)

            status = "unlinked"
            numeric_id = None
            if existing_id is not None and existing_id.strip() != "":
                try:
                    numeric_id = int(existing_id.strip())
                except ValueError:
                    status = "invalid"
                else:
                    cur.execute("SELECT name FROM devices WHERE id = ?", (numeric_id,))
                    row = cur.fetchone()
                    status = "already_linked" if row else "orphaned"
                    if (
                        row
                        and id_counts.get(existing_id.strip(), 0) > 1
                        and row[0] != get_device_name(h)
                    ):
                        status = "unlinked"  # a copy: it needs its own row
                        copies += 1

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
                # Dedupe by name FIRST. A device name is a unique identifier in
                # ConnectCAD, so if a row with this name already exists in the
                # project, reuse it instead of inserting a duplicate. This makes
                # re-running Link Selected idempotent and stops duplicates when an
                # object's vwdm_id is blank/stale/from another project.
                cur.execute("SELECT id FROM devices WHERE name = ? ORDER BY id LIMIT 1", (name,))
                match = cur.fetchone()
                if match:
                    device_id = match[0]
                    cur.execute(
                        "UPDATE devices SET device_type = ?, location = ? WHERE id = ?",
                        (device_type, location, device_id),
                    )
                    reused_by_name += 1
                else:
                    cur.execute(
                        "INSERT INTO devices (name, device_type, location) VALUES (?, ?, ?)",
                        (name, device_type, location),
                    )
                    device_id = cur.lastrowid
                    if status == "unlinked":
                        linked += 1
                    elif status == "invalid":
                        relinked_invalid += 1
                    elif status == "orphaned":
                        relinked_orphaned += 1

                stamps.append((h, device_id))

            # Discover network jacks -> ports for every linked device.
            created, refreshed = upsert_ports(cur, device_id, h, net_signals)
            ports_created += created
            ports_refreshed += refreshed

        conn.commit()
        for h, device_id in stamps:
            if not has_record(h, RECORD_NAME):
                vs.SetRecord(h, RECORD_NAME)
            # (Re)stamp the object with the resolved id — repairs blank/stale ids.
            vs.SetRField(h, RECORD_NAME, FIELD_ID, str(device_id))
    except Exception as e:
        conn.rollback()
        errors.append(str(e))
    finally:
        conn.close()

    msg = "Linked {0} new device(s).\n{1} already linked.".format(linked, already_linked)
    msg += "\nDatabase: " + os.path.basename(db_path)
    if copies:
        msg += "\n{0} copied object(s) got their own device.".format(copies)
    if skipped:
        msg += "\n{0} selected object(s) weren't devices (skipped).".format(skipped)
    if reused_by_name:
        msg += "\n{0} object(s) matched an existing device by name (no duplicate created).".format(
            reused_by_name
        )
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
