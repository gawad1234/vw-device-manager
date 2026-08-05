# Vectorworks sync scripts

Runs *inside* Vectorworks (Script Palette), using its built-in Python
interpreter, to link ConnectCAD devices to rows in the app's SQLite
database and push data onto the drawing. Device-level info (type/MAC/
location/notes) goes onto the device; per-port network info (IP + untagged/
tagged VLANs) goes onto each network jack.

This does **not** parse the `.vwx` file directly — it uses Vectorworks'
own scripting API against the live document, and opens the app's SQLite
file directly with Python's `sqlite3` module (confirmed available in
VW2026's embedded Python, v3.34.0).

The `diagnose_*.py` scripts are read-only helpers used to confirm ConnectCAD
field/socket names on a real device (not part of the normal workflow).

## One-time setup

1. In Vectorworks: **Resource Manager > New Resource > Record Format >
   Create**. Name it exactly `VWDM Sync` and add these fields, all type
   Text: `vwdm_id`, `vwdm_ip`, `vwdm_subnet`, `vwdm_type`, `vwdm_mac`,
   `vwdm_location`, `vwdm_notes`. (This is the **device-level** record.
   `vwdm_ip`/`vwdm_subnet` are now left blank — IP/subnet moved to ports.)
2. Create a second Record Format named exactly `VWDM Port` with three Text
   fields — `vwdm_ip`, `vwdm_untagged`, `vwdm_tagged`. This is the
   **per-jack** record `sync_app_to_drawing.py` writes onto each network
   socket. (A device flagged as a **switch** in the app has VLAN-only ports —
   `vwdm_ip` is left blank for those jacks; only `vwdm_untagged`/`vwdm_tagged`
   are written.)
2b. *Optional — switches only.* If you want a switch's device-level
   **management** and **out-of-band** IPs on the drawing, add two more Text
   fields to the `VWDM Sync` record: `vwdm_mgmt_ip` and `vwdm_oob_ip`. The sync
   writes them best-effort, so it's fine to skip this if you don't need them.
3. Optional: add linked text referencing these fields if you want them
   visible on the schematic graphic itself, not just in the Object Info
   palette / worksheets.
4. `DB_PATH_CANDIDATES` at the top of `link_selected.py` and
   `sync_app_to_drawing.py` auto-detects the Mac and Windows paths to
   `vw-device-manager/data/vw-device-manager.sqlite3` — add a line only if
   you run on a third machine.

## Running a script

**Recommended — use the loaders (paste once, never re-paste):** the Script
Palette stores a *copy* of whatever you paste, so editing a `.py` file on disk
doesn't update a pasted script. Instead, paste the tiny loaders in `loaders/`
once each:
- `loaders/link_loader.py`  → name it e.g. "1. Link Selected"
- `loaders/sync_loader.py`  → name it e.g. "2. Sync to Drawing"

Each loader reads and runs the current `link_selected.py` /
`sync_app_to_drawing.py` straight from this Dropbox folder, so future edits take
effect with **no re-pasting**. Only update a loader if the project folder moves
(edit its `TARGET_CANDIDATES` paths). The diagnostics (`diagnose_*.py`) rarely
change — paste them directly if/when you need them.

**Direct (no loader):** Window > Palettes > Script > new Python script > paste
a file's contents > run. Simple, but you must re-paste after every edit.

A fully hands-off alternative (real menu commands that auto-update across
machines) is to package these as Vectorworks plug-ins in a Dropbox *workgroup
folder* — more setup; not done yet.

## Workflow

1. **Close the VW Device Manager app.** It keeps the database in memory
   and overwrites the whole file on every change — running the app and a
   sync script at the same time risks one side clobbering the other's
   writes. (A "reload from disk" safeguard in the app is a good future
   improvement; for now, treat app-open and script-run as mutually
   exclusive.)
