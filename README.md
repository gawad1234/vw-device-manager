# Device Manager

**A desktop app for tracking network and AV gear for ConnectCAD / Vectorworks shows — IPs, VLANs, cables, shop orders, and case labels — and syncing it onto the drawing.**

Device Manager is the source-of-truth database for a show's network: every device, its ports, IP addresses, VLANs, MAC, location and notes. It then pushes that data back onto your ConnectCAD drawing in Vectorworks, and helps with the paperwork around it — purchasing/receiving, pull sheets, IP schedules, and printed road-case labels.

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

Everything lives in **projects** — one `.vwdm` file per show, kept next to its `.vwx` drawing. Use the project menu in the top-left to make a new one, open another, or save a copy. The app's tabs:

- **Devices** — every piece of gear, its ports, IPs, VLANs, MAC, type and location. Switches get management/OOB IPs and VLAN-only ports. The app warns about duplicate IPs and IPs outside their subnet.
- **Subnets** — your networks/VLANs (name, CIDR, VLAN tag, gateway).
- **Cables** — cable bundles and the individual cables in them (type, color, length, endpoints, pulled/labeled status). Export pull sheets, schedules, and cable labels.
- **Configs** — generate a Hyper-V VLAN setup PowerShell script from your subnets.
- **Orders** — shop orders with equipment + cables, tracking **ordered vs. received**. Import a bill of materials straight from the drawing, paste from Excel, and export **pull orders** and **receiving checklists** (PDF/Excel/CSV) with change-highlighting. Export layout is customizable — see **Export formats** in the guide.
- **Labels** — design reusable **case-label templates** on a freeform canvas (text, boxes, lines, your show name + logo) and print them two-up on Uline S-19323 sheets.
- **Cases** — a **packing manager**: list what's in each road case, then print a label per case from any template, filling in `{Case}`, `{Contents}`, `{Show}` and your own fields automatically.
- **Settings** — show branding (name + logo stamped on exports), the shared signal/cable-type library, device categories, and updates.

📖 **New here? Start with the [Quick Start](docs/QUICK-START.md), then the full [User Guide](docs/USER-GUIDE.md).**

---

## Syncing to Vectorworks

Device Manager is the database; a set of Python scripts run **inside Vectorworks** (Script Palette) to link ConnectCAD devices to rows in it and push the data onto the drawing. One-time setup and the full workflow are in **[vectorworks-scripts/README.md](vectorworks-scripts/README.md)**.

> ⚠️ **Never run the app and a sync script at the same time** on the same project — let one finish before starting the other.

---

## Documentation

- [Quick Start](docs/QUICK-START.md) — install and your first project in a few minutes.
- [User Guide](docs/USER-GUIDE.md) — every tab, exports, labels, cases, and troubleshooting.
- [Vectorworks sync](vectorworks-scripts/README.md) — the ConnectCAD ↔ app workflow.
- [Host tools](host-tools/README.md) — the Hyper-V **VLAN Manager** GUI for the Windows host.

## Feedback

Found a bug or have an idea? **[Open an issue »](https://github.com/gawad1234/vw-device-manager/issues/new)** — include what you did, what you expected, and what happened (a screenshot helps). Or just message Gabe.

---

<details>
<summary><strong>For developers</strong></summary>

Electron + React + TypeScript (electron-vite). SQLite via Node's built-in `node:sqlite` (no native module). Data travels between machines over Dropbox; code + installers go through this GitHub repo and the app's auto-updater.

```bash
npm install
npm run dev            # run in development
npm run build          # typecheck + bundle

# installers (build OUTSIDE Dropbox, unsigned):
export CSC_IDENTITY_AUTO_DISCOVERY=false
./node_modules/.bin/electron-builder --mac --arm64 -c.directories.output=/tmp/vwdm-out
./node_modules/.bin/electron-builder --win  --x64   -c.directories.output=/tmp/vwdm-win
```

Architecture notes live in [CLAUDE.md](CLAUDE.md); the cross-machine handoff log is `../PROGRESS.md`.
</details>
