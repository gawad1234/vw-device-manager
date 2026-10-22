# Device Manager — User Guide

The complete reference for beta testers. For a fast first run, see the **[Quick Start](QUICK-START.md)** instead.

## Contents

- [Core concepts](#core-concepts)
- [Projects (the top-left menu)](#projects)
- [Devices](#devices)
  - [Projectors (Panasonic)](#projectors)
  - [Wallpapers](#wallpapers)
  - [Software install kits (Windows)](#software-install-kits)
- [Subnets](#subnets)
- [Configs](#configs)
- [Schedule — Crew](#crew)
- [Schedule — Trucking](#trucking)
  - [Truck load sheets](#truck-load-sheets)
- [Cables](#cables)
- [Patching](#patching)
- [Orders](#orders)
  - [Auto-add kits](#auto-add-kits)
  - [Export formats](#export-formats)
- [Labels](#labels)
- [Cases](#cases)
- [Show Server](#show-server)
- [Settings](#settings)
- [Updating the app](#updating-the-app)
- [Syncing to Vectorworks](#syncing-to-vectorworks)
- [Troubleshooting](#troubleshooting)

The left sidebar groups these: **Devices** (with Projectors, Wallpapers and Software under it), **Networking** (Subnets, Configs), **Schedule** (Crew, Trucking), **Cables**, **Patching**, **Orders**, **Packing** (Labels, Cases) and **Settings**.

---

## Core concepts

- **Project** — one `.vwdm` file per show. It holds all your devices, subnets, cables, orders, label templates and cases. It's a plain SQLite database. Keep it **next to the show's `.vwx` drawing with a matching name** (`Gala.vwx` → `Gala.vwdm`) so the Vectorworks scripts find it.
- **Source of truth** — the app is the authority for network data. The Vectorworks sync pushes *from* the app *onto* the drawing (the one exception is the device *name*, read from the drawing once when you first link a device).
- **Shared library** — things you reuse every show live in one shared library across *all* your projects: network signal types, cable types, device categories, auto-add kits, your company branding, the switch-config template, the software library and the crew directory. Show branding (show name/logo) is per project.
- **Dropbox sync** — projects live in Dropbox and move between your computers automatically. **Don't edit one project on two machines at once.** The app and the Vectorworks sync scripts *can* have the same project open together — the app refreshes itself when a script writes — but keep a project you're actively editing in a stable folder so Dropbox doesn't roll it back mid-sync.

---

## Projects

The menu in the **top-left** of the window manages projects:

- **New** — start an empty project.
- **Open…** — open an existing `.vwdm` file.
- **Recent** — jump back to a project you've used.
- **Save a Copy As…** — write the current project to a new file (this is how you first place a project next to its drawing).

The name of the open project shows in the header. Switching projects just reopens the app's data from the other file — your per-machine list of recent projects is stored locally, not in the project, so absolute paths never clash between your Mac and PC.

---

## Devices

The heart of the app: every piece of networked gear.

**A device has:** a name, a type (e.g. switch, converter, camera), a MAC address, a location, a category, notes, and one or more **ports**.

**The device window has three tabs** so it doesn't turn into one long scroll:
- **Details** — name, MAC, category, the switch checkbox (with management/OOB IPs) and notes. Type and location show read-only when they come from the drawing.
- **Ports (N)** — the ports and their IPs/VLANs (below).
- **Connections** — this device's patching circuits (see [Patching](#patching)).

Unsaved edits on one tab are kept when you switch tabs, and **Save changes** saves all of them.

**Ports** carry the network info (IP + VLANs live on the *port*, not the device):
- **Label** — the jack name.
- **IP address** — validated as you type.
- **Untagged VLAN** — the native network on that jack.
- **Tagged VLANs** — trunked networks on that jack.

**Switches:** flag a device as a switch and it gains device-level **Management IP** and **Out-of-band (OOB) IP** fields, and its ports become VLAN-only (no per-port IP — switch ports just carry VLANs).
- Each switch port shows (read-only) the device that's patched into it and that device's VLAN, from the Patching data.
- **LAG** — give several switch ports the same LAG name and they collapse into one combined interface: set the untagged + tagged VLANs once and they apply to every member.
- **Switch configs (beta)** — the app can generate a full, uploadable **NETGEAR M4350** startup config per switch (show VLANs, LAGs, per-port VLANs, management IP, name) from your house template in **Settings → Switch config generator**. It's on that switch's page in the [Show Server](#show-server), with **Copy** and **Download .cfg**. Verify it on a non-production switch first.

**Validation / warnings** happen automatically:
- **Duplicate IP** — if an IP is already used elsewhere, you're warned (a hard duplicate is rejected).
- **IP outside subnet** — if a port's IP isn't inside its untagged subnet's CIDR, you're warned.

Device **type** and **location** are usually owned by the drawing (read-only in the app) once a device is linked from ConnectCAD.

**Exports** (Devices → **Export ▾**): the **Device list** (name · location · main VLAN · main IP, grouped by category) and the **IP schedule** (every port), each in PDF / Excel / CSV.

### Projectors

**Devices → Projectors** sets up **Panasonic PT-RZ / PT-RQ** laser projectors. *Beta — the commands haven't been tested on a real projector yet.*

1. **+ Add projector…** — pick the device, then its **Model**.
2. Tick the settings you want changed and pick values. They're grouped as **Network Settings** (projector name, projector ID), **Signal Settings** (input, startup input, backup input, auto switch, startup logo, back color), **Installation & Lens** (projection method, lens model, position in the array, lens-memory names), **Light Settings** (operating mode, light output, standby mode, brightness control), **Picture Settings**, **Shutter Settings** and **Edge Blending**.
3. **Save command list…** writes a CSV that Panasonic's free **Multi Monitoring & Control Software** loads (*Create command list → Read file*) and sends to the projector.

✋ marks settings Panasonic has **no command** for — the **IP address, subnet, gateway and projector name** have to be set at the projector menu or with Panasonic's *Projector Network Setup Software*.

**Projector setup sheet** (Projectors → **Export ▾**, PDF / Excel / CSV): one page per projector — model and name on top, then a **Network Settings** table (IP address, subnet, router, projector ID — from the device's ports) and a table for each other section you used. Hand it to whoever is at the projector.

> Commands come from Panasonic's PT-RQ32K / RQ22K / RQ13K-family command list; not every option exists on every model. Try a command list on one projector before a show.

### Wallpapers

**Devices → Wallpapers** makes branded desktop wallpapers for show computers: your **show logo** centered, the **computer's name** under it and your **company logo** top-right, on a color you pick for that computer.

**+ Add computer…**, set its color, add its displays (width × height — mark a display **Black** for a plain black background), then **Generate wallpapers…** and pick a folder. You get one PNG per display, or tick **Combine displays** for one image spanning all of them (for Windows).

### Software install kits

**Devices → Software** builds a USB-ready install kit per computer, so setting up show machines is "plug in, double-click, walk away". *Windows only for now; beta.*

1. **Software library…** — add each Windows installer (`.exe` or `.msi`) with **Browse…**. The name fills in from the file, and the **silent install switches** start from a guess (`/qn /norestart` for an .msi, `/S` for an .exe); the **Presets** menu has MSI, Inno Setup, NSIS, InstallShield and generic `/quiet`. The library is shared by every show.
2. **+ Add computer…** and tick the software it needs.
3. **Build install kit…** — pick a folder (e.g. a USB stick). You get **`<Computer> Setup/`** with:
   - `installers\` — just that computer's installers,
   - **`Install.bat`** — double-click this on the computer,
   - `Install.ps1` — what it runs: asks for admin once, installs each program silently in order, writes `install-log.txt` next to itself and shows an OK / restart needed / FAILED summary.

Tips:
- Silent switches aren't standard — every vendor picks their own installer builder. Check each one on a spare machine before the show; some programs need a license key or have no silent mode.
- The library stores **where each installer is on this computer**, and the kit copies from there — build kits on the machine that has the installers (a path picked on the Windows PC won't exist on the Mac). If a file is missing, nothing is copied and the app lists what's missing.

---

## Subnets

Your networks — each doubles as a VLAN/network definition:

- **Name**, **CIDR** (e.g. `10.0.20.0/24`), **VLAN** tag, **Gateway**, **Notes**.

Subnets are what ports reference for their untagged/tagged VLANs, and they drive the IP-outside-subnet checks and the **Configs** VLAN script generator.

---

## Crew

**Schedule → Crew** books crew on the show and works out what they cost.

**Crew directory…** — your people, shared by every show: name, role, phone, email, notes and how they're paid — a **day rate**, or **hourly with overtime** (after N hours a day, at a multiplier such as 1.5×). The directory is stored only in your library file on your own computer / Dropbox — it's never uploaded anywhere or put in the project file.

**On the Crew page:**
1. Set the show's **From** and **To** dates.
2. **+ Book crew…** adds a person; their default rates are copied in and you can change them for this show (click their name).
3. Fill in the grid — click a day to set **Working / Off / Clear** and the **call** and **end** times (an end before the call runs past midnight). *Copy times to all their work days* saves retyping.
4. The **Phase** row tags each date (Load-in, Tech, Show, Strike… — or type your own).

The right-hand columns total **days**, **hours** (with overtime) and **cost** per person, and the bottom row totals the show. Hourly crew with a work day that has no times get a ⚠ — those days can't be costed until you add times.

---

## Trucking

**Schedule → Trucking** plans the show's trucks and every run they make.

- **Trucks** — name, vendor, size (e.g. *26′ box*), cost and contact, with a cost total.
- **Trips** (**+ Add trip**) — type (delivery, load-in, load-out, return), truck, date, status (planned / confirmed / done), **from → to** with the **pickup and delivery addresses**, depart and arrive times, the **dock slot** at the destination, the driver and their phone, **who to contact on arrival** (name + phone), notes, and which **packed cases** ride on it (ticked from your [Cases](#cases)).

The trips list is sorted by date and time.

### Truck load sheets

A printable sheet for the shop — one page per trip:
- the trip type and date, truck, vendor, size and status,
- **Pick up** and **Deliver to** boxes with the full addresses, times and dock slot,
- a highlighted **"On arrival, contact …"** line,
- the driver,
- every case on the truck — case name, description, contents — with a **Loaded ☐** box, and a case count,
- the trip notes and **Loaded by / Date & time / Received by** sign-off lines.

**Save & print load sheet** (in a trip) prints that trip; **Print all load sheets** (on the Trucking page) prints every trip, one per page. A case's description is its *Description* field if it has one, otherwise its other fields.

---

## Cables

Manage cable bundles and the individual cables inside them.

- A **bundle** has a name, **color**, from/to location, **length** (shared by every cable in the bundle — they run together), and notes.
- A **cable** has a name, cable **type** (from the shared library), **pulled** / **labeled** checkboxes, notes, and **source/destination endpoints**. An endpoint links to a device (and optionally a port), or is free text.

**Exports** (via the **Export ▾** menu):
- **Pull sheet** — PDF/Excel/CSV checklist for pulling cable.
- **Cable schedule** — the full run list.
- **Cable labels** — printable labels in two styles: **cards** and wrap-around **flags**.

---

## Configs

Builds a **Hyper-V VLAN trunk** for a Windows host — one untagged (native) adapter plus one per tagged VLAN, each with its own IP — so the host's virtual switch matches the show's VLANs. Build the VLAN list by hand or pull it from the project's subnets, then either:

- **Generate script…** — a ready-to-run PowerShell `.ps1` you run on the host (as admin).
- **Export JSON…** — a config file for the standalone **VLAN Manager** tool.

### VLAN Manager (host tool)

For a GUI instead of a script, the project repo ships a small **VLAN Manager** in the **`host-tools/`** folder. Run it on the Hyper-V host to:

- **see the VLAN adapters that are there right now,**
- add / edit / remove them,
- **Preview** the exact changes, then **Apply** them live (idempotent, with retries),
- **Teardown** the switch + adapters.

Tie it to Device Manager with **Export JSON…** here → **Load config…** in the tool. Setup and full instructions are in [`host-tools/README.md`](../host-tools/README.md).

> Both the generated script and the tool need Windows 10/11 Pro+ with Hyper-V, and administrator rights.

---

## Patching

Track the patching of cables on devices by importing a Vectorworks **ConnectCAD circuit report**.

**Import:** in Vectorworks, export an **All Layers Circuit Report** to CSV. On the **Patching** tab click **Import circuit report…** and pick the file. Each row becomes a **circuit** — a run from a source device/socket to a destination device/socket, with its signal, cable number, connector and rack/U/slot.

**Re-importing keeps your checkmarks:** it adds new circuits, updates existing ones and removes circuits no longer in the report. If the file you pick has no circuits in it (the wrong file), nothing is removed.

**Per-end tracking:**
- **From ✓** / **To ✓** mark *that end* patched, so a run plugged in on only one side shows as "one end only".
- **Tested** confirms the signal end-to-end and marks both ends patched.
- Un-patching either end clears **Tested**.

The Patching tab lists the whole show (filter by device / rack / signal / status, group by rack, device or signal, with live totals). Each device's **Connections** tab shows just its circuits. With the [Show Server](#show-server) running, crew can tick connections off from their phones.

---

## Orders

Track equipment and cable purchasing, and receiving.

**An order** has a name/number, vendor, date, notes, and two sub-pages:
- **Equipment** — line items with Item, Manufacturer, Model, Category, **Quantity ordered**, **Received**, and Notes. Outstanding is derived (ordered − received).
- **Cables** — cable type, length, quantity ordered/received, notes.

**Getting items in fast:**
- **Import from drawing** — pulls the project's synced devices in as a bill of materials, grouped by model with counts (and carries each device's category).
- **Import cables** — same idea for the project's cables.
- **Paste from Excel** — copy a block of cells and paste; tab/newline becomes rows and columns (Item, Mfr, Model, Ordered, Received, Notes, Category).

**The Orders tab** shows every order with a status badge (**Not received / Partial / Complete**), an **All / Open / Complete** filter, and a cross-order **"still waiting"** rollup of everything outstanding.

**Exports** (the **Export ▾** menu inside an order):
- **Pull order** — for the shop, showing what to send.
- **Receiving checklist** — for the receiving team, with ☐ checkboxes and an Outstanding column.
- Both in **PDF / Excel / CSV**, grouped by category, stamped with the export date.
- **Highlight changes since last export** — tick this to color new/changed rows and add a Change column, compared against the last time you exported that order. The baseline re-snapshots on every export.

### Auto-add kits

**Settings → Manage kits** defines companions that get added automatically: *"when I add X, also add these"* (equipment or cable, per unit). A kit's trigger matches an item's name, model or manufacturer and can use `*` wildcards (e.g. `PT-RZ*`); every matching kit applies, scaled by the quantity. Kits fire when you type an item in (not on import or paste) and are shared by every show.

### Export formats

Save reusable **export-format templates** ("order types") and pick one per export. In an order's **Export ▾** menu:

- **Format** dropdown — **Default (built-in)** or any format you've saved.
- **Edit formats…** — opens the format manager.

Each format controls:

| Setting | What it does |
|---|---|
| **Columns** | Show/hide each column (Category, Item, Manufacturer, Model, Requested, Received, Outstanding, Notes), **reorder** them with ↑ / ↓, and set each one's **width**. |
| **Width** | A relative weight in the PDF (columns share the page by weight) and the character width in Excel. |
| **Group by category** | On: the PDF prints a section per category; Excel/CSV get a leading Category column and category sort. Off: one flat table. |
| **Sort rows** | Category-then-name, Name, or Most-outstanding-first. |
| **Page orientation** | Portrait or Landscape. |
| **Row density** | Compact / Normal / Large — controls PDF font size and cell padding. |

Create several — e.g. a tight *"Pull order — compact, landscape"* for the shop and a *"Receiving — large print"* for the floor — and switch between them at export time. Leaving the picker on **Default** produces exactly the same documents as before formats existed.

---

## Labels

Design reusable **case-label templates** and print them two-up on **Uline S-19323** blockout sheets (8.5″ × 5.5″, two labels per letter page).

**Starting a template:** **New label ▾** → start Blank or from a preset (road case / truck / contents).

**The canvas editor** — an 8.5″ × 5.5″ label you build freeform:
- **Add elements:** `+ Text`, `+ Box`, `+ Line`, `+ Show name`, `+ Show logo`. (Show name / logo pull from **Settings → Show branding**.)
- **Move/resize:** drag an element to move it; drag its corner handle to resize. Or set exact X/Y/W/H (in inches) in the property panel.
- **Arrange (with an element selected):**
  - **Order** — Front / ↑ / ↓ / Back controls what's stacked on top of what.
  - **Align** — snap the element to the label's left/center/right and top/middle/bottom.
- **Text options:** font size, bold, color, horizontal align, **vertical align**, **wrap** on/off, and **auto-size** (shrinks text to fit its box — handy when the text varies, e.g. per-case contents).
- **Duplicate / Delete element**, plus **Copies** and **Print PDF…** in the footer.

Templates are saved by name and listed on the Labels tab.

---

## Cases

A **packing manager** that turns your label templates into per-case labels.

**A case** has:
- a **name** (e.g. *Case 1 — FOH*),
- custom **fields** — key/value details like Truck Number, Sent To, Weight,
- a **Contents** list (one item per line),
- private **notes** (not printed).

**Streamlined entry:** when you open a case, its Fields are **pre-filled from the tokens your label templates use**, so you just type values instead of remembering field names.

**Printing labels for cases:** on the Cases tab, pick a **template**, tick the cases you want, set **how many copies** of each (the Copies column), and **Print labels**. The template's text tokens are filled in per case:

| Token | Becomes |
|---|---|
| `{Case}` | the case name |
| `{Contents}` | the contents list |
| `{Show}` | your project's show name |
| `{Any field name}` | that case's matching field value |

Unmatched tokens print blank. Each selected case prints its copy count, laid out two-up on the Uline sheets.

> **Tip:** build a template with `{Case}` as a big title, `{Contents}` in an auto-sizing text box, and your own `{Truck Number}` / `{Sent To}` fields, and one template covers every case.

---

## Show Server

Serve the open show over your **local production WiFi** so anyone helping with the build can use it from their own phone or laptop — just a browser, no install.

**Turn it on:** **Settings → Show Server** — switch it on, pick a **port** (default 8787), set a **crew PIN** and/or a **manager PIN**, and hand out the address (shown with a QR code). The on/off switch and port are per computer; the PINs are saved with the show. The first time, your OS asks to allow incoming connections — say yes (*Private network* on Windows).

**What crew can do:** receive order items (quantities + notes), see the IP schedule and device list, open a page per device (ports → VLANs, switch IPs, notes, its own QR code — and, for switches, the generated [switch config](#devices)), tick off [patching](#patching), and view/print case labels. **Managers** also get a printable **QR sheet** for sticking a code on each piece of gear.

**Access:** a blank crew PIN leaves the site open to anyone on the WiFi; a crew PIN locks it; the manager PIN gates the admin tools. Crew schedules, rates and contact details are **not** served.

---

## Settings

- **Company branding** — your company name and logo, stamped as a letterhead on every project's paperwork. Shared across all projects.
- **Show branding** — the show **name** and **logo**. These stamp onto exports (pull orders, schedules, labels) and feed the `{Show}` token and the Show-name/logo label elements. Per project.
- **Network signal types** — the shared library of signal types used by ports. Shared across all projects.
- **Cable types** — the shared catalog used by cables. Shared across all projects.
- **Device categories** — the category list used by devices and order line items (type to filter; a new name creates a category).
- **Manage kits** — [auto-add kits](#auto-add-kits) for orders.
- **Switch config generator** — the house base template and admin login used for [switch configs](#devices). *The admin password is stored in plain text in the generated config.*
- **Show Server** — see [above](#show-server).
- **Updates** — see below.

---

## Updating the app

The app checks GitHub for new releases and surfaces them under **Settings → Updates**:

- **Automatic vs. Manual** — choose whether it checks on launch. A dot appears on the Settings tab when an update is waiting.
- **Check for updates** — check on demand; you'll see the new version's notes.
- **Windows** installs updates in-app (restart to apply). **macOS** (unsigned) can't self-apply, so it opens the download page — grab the new `.dmg` and reinstall.

---

## Syncing to Vectorworks

Device Manager holds the data; Python scripts run **inside Vectorworks** (Script Palette) link ConnectCAD devices to rows in the app and write the data onto the drawing. The full one-time setup (the `VWDM Sync` and `VWDM Port` record formats) and the link → sync workflow are documented in **[vectorworks-scripts/README.md](../vectorworks-scripts/README.md)**.

> The app can stay open while a script runs — the project is a real database file, so they don't overwrite each other, and the app refreshes when the script writes. Just keep the project somewhere Dropbox isn't actively re-syncing while you work.

---

## Troubleshooting

**macOS says the app is "damaged and can't be opened."**
It's not damaged — it's unsigned and quarantined. Run once in Terminal:
```bash
xattr -dr com.apple.quarantine "/Applications/Device Manager.app"
```
then **right-click the app → Open**. (Or System Settings → Privacy & Security → **Open Anyway**.)

**Windows SmartScreen blocks the installer.**
Click **More info → Run anyway**. This is expected for an unsigned beta installer.

**My changes aren't showing up on my other computer.**
Give Dropbox a moment to sync, and make sure the project folder is **available offline** (not online-only) in Dropbox — right-click the folder → *Make Available Offline*. Never have the same project open on two machines at once.

**A Vectorworks sync didn't take / data looks wrong.**
Check the script found the right project (the `.vwdm` must sit beside the `.vwx` with the same name) and that Dropbox has finished syncing that folder, then re-run the sync.

**A software install kit says an installer wasn't found.**
The library remembers where each installer lives on the computer you added it from. Build the kit on that computer, or re-pick the installer with **Browse…** in the Software library.

**A program in an install kit failed or popped up a window.**
Its silent switches are wrong for that installer. Check `install-log.txt` in the kit folder, look up the vendor's silent-install switches, and fix them in the Software library.

**An export looks off (wrong columns, cramped, etc.).**
Check which **export format** is selected in the Export menu — switch to **Default**, or open **Edit formats…** and adjust columns/width/density.

**Something else?**
Please **[open an issue](https://github.com/gawad1234/vw-device-manager/issues/new)** with what you did, what you expected, and what happened — a screenshot helps a lot.