2. Select the ConnectCAD devices you want tracked, run `link_selected.py`.
   For each device this creates/reuses its app row (named after the
   device's ConnectCAD "Name" field, e.g. `SERV101`), captures the
   drawing-owned type + location, stamps `vwdm_id`, and **discovers its
   network jacks** — every ConnectCAD socket whose signal is a network
   signal (see `NETWORK_SIGNALS`, default `LAN`) becomes an app **port**,
   matched by the jack's name. Re-running is safe/idempotent: it repairs
   invalid/stale `vwdm_id`s and refreshes ports.
3. Reopen the app. Set the device MAC, and for each port set its IP,
   untagged (native) network, and any tagged (trunked) VLANs.
4. Close the app again, run `sync_app_to_drawing.py`. It writes device-level
   fields onto each `VWDM Sync` record, and each port's IP + untagged/tagged
   VLANs onto its jack via the `VWDM Port` record.

## Current limitations (by design)

- **Drawing-owned fields** are read *from* Vectorworks each run and are
  read-only in the app: device **name** (once, at link time), **type**
  (from `model`), **location** (from `loc_room/loc_rack/loc_rackU/loc_slot`),
  and the set of **ports** (from network jacks). Everything else (per-port
  IP/VLANs, MAC, notes) is app-owned and written onto the drawing.
- **Network jacks** are matched by their ConnectCAD socket *name*. Renaming
  a jack in ConnectCAD then re-linking creates a new port and leaves the old
  one orphaned (delete it in the app). Jacks removed in VW leave an orphan
  port too — link never auto-deletes ports.
- A jack whose signal isn't in the network-signal list is ignored. That list
  is managed in the **app → Settings tab** (the scripts read it from the DB at
  run time); no need to edit the scripts. `DEFAULT_NETWORK_SIGNALS` in each
  script is only the fallback if that list is empty/unreadable.
- Deleting a device in the app (or wiping/re-adding, which renumbers ids) leaves
  the drawing object pointing at a now-missing id. `sync_app_to_drawing.py`
  reports it as "orphaned", skips its data, and overwrites its `vwdm_ports`
  summary with `NOT LINKED IN APP — run Link Selected` so stale values don't
  linger. Re-run **Link Selected** on the object to re-link it.
- No automatic conflict resolution — this is a manual, run-it-yourself
  two-step, not a live/background sync.

## Seeing per-port IPs in Vectorworks

The per-jack `VWDM Port` records live on **socket sub-objects** inside the
device. You generally can't select an individual socket, so the Object Info
palette (which shows the *selected* object's records) won't show them — and the
device-level `vwdm_ip` is intentionally blank now (IP moved to ports).

**The fix: the device-level `vwdm_ports` summary.** Add a multi-line **Text**
field named `vwdm_ports` to the `VWDM Sync` record (one-time). On each sync,
every device's record gets a readable summary of all its jacks, e.g.:

```
LAN: 10.46.90.101 [KVM Net]
1GB A: 10.46.20.102 [Mgmt] +Prod, Guest
```

Because this is on the **device** (which you *can* select), it shows in the
**Object Info palette**, and a **Data Tag** placed on the device can display it
right on the drawing. Format per line: `jack: IP [untagged VLAN] +tagged VLANs`.

Setting up a Data Tag: create a Data Tag definition whose tag field is a
**Record field → `VWDM Sync` → `vwdm_ports`**, then place it on a device.

The per-socket `VWDM Port` records (`vwdm_ip`/`vwdm_untagged`/`vwdm_tagged`) are
still written too — use them if you build a **worksheet** that reports on the
socket sub-objects, or a Data Tag that can associate with an individual socket.

## Known issues

- **The OIP can still show a just-written field as stale** until you
  deselect/reselect the device (reopening the document always refreshes). This
  is a Vectorworks display-refresh quirk, not data loss — the value is really on
  the record (verify by reading it back, e.g. `diagnose_port_write.py`).
