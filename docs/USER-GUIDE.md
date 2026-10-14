# Device Manager — User Guide

The complete reference for beta testers. For a fast first run, see the **[Quick Start](QUICK-START.md)** instead.

## Contents

- [Core concepts](#core-concepts)
- [Projects (the top-left menu)](#projects)
- [Devices](#devices)
- [Subnets](#subnets)
- [Cables](#cables)
- [Configs](#configs)
- [Orders](#orders)
  - [Export formats](#export-formats)
- [Labels](#labels)
- [Cases](#cases)
- [Settings](#settings)
- [Updating the app](#updating-the-app)
- [Syncing to Vectorworks](#syncing-to-vectorworks)
- [Troubleshooting](#troubleshooting)

---

## Core concepts

- **Project** — one `.vwdm` file per show. It holds all your devices, subnets, cables, orders, label templates and cases. It's a plain SQLite database. Keep it **next to the show's `.vwx` drawing with a matching name** (`Gala.vwx` → `Gala.vwdm`) so the Vectorworks scripts find it.
- **Source of truth** — the app is the authority for network data. The Vectorworks sync pushes *from* the app *onto* the drawing (the one exception is the device *name*, read from the drawing once when you first link a device).
- **Shared library** — network signal types and cable types are shared across *all* your projects (so you don't re-enter them each show). Device branding (show name/logo) is per project.
- **Dropbox sync** — projects live in Dropbox and move between your computers automatically. Two rules: **don't edit one project on two machines at once**, and **never run the app and a Vectorworks sync script on the same project simultaneously** — they can overwrite each other.

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

**A device has:** a name, a type (e.g. switch, converter, camera), a MAC address, a location, notes, and one or more **ports**.

**Ports** carry the network info (IP + VLANs live on the *port*, not the device):
- **Label** — the jack name.
- **IP address** — validated as you type.
- **Untagged VLAN** — the native network on that jack.
- **Tagged VLANs** — trunked networks on that jack.

**Switches:** flag a device as a switch and it gains device-level **Management IP** and **Out-of-band (OOB) IP** fields, and its ports become VLAN-only (no per-port IP — switch ports just carry VLANs).

**Validation / warnings** happen automatically:
- **Duplicate IP** — if an IP is already used elsewhere, you're warned (a hard duplicate is rejected).
- **IP outside subnet** — if a port's IP isn't inside its untagged subnet's CIDR, you're warned.

Device **type** and **location** are usually owned by the drawing (read-only in the app) once a device is linked from ConnectCAD.

---

## Subnets

Your networks — each doubles as a VLAN/network definition:

- **Name**, **CIDR** (e.g. `10.0.20.0/24`), **VLAN** tag, **Gateway**, **Notes**.

Subnets are what ports reference for their untagged/tagged VLANs, and they drive the IP-outside-subnet checks and the **Configs** VLAN script generator.

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

Generates a **Hyper-V VLAN setup PowerShell script** from your subnets, so a Windows host's virtual switch can be configured to match the show's VLANs. Pick your options and the app produces the `.ps1` for you to run on the host.

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

## Settings

- **Show branding** — the show **name** and **logo**. These stamp onto exports (pull orders, schedules, labels) and feed the `{Show}` token and the Show-name/logo label elements. Per project.
- **Network signal types** — the shared library of signal types used by ports. Shared across all projects.
- **Cable types** — the shared catalog used by cables. Shared across all projects.
- **Device categories** — the category list used by devices and order line items.
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

> ⚠️ **Never run the app and a sync script at the same time** on the same project — close one before starting the other, or they can clobber each other's writes.

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
Make sure the app wasn't open on that project while the script ran. Re-run the sync with the app closed.

**An export looks off (wrong columns, cramped, etc.).**
Check which **export format** is selected in the Export menu — switch to **Default**, or open **Edit formats…** and adjust columns/width/density.

**Something else?**
Please **[open an issue](https://github.com/gawad1234/vw-device-manager/issues/new)** with what you did, what you expected, and what happened — a screenshot helps a lot.
