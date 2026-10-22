# Quick Start

Get Device Manager installed and set up your first show in a few minutes. For the full reference, see the **[User Guide](USER-GUIDE.md)**.

---

## 1. Install

Download the installer for your computer from the **[Releases page](https://github.com/gawad1234/vw-device-manager/releases/latest)**:

- **Mac (Apple Silicon):** open the `.dmg`, drag **Device Manager** to Applications, then **right-click it → Open**. (First launch only — see [troubleshooting](USER-GUIDE.md#troubleshooting) if macOS says it's "damaged.")
- **Windows:** run `…-setup.exe`; on the SmartScreen warning click **More info → Run anyway**.

---

## 2. Create your show's project

Each show is one **project file** (`.vwdm`). The convention is to keep it **next to your drawing with the same name** — `MyShow.vwx` → `MyShow.vwdm` — so the Vectorworks sync scripts find it automatically.

1. Open Device Manager.
2. Top-left **project menu → Save a Copy As…** and save it beside your `.vwx` with a matching name.

> Projects live in Dropbox and sync between your computers automatically. Don't edit the same project on two machines at once.

---

## 3. Set your show branding

**Settings → Show branding** — enter the show name and (optionally) drop in a logo. These get stamped onto every export (pull orders, schedules, case labels), so it's worth doing once up front.

---

## 4. Add your networks, then your gear

1. **Subnets tab → add a subnet** for each network/VLAN (name, CIDR like `10.0.10.0/24`, VLAN tag, gateway).
2. **Devices tab → add a device.** Give it a name, type, and a port; assign the port an IP and its untagged/tagged VLANs. Mark switches as switches — they get management/OOB IPs and VLAN-only ports.

The app flags duplicate IPs and IPs that fall outside their subnet as you go.

> Already have a ConnectCAD drawing? You'll usually **link** devices from the drawing instead of typing them — see the [Vectorworks sync guide](../vectorworks-scripts/README.md).

---

## 5. Do the paperwork

- **Orders** — build a shop order (or import a bill of materials from the drawing), track received-vs-ordered, and export a **pull order** or **receiving checklist**. You can save custom **export formats** for different order types.
- **Cables** — group cables into bundles (looms) and export pull sheets and labels; **Loom labels** prints a sticker for each end of every cable onto manufacturer sticker sheets.
- **Labels + Cases** — design a road-case label template, list what's in each case, and print a label per case.
- **Schedule** — book crew and track their days, call times and cost (**Crew**); plan trucks and trips and print **load sheets** for the shop (**Trucking**).
- **Devices → Projectors / Wallpapers / Software** — Panasonic projector setup sheets, branded desktop wallpapers, and USB install kits for show computers.

---

## 6. Push it onto the drawing

In Vectorworks, run the sync scripts to write everything back onto your ConnectCAD devices. One-time setup and the workflow are in **[vectorworks-scripts/README.md](../vectorworks-scripts/README.md)**.

---

That's the loop. The **[User Guide](USER-GUIDE.md)** covers every tab and feature in detail.
