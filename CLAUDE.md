# vw-device-manager

Electron + React + TypeScript desktop app for tracking network devices
(IP/subnet/MAC/type/location/notes), meant to be the source-of-truth
database that the sibling `vectorworks-scripts/` sync onto a Vectorworks
ConnectCAD drawing. See `../CLAUDE.md` and `../PROGRESS.md` for the wider
workspace context and the cross-machine handoff log — check those first.

## Architecture

- **Main process** (`src/main/`):
  - `db.ts` — SQLite via **`node:sqlite`** (built into Electron's Node — no
    native module, so it stays cross-platform with no compile step). `openDb(path)`
    opens a project file (row-level writes straight to disk, no whole-file
    persist), applies the schema + all guarded `migrate*` steps, sets
    `busy_timeout`; switching projects just calls `openDb` again. Because it's a
    real SQLite file with OS locking, **the app and a Vectorworks script can hold
    the same file open at once without clobbering**; `getDataVersion()`
    (`PRAGMA data_version`) lets the main process detect external writes and
    auto-refresh the renderer. Repository/migrations go through the engine-agnostic
    `dbExec`/`dbRun`/`dbAll`/`dbGet` helpers. (Dropbox caveat: a live DB in an
    actively-syncing Dropbox folder can be reverted by Dropbox — keep projects in
    a stable location while editing.)
  - `projects.ts` — the multi-project layer: tracks the current `*.vwdm` file,
    a recent list + last-project in `userData/settings.json` (per-machine, not
    Dropbox), and New/Open/Save-a-Copy-As via native dialogs. `paths.ts` is now
    just the legacy default location used on first launch.
  - `library.ts` — the **universal library** (network signals + cable types),
    shared across ALL projects: a single `data/library.json` (Dropbox-synced),
    NOT stored per project. `ensureLibrary()` seeds it once from the legacy DB.
    Cables reference their type by **name** (`cables.cable_type`), so nothing is
    tied to a per-project id.
  - `repository.ts` — CRUD + validation for devices/subnets (IP conflict
    checks, IP-outside-subnet checks, etc. — see `DeviceWarning` types).
  - `ipc.ts` — wires repository methods to IPC handlers.
  - `ip-utils.ts` — CIDR/IP helper functions.
  - `index.ts` — Electron app bootstrap/window creation.
- **Preload** (`src/preload/`): exposes the typed `VwDeviceManagerApi`
  (`src/shared/types.ts`) to the renderer via `contextBridge`.
- **Renderer** (`src/renderer/src/`): React UI — `App.tsx` shell,
  `pages/DevicesPage.tsx` and `pages/SubnetsPage.tsx`.
- **Shared** (`src/shared/types.ts`): `Device`, `Subnet`, `DeviceWarning`,
  and the `VwDeviceManagerApi` contract shared between main/preload/renderer.

## Data model (as of last read — verify against `types.ts` before relying on this)

- `Subnet`: id, name, cidr, vlan, gateway, notes, createdAt. Doubles as a
  VLAN/network (it carries `vlan`).
- `Device`: id, name, deviceType, macAddress, location, notes, timestamps, and
  `ports: Port[]`. **IP + subnet are NOT on the device** — they moved to the
  port. `deviceType`/`location` are drawing-owned (read-only in the app).
  Switch fields: `isSwitch` (bool) + device-level `managementIp` / `oobIp`.
  When `isSwitch`, the app hides the per-port IP (switch ports are VLAN-only)
  and validates mgmt/OOB IPs through the same shared IP-conflict check as ports
  (`findIpUse` in repository.ts). Non-switch devices keep mgmt/OOB null.
- `Port`: id, deviceId, label (jack name), ipAddress, untaggedSubnetId (the
  native/untagged network), taggedSubnetIds (trunked VLANs, stored in the
  `port_tagged_vlans` join table), vwSocketKey (ties it to a ConnectCAD jack;
  null = added manually in the app). Port saves return warnings for IP
  conflict / IP-outside-untagged-subnet / invalid IP, and can be rejected
  outright for a hard duplicate IP.
- One-time migration in `db.ts` moves each legacy device's single ip/subnet
  into a "Port 1" and drops those columns.
- **Cable bundle manager** (own "Cables" tab): `CableType` (managed catalog,
  in Settings), `Bundle` (name + **color** + from/to location + **length** +
  notes + `cables: Cable[]`), and `Cable` (name, cableTypeId, pulled, labeled,
  notes, plus
  `source`/`destination` `CableEndpoint`s). **Length is bundle-level** — cables
  in a bundle share the run. A `CableEndpoint` links to a device + optional port, or
  falls back to free `text`. Tables `cable_types` / `bundles` / `cables` are
  additive (`CREATE TABLE IF NOT EXISTS`, no migration). Endpoint names are
  resolved in the UI from the loaded devices — the repo returns raw ids.
  Phase 1 = data + entry UI; outputs (pull sheets/labels), conduit-fill %, and
  ConnectCAD auto-recognition are future (see `../ROADMAP.md`).

## Vectorworks sync (`vectorworks-scripts/`)

One-directional: this app's DB is the source of truth for `vwdm_*` fields;
device *name* is the one field read the other direction (from Vectorworks,
once, at link time via `link_selected.py`). Full workflow and current
limitations are documented in `vectorworks-scripts/README.md` — read it
before changing anything that touches the sync contract (field names,
`VWDM Sync` record format, `vwdm_id` semantics).

## Git

**Public** GitHub repo — `git@github.com:gawad1234/vw-device-manager` (SSH),
default branch `master`. Releases are published here (electron-builder +
`gh release create`) and the app's auto-updater reads that Releases feed, so
**code + installers go through GitHub**. Note the *data* still travels via
Dropbox, not git: the `*.vwdm` project databases and `data/library.json` are
gitignored and Dropbox-synced across machines. `Launch App.bat`,
`Launch App.command`, and `vectorworks-scripts/` are tracked. Before publishing
anything, remember the repo is public — no secrets, no client data (see the
2026-08-12 `PROGRESS.md` entry for the pre-public scrub).
