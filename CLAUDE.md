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
  - `library.ts` — the **universal library**, shared across ALL projects: a
    single `data/library.json` (Dropbox-synced, **gitignored** — `/data` — and
    excluded from builds), NOT stored per project. Holds network signals, cable
    types, device categories, auto-add kits, company branding, the switch-config
    template + admin login, the **software library** and the **crew directory**
    (names, phones, emails, rates — personal data: must never be committed or
    served). `ensureLibrary()` seeds it once from the legacy DB. Cables reference
    their type by **name** (`cables.cable_type`), so nothing is tied to a
    per-project id.
  - `exports.ts` — every PDF/Excel/CSV document (`exportDocument`, HTML → PDF via
    an offscreen BrowserWindow `printToPDF`): pull sheets, schedules, labels, IP
    schedule, device list, orders, **projector setup sheet** (one worksheet/page
    per projector) and **truck load sheets** (one page per trip).
  - `server.ts` — the LAN **Show Server** (plain `node:http`); reuses repo/exports.
    Also the **host side of sharing a show** with other Device Manager computers:
    `/rpc/login` (manager PIN required — a PIN-less show can't be joined — plus
    matching app version → bearer token), `/rpc/call` (runs a handler from
    `rpc-registry.ts`, only channels `shared/remote-scope.ts` marks `read`),
    `/rpc/changes` (a change counter joined computers poll).
  - `remote.ts` — the **joining side**: `join/leave/info/call`; polls `/rpc/changes`
    (1.5 s focused, 4.5 s in the background) and sends `data-changed`.
  - `ipc.ts` registers every handler through `handle(channel, fn)`: while joined,
    `read` channels go to the host, writes and `host-only` channels (exports,
    printing, kits) are refused — **view-only (step 1)**; host writes bump the
    change counter. Unknown channels default to `write`, so new handlers are safe.
  - `stickers.ts` — **loom labels**: places cable stickers (2 per cable by default,
    {This end}/{Other end} swapped) on a sticker sheet's exact label boxes, start
    offset + printer nudge, printToPDF at the sheet's page size; test page; marks
    cables labeled. Element rendering is shared with case labels via
    `caselabels.ts` → `elementsHtml(elements, resolve, …)` + `AUTOFIT_SCRIPT`.
  - `switch-config.ts` — NETGEAR M4350 config generator; `software-kit.ts` — the
    install-kit `Install.ps1`/`Install.bat` generator (pure, tested);
    `vlan-script.ts` — Hyper-V VLAN script for the Configs tab.
  - `lightwright-sync.ts` — **live Vectorworks Spotlight sync for lighting**: stands in for
    Lightwright on the `<drawing>.xml` exchange file (default `<show>.xml` beside the `.vwdm`,
    or a chosen path). Polls mtime every 1.5 s; ingests files Vectorworks wrote (UID-first
    matching, `Lightwright_ID` = our fixture row id, `Entire Plot` deletes rows missing from the
    drawing); on fixture saves writes the whole rig back with every AppStamp `Lightwright`,
    reading first and never writing while our last file is unconsumed. Host only (off while
    joined). Protocol: `_Master/knowledge/vectorworks-lightwright-exchange.md`.
  - `repository.ts` — CRUD + validation for devices/subnets (IP conflict
    checks, IP-outside-subnet checks, etc. — see `DeviceWarning` types).
  - `ipc.ts` — wires repository methods to IPC handlers.
  - `ip-utils.ts` — CIDR/IP helper functions.
  - `index.ts` — Electron app bootstrap/window creation.
- **Preload** (`src/preload/`): exposes the typed `VwDeviceManagerApi`
  (`src/shared/types.ts`) to the renderer via `contextBridge`.
- **Renderer** (`src/renderer/src/`): React UI — `App.tsx` shell with the
  sidebar (Devices › Projectors/Wallpapers/Software, Networking, Schedule ›
  Crew/Trucking, Cables, Lighting › Fixtures/Universes/Fixture types, Patching, Orders, Packing, Settings) and one file per
  page in `pages/`. Shared two-pane page: `components/DeviceSetupPage.tsx`.
