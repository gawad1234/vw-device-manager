import { readFileSync } from 'fs'
import templatePath from '../../resources/vlan-config-template.ps1?asset'
import type { HostConfig, VlanEntry } from '../shared/types'

// The template is the base PowerShell script with two placeholders:
//   __SWITCH_NAME__  → the Hyper-V switch name (param default)
//   __VLANS_BLOCK__  → the generated $DefaultVlans entries
// Everything else (the ~400 lines of switch/adapter/IP logic) is verbatim.

/** A PowerShell single-quoted string literal (safe for any text: single quotes
 *  doubled, and `$` / backtick are literal inside single quotes). */
function psStr(s: string): string {
  return "'" + String(s ?? '').replace(/'/g, "''") + "'"
}

/** One `$DefaultVlans` entry, formatted like the base script's hand-written ones. */
function vlanEntry(v: VlanEntry): string {
  const tagged = v.tagged ? '$true' : '$false'
  const dhcp = v.dhcp ? '$true' : '$false'
  const ip = v.dhcp || !v.ipAddress ? '$null' : psStr(v.ipAddress)
  const prefix = Number.isFinite(v.prefixLength) ? Math.trunc(v.prefixLength) : 24
  const gw = !v.dhcp && v.gateway ? psStr(v.gateway) : '$null'
  const dns =
    v.dnsServers && v.dnsServers.length
      ? '@(' + v.dnsServers.filter(Boolean).map(psStr).join(', ') + ')'
      : '@()'
  const vlanId = Number.isFinite(v.vlanId) ? Math.trunc(v.vlanId) : 0
  return (
    `    @{ Name = ${psStr(v.name)}; VlanId = ${vlanId}; Tagged = ${tagged}; Dhcp = ${dhcp}\n` +
    `       IPAddress = ${ip}; PrefixLength = ${prefix}; Gateway = ${gw}; DnsServers = ${dns} }`
  )
}

/** Build the full PowerShell script for a saved host config. */
export function generateVlanScript(config: HostConfig): string {
  const template = readFileSync(templatePath, 'utf-8')
  const block = config.vlans.map(vlanEntry).join('\n\n') || '    # (no VLANs defined)'
  // The switch name sits inside a double-quoted param default — strip characters
  // that would break that string.
  const switchName = String(config.switchName || 'VLAN-Trunk').replace(/["`$]/g, '').trim() || 'VLAN-Trunk'
  return template.replace('__SWITCH_NAME__', switchName).replace('__VLANS_BLOCK__', block)
}
