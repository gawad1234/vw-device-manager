# Host tools — Hyper-V VLAN Manager

A small GUI for managing a **Hyper-V host's VLAN network adapters** — see the VLANs that are there, add/edit/remove them, and apply the changes live. It's a friendly front-end to the same proven setup logic Device Manager's **Configs** tab generates.

> Windows only. Needs Windows 10/11 **Pro / Enterprise / Education** with the Hyper-V feature enabled, and administrator rights. Runs on **Windows PowerShell 5.1** (built in — no install).

## Files

| File | What it is |
|---|---|
| `VlanManager.ps1` | The GUI. This is the one you run. |
| `Apply-VlanConfig.ps1` | The engine it calls to make the changes (idempotent, retried, supports preview + teardown). Keep it in the **same folder** as the GUI. |

Keep both files together.

## Run it

Right-click **`VlanManager.ps1` → Run with PowerShell**, or from a terminal:

```powershell
powershell -ExecutionPolicy Bypass -File .\VlanManager.ps1
```

It relaunches itself **as administrator** automatically (accept the UAC prompt).

## Using it

1. **Read host** — fills the list with the VLAN adapters currently on the host, and populates the **Virtual switch** and **Physical NIC** pickers.
2. **Add / Edit / Remove** — change the list. Each entry is an adapter: a name, whether it's **tagged** (and its VLAN ID) or the one **untagged/native** network, and either **DHCP** or a static **IP / prefix / gateway / DNS**.
3. **Virtual switch** — the name of the external Hyper-V switch to create or reuse. **Physical NIC** — the wired adapter to bind a *new* switch to (only needed when the switch doesn't exist yet).
4. **Preview changes** — a dry run: shows exactly what *would* happen, changing nothing.
5. **Apply to host** — makes the changes (after a confirm). This can briefly drop the network on the bound NIC. The list re-reads from the host afterward.
6. **Teardown** — removes the listed adapters and the switch.

### Working with Device Manager

In Device Manager's **Configs** tab, build your VLAN list (or pull it from the project's subnets) and click **Export JSON…**. In this tool, click **Load config…** and pick that `.json` to load the same VLANs, then Preview and Apply. **Save config…** writes the current list back out to the same format.

## Notes & safety

- **Preview first.** Always Preview before Apply so you can see the plan.
- The engine is **idempotent** — running it again reconciles the host to the list rather than duplicating anything.
- It only binds a new switch to a **wired** Ethernet adapter (Wi-Fi/cellular are skipped).
- Only **one** adapter can be the untagged/native network.
- Setting a gateway on more than one adapter usually causes routing problems — the engine warns about it.

## Troubleshooting

- **"The Hyper-V PowerShell module isn't installed."** Enable Hyper-V (admin PowerShell), then reboot:
  ```powershell
  Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
  ```
- **"Apply-VlanConfig.ps1 wasn't found."** Keep both files in the same folder.
- **Nothing happens / blocked script.** Launch with `-ExecutionPolicy Bypass` as shown above.
- **A new switch won't create.** Pick a **Physical NIC** (top-right) — a new external switch must bind to a wired adapter.