- **Shared** (`src/shared/`): `types.ts` (all data types + the
  `VwDeviceManagerApi` contract shared between main/preload/renderer), and pure
  logic used by both sides: `projector-settings.ts` (Panasonic command catalog),
  `software.ts` (silent-switch presets), `crew-cost.ts` (hours/OT/cost),
  `lw-exchange.ts` (parse/build the Lightwright exchange file, absolute ↔ universe/address),
  `lighting-checks.ts` (patch warnings), `sticker-sheet.ts` (label-template .docx parser — positioned shapes or Avery
  table — plus `tidyLabels`/`stickerSlots`, `BUNDLE_COLOR`).
- **Sticker template import runs in the renderer** (`lib/stickerImport.ts`): .docx via
  `jszip`, .pdf via `pdfjs-dist` (bounding boxes of drawn paths on page 1, CTM
  tracked; loaded on demand, worker run in-thread so it works under the CSP).
  `LabelModal` doubles as the sticker designer via its `sticker` prop (any size).
  Renderer-only libraries (`pdfjs-dist`, `jszip`) are **devDependencies**: Vite bundles them,
  and anything in `dependencies` is also copied into the installer by electron-builder.
- **Tests:** `npm test` → `node --test` over `test/*.test.mts`; they import the
  pure `.ts` modules directly (so those must not import Electron or use
  extensionless relative imports).

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

- **Per-device JSON columns** (guarded additive migrations in `db.ts`):
  `wallpaper_json`, `projector_json` (`{model, values}` — choice values are the
  raw command; see ROADMAP/PROGRESS review notes), `software_json` (ids into the
  software library; null = not set up).
- **Schedule tables** (per show): `crew_assignments`, `trucks`, `truck_trips` —
  each `{id, data_json}` via the generic `listJsonRows/saveJsonRow` helpers in
  repository.ts; schedule window + phases in project meta key `schedule`. Crew
  rows hold only the directory id + show rates + days (no contact details).

- **Lighting** (per show): `fixtures` table (`{id, data_json}`, `Fixture` in types.ts — the row id
  is the `Lightwright_ID` Vectorworks stores; `vw` keeps the raw drawing fields we echo back;
  `notes`/`mode` are app-only). Project meta `lighting` = `{exchangePath, syncOn, universes:
  {[n]: {deviceId, label}}}`; `lightingVw` = the last Vectorworks field list/header/universe table.
  `library.json` → `fixtureTypes` (`{name, modes: [{name, footprint}]}`, shared).

## Vectorworks sync (`vectorworks-scripts/`)

One-directional: this app's DB is the source of truth for `vwdm_*` fields;
device *name* is the one field read the other direction (from Vectorworks,
once, at link time via `link_selected.py`). Full workflow and current
limitations are documented in `vectorworks-scripts/README.md` — read it
before changing anything that touches the sync contract (field names,
`VWDM Sync` record format, `vwdm_id` semantics).

## Releasing (and keeping the docs current)

**Every push of a new version to GitHub must ship with up-to-date docs** (user
request, 2026-10-22). Before the version-bump commit / `gh release create`:
1. `README.md` — the feature list matches the sidebar.
2. `docs/USER-GUIDE.md` (+ contents links) and `docs/QUICK-START.md` — every new
   or changed feature, and anything outdated removed.
3. `docs/PRIVACY.md` — any new kind of data stored or sent (bump its date).
4. The **GitHub wiki** (`git@github.com:gawad1234/vw-device-manager.wiki.git`,
   clone it outside Dropbox): Home table, Features, `_Sidebar.md`, feature pages.
5. This file's architecture/data-model notes, `../ROADMAP.md`, `../PROGRESS.md`.
6. Release notes on the GitHub release itself.

A PreToolUse hook (`../.claude/settings.json`) prints this reminder whenever a
`git push` or `gh release create` command runs.

**Build + publish** (outside Dropbox, unsigned): `CSC_IDENTITY_AUTO_DISCOVERY=false`,
`npm run build`, `electron-builder --mac --arm64` and `--win --x64` with
`-c.directories.output=/tmp/vwdm-out|/tmp/vwdm-win` (Windows NSIS needs Rosetta on
Apple Silicon), verify `codesign --verify --deep --strict`, then `gh release create`
with all 8 assets. Use a **normal** release, not a pre-release — `updater.ts` has
no `allowPrerelease`, so pre-releases never reach installed apps. Don't
`git commit -am` here (untracked-by-you edits in `host-tools/` may be sitting in
the working tree).

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
