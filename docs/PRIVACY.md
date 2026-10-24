# Privacy Policy

**Device Manager**
Effective date: October 24, 2026
Provided by: Gabriel Awad ("we", "us") — contact: gabriel@gabrielawad.com

## The short version

Device Manager is a **local-first desktop app**. It does **not** collect your
data, does **not** track you, and sends **nothing** to us. Everything you create
stays on your own computer and in your own cloud storage. The only time the app
reaches the internet on its own is to check GitHub for a software update.

## What data the app handles, and where it lives

Everything you enter — devices, networks/VLANs, cables, shop orders, case
labels, cases, patching, projector and wallpaper setups, software install kits,
crew and trucking schedules, and your company/show branding — is stored in
**files on your own computer**:

- **Project files** (`*.vwdm`) — one per show, plain SQLite databases.
- **A shared library file** (`library.json`) — your cross-project catalogs
  (device categories, cable types, signal types, auto-add kits, the software
  library, the switch-config template and admin login), your **company name and
  logo**, and your **crew directory**.
- **Per-machine settings** (`settings.json` in the app's data folder) — e.g.
  your recent-projects list and update preference.

These files are created and read **only on your device**. Software install kits
you build are written only to the folder you choose (for example a USB stick). If you keep them in a
folder synced by a service like **Dropbox**, that service syncs them between your
own machines on your behalf — that is your account and your choice, governed by
that service's own privacy policy, not by us.

### Information about other people

The **crew directory** and schedules can hold other people's names, phone
numbers, email addresses and pay rates, and trucking trips can hold drivers' and
contacts' names and numbers. This stays in your own files like everything else —
the app never uploads it, and the Show Server does not serve crew details,
schedules or rates to phones or browsers. If you let another computer running
Device Manager **join** your show (which needs your manager PIN), that computer
can read the whole show and your shared library — crew directory included — over
your local network while it is joined. You are responsible for how you share those files, so only
keep them in storage you control and trust.

## What we collect

**Nothing.** The app contains **no analytics, no telemetry, no tracking, no
advertising identifiers, and no accounts**. We do not receive your project data,
usage statistics, crash reports, your IP address, or any personal information.

## Network connections the app makes

1. **Software updates (GitHub).** The app can check for new versions and, if you
   choose to update, download the installer. These requests go to **GitHub**
   (github.com), which operates the release hosting and receives standard web
   request information (such as your IP address) as part of serving the
   download. That exchange is governed by
   [GitHub's Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement).
   Automatic downloading is **off by default** — the app only checks, and you
   decide whether to download and install.

2. **The optional "Show Server" (your local network only).** If you turn on the
   Show Server, the app serves your current project to devices on your **local
   Wi-Fi / LAN** over plain HTTP so your crew can view and update it from their
   phones. This traffic stays on your local network and is **not** sent to us or
   to any external service. It is plain HTTP (not encrypted), so only run it on a
   network you trust, and use the optional crew/manager PINs to limit access.
   Other copies of Device Manager on the same network can **join** the show with
   the manager PIN and read it through the same local server; that traffic also
   stays on your network.

Apart from these, the app makes no outbound connections.

## Device permissions

The macOS build declares standard system permission descriptions (camera,
microphone, Documents, Downloads) as a packaging default of the app framework.
**Device Manager does not use your camera or microphone**, and it only reads and
writes the project and library files you point it at.

## Children

Device Manager is a professional tool for audio/video and network production
work. It is not directed to children and does not knowingly collect information
from anyone.

## Changes to this policy

If this policy changes, the updated version will be posted here with a new
effective date. Because the app is local-first and collects nothing, changes are
expected to be rare.

## Contact

Questions about privacy? Email **gabriel@gabrielawad.com**.
