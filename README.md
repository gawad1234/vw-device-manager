# Device Manager

**A desktop app for running the tech side of an AV / broadcast show — network gear, IPs and VLANs, cables, patching, shop orders, case labels, crew and trucking schedules — synced with your ConnectCAD / Vectorworks drawing.**

Device Manager is the source-of-truth database for a show's network: every device, its ports, IP addresses, VLANs, MAC, location and notes. It pushes that data back onto your ConnectCAD drawing in Vectorworks, and helps with everything around it — purchasing/receiving, pull sheets, IP schedules, patching, printed road-case labels, projector and computer setup, and the crew and trucking schedule.

> **Beta software.** You're helping test it — thank you! Please report anything confusing or broken (see [Feedback](#feedback)).

---

## Download & install

Grab the latest installer from the **[Releases page »](https://github.com/gawad1234/vw-device-manager/releases/latest)**

| Platform | File | Notes |
|---|---|---|
| **macOS** (Apple Silicon — M1/M2/M3/M4) | `…​.dmg` | Intel Macs aren't supported yet. |
| **Windows** (64-bit) | `…​-setup.exe` | One-click installer. |

The app is **not code-signed** yet (that costs money we're skipping during the beta), so your OS will warn you the first time. This is expected:

- **macOS:** open the `.dmg`, drag **Device Manager** to Applications, then **right-click the app → Open** (don't double-click the first time). If it says *"damaged and can't be opened,"* open Terminal and run:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/Device Manager.app"
  ```
  then right-click → Open. You only do this once.
- **Windows:** run the installer; on the blue *"Windows protected your PC"* screen click **More info → Run anyway**.

**Updates are automatic.** When a new version is released, the app notices and offers it under **Settings → Updates** (Windows installs it for you; macOS opens the download page). You can also check manually there.

---

## What it does

Everything lives in **projects** — one `.vwdm` file per show, kept next to its `.vwx` drawing. Use the project menu in the top-left to make a new one, open another, or save a copy. The sidebar:

- **Devices** — every piece of gear, its ports, IPs, VLANs, MAC, type and location (Details / Ports / Connections tabs). Switches get management/OOB IPs, VLAN-only ports, LAGs and a generated NETGEAR config. The app warns about duplicate IPs and IPs outside their subnet. Under it:
  - **Projectors** — Panasonic PT-RZ / PT-RQ setup: pick settings, save a command list for Panasonic's Multi Monitoring & Control, print a one-page-per-projector setup sheet. *(beta)*
  - **Wallpapers** — branded desktop wallpapers per show computer.
  - **Software** — a library of Windows installers with silent switches → a USB install kit per computer with a one-click `Install.bat`. *(beta)*
- **Networking** — **Subnets** (name, CIDR, VLAN, gateway) and **Configs** (a Hyper-V VLAN PowerShell script or JSON for the VLAN Manager host tool).
- **Schedule** *(beta)* — **Crew**: a shared crew directory, a per-show date grid (working/off, call times, phases) with day-rate or hourly + overtime costs. **Trucking**: trucks and trips with addresses, dock slots, on-arrival contacts and the cases on board, plus printable **truck load sheets** for the shop.
- **Cables** — cable bundles and the cables in them (type, color, length, endpoints, pulled/labeled). Export pull sheets, schedules and cable labels.
- **Patching** — import the drawing's circuit report and track patching per end, plus tested.
- **Orders** — shop orders with equipment + cables, tracking **ordered vs. received**. Import from the drawing, paste from Excel, auto-add kits, and export **pull orders** and **receiving checklists** (PDF/Excel/CSV) in your own **export formats**.
- **Packing** — **Labels** (case-label templates on a freeform canvas, printed two-up on Uline S-19323) and **Cases** (what's in each road case → a label per case).
- **Settings** — company + show branding, the shared libraries, kits, the switch-config template, the **Show Server** (the show on the production WiFi for crew phones) and updates.

📖 **New here? Start with the [Quick Start](docs/QUICK-START.md), then the full [User Guide](docs/USER-GUIDE.md).**

---

## Syncing to Vectorworks

Device Manager is the database; a set of Python scripts run **inside Vectorworks** (Script Palette) to link ConnectCAD devices to rows in it and push the data onto the drawing. One-time setup and the full workflow are in **[vectorworks-scripts/README.md](vectorworks-scripts/README.md)**.

> The app can stay open while a sync script runs — it refreshes when the script writes.

---

## Documentation

- [Quick Start](docs/QUICK-START.md) — install and your first project in a few minutes.
- [User Guide](docs/USER-GUIDE.md) — every page and feature, exports, and troubleshooting.
- [Vectorworks sync](vectorworks-scripts/README.md) — the ConnectCAD ↔ app workflow.
- [Host tools](host-tools/README.md) — the Hyper-V **VLAN Manager** GUI for the Windows host.

## Feedback

Found a bug or have an idea? **[Open an issue »](https://github.com/gawad1234/vw-device-manager/issues/new)** — include what you did, what you expected, and what happened (a screenshot helps). Or just message Gabe.

## Legal

Device Manager is local-first and collects no data about you. Anything you type about other people (like the crew directory) stays in your own files. See the
[Privacy Policy](docs/PRIVACY.md) and [Terms of Service](docs/TERMS.md).

---

<details>
<summary><strong>For developers</strong></summary>

Electron + React + TypeScript (electron-vite). SQLite via Node's built-in `node:sqlite` (no native module). Data travels between machines over Dropbox; code + installers go through this GitHub repo and the app's auto-updater.

```bash
npm install
npm run dev            # run in development
npm test               # unit tests (Node's built-in runner)
npm run build          # typecheck + bundle

# installers (build OUTSIDE Dropbox, unsigned):
export CSC_IDENTITY_AUTO_DISCOVERY=false
./node_modules/.bin/electron-builder --mac --arm64 -c.directories.output=/tmp/vwdm-out
./node_modules/.bin/electron-builder --win  --x64   -c.directories.output=/tmp/vwdm-win
```

Architecture notes live in [CLAUDE.md](CLAUDE.md); the cross-machine handoff log is `../PROGRESS.md`.
</details>
