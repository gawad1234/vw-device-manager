import type { Device, Port, Subnet, SwitchMonitoring } from '../shared/types'
import { ipInCidr, isValidIpv4, parseCidr } from './ip-utils'

// Generates a NETGEAR M4350 (FASTPATH-style) CLI startup-config for a switch.
// The house base config (QoS, class-maps, classofservice, spanning-tree, …) lives
// in an editable template with {{TOKENS}}; the generator fills the show-specific
// blocks from the app's data (VLANs, LAGs, per-port VLAN assignment, admin login,
// sysname, management IP). Ports are numbered sequentially in app order:
// 1st active port -> 1/0/1, 2nd -> 1/0/2, …

export interface SwitchConfigOptions {
  baseTemplate: string
  adminUser: string
  adminPassword: string
  monitoring?: SwitchMonitoring
  /** a copy for crew: the login and SNMP community are left out on purpose */
  crewCopy?: boolean
}

/** The per-interface house line applied to every port/LAG (matches the base template's POLICY_AV). */
const PER_INTERFACE_HOUSE = 'service-policy in POLICY_AV'

/** Seeded from a real Birthright M4350 startup-config. House-constant parts are kept;
 *  show-specific blocks are {{TOKENS}}. Per-VLAN multicast + L3/SVI/routing were left
 *  out (not modeled yet) — add them here if you need them. Editable in Settings. */
export const DEFAULT_SWITCH_BASE_CONFIG = `!Current Configuration:
!
vlan database
{{VLANS}}
exit
ip http port 49151
configure
clock summer-time recurring USA offset 60
clock timezone -5 minutes 0 zone "ZZZZ"
{{USERS}}
line console
exit
line telnet
exit
line ssh
exit
spanning-tree mst priority 0 0
no port-channel auto
{{LAGS}}
ntp broadcast client
{{SYSNAME}}
{{MONITORING}}
no switchport mode auto
ip access-list NET-BLOCK
exit
class-map match-all CLASS_PTP1
match dstip 224.0.1.129 255.255.255.255
exit
class-map match-all CLASS_PTP2
match dstip 224.0.1.130 255.255.255.254
exit
class-map match-all CLASS_PTP3
match dstip 224.0.1.132 255.255.255.255
exit
class-map match-all CLASS_AUDIO1
match ip dscp 46
exit
class-map match-all CLASS_AUDIO2
match ip dscp 34
exit
class-map match-all CLASS_VIDEO
match ip dscp 26
exit
class-map match-all CLASS_ENGAGE1
match srcl4port 4443
exit
class-map match-all CLASS_ENGAGE2
match dstl4port 4443
exit
policy-map POLICY_AV in
class CLASS_PTP1
assign-queue 6
exit
class CLASS_PTP2
assign-queue 6
exit
class CLASS_PTP3
assign-queue 6
exit
class CLASS_AUDIO1
assign-queue 5
exit
class CLASS_AUDIO2
assign-queue 5
exit
class CLASS_VIDEO
assign-queue 4
exit
class CLASS_ENGAGE1
assign-queue 3
exit
class CLASS_ENGAGE2
assign-queue 3
exit
exit
classofservice dot1p-mapping 2 2
classofservice dot1p-mapping 3 3
classofservice dot1p-mapping 4 4
classofservice dot1p-mapping 5 5
classofservice dot1p-mapping 6 6
classofservice dot1p-mapping 7 6
classofservice trust dot1p
{{INTERFACES}}
{{MGMT}}
exit`

export function maskFromCidr(cidr: string | null): string {
  const range = parseCidr(cidr ?? '')
  if (!range) return '255.255.255.0'
  return [24, 16, 8, 0].map((sh) => (range.mask >>> sh) & 255).join('.')
}

/** The highest VLAN the M4350 takes; 1 is the default VLAN and always exists. */
const MAX_VLAN = 4093

/** A name inside quotes on a CLI line: a quote or line break would end it early. */
function cliText(s: string): string {
  return s.replace(/["\r\n]/g, '').trim()
}

/** The lines that point a switch at the monitoring PC (recipe from Status Monitor's
 *  docs/research/netgear-av-switches.md). Severity 6 is needed: the default, 2, hides
 *  even link up/down. Log format stays the default RFC 3164, which Alloy expects. */
function monitoringLines(m: SwitchMonitoring | undefined, crewCopy: boolean, notes: string[]): string[] {
  if (!m) return []
  const out: string[] = []
  const community = m.snmpCommunity.trim()
  if (community && !/^[\w.-]+$/.test(community)) {
    notes.push('The SNMP community can only use letters, numbers, dot, dash and underscore. SNMP not set.')
  } else if (community && !crewCopy) {
    if (m.m4300Snmp) {
      out.push(`snmp-server community ${community}`)
      out.push(`snmp-server community ro ${community}`)
      out.push(`snmp-server community mode ${community}`)
    } else {
      out.push(`snmp-server community ${community} ro`)
    }
  }
  const servers = logServerList(m)
  const port = Number.isInteger(m.syslogPort) && m.syslogPort > 0 && m.syslogPort < 65536 ? m.syslogPort : 514
  for (const ip of servers) {
    if (isValidIpv4(ip)) out.push(`logging host ${ip} ipv4 ${port} 6`)
    else notes.push(`Logging server "${cliText(ip)}" isn't an IP address. Skipped.`)
  }
  if (out.some((l) => l.startsWith('logging host'))) out.push('logging syslog')
  if (m.poeAlerts) out.push('poe usagethreshold all 85', 'poe traps')
  return out
}

function logServerList(m: SwitchMonitoring | undefined): string[] {
  return (m?.logServers ?? '').split(/[,\s]+/).filter(Boolean)
}

/** The switch port number each active port gets. Not-needed jacks are skipped:
 *  they may not be LAN ports at all, so they take no number on the switch. */
export function switchPortNumbers(ports: Port[]): Map<number, number> {
  const out = new Map<number, number>()
  ports.filter((p) => !p.isUnused).forEach((p, i) => out.set(p.id, i + 1))
  return out
}

function lagKey(p: Port): string {
  return (p.lagGroup ?? '').trim()
}

/** A port-channel name is a bareword — collapse the LAG label to a safe token. */
function lagToken(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'LAG'
}

/** The `vlan ...` lines inside an interface, from its untagged + tagged VLAN ids. */
function vlanIfLines(untagged: number | null, tagged: number[]): string[] {
  const include = [...new Set([untagged, ...tagged].filter((v): v is number => !!v))].sort(
    (a, b) => a - b
  )
  if (include.length === 0) return []
  const out: string[] = []
  if (untagged) {
    out.push(`vlan pvid ${untagged}`)
    out.push('vlan participation exclude 1')
  }
  out.push('vlan participation include ' + include.join(','))
  // A VLAN can't be native and tagged on one port: the device would get tagged frames.
  const tags = [...new Set(tagged)].filter((v) => v !== untagged).sort((a, b) => a - b)
  if (tags.length) out.push('vlan tagging ' + tags.join(','))
  return out
}

export function generateSwitchConfig(
  device: Device,
  subnets: Subnet[],
  opts: SwitchConfigOptions
): string {
  const vlanOfSubnet = (id: number | null): number | null => {
    if (id == null) return null
    const s = subnets.find((x) => x.id === id)
    const n = s ? Number(s.vlan) : NaN
    return Number.isInteger(n) && n > 0 && n <= MAX_VLAN ? n : null
  }
  // Problems the user must see. They print at the top of the config as comments.
  const notes: string[] = []
  // Every VLAN in the show (not just the ones this switch uses) — preloaded so they
  // are defined and ready to drop onto ports.
  const vlanSubnets: { s: Subnet; id: number }[] = []
  for (const s of subnets) {
    if (s.vlan == null || s.vlan === '') continue
    const id = vlanOfSubnet(s.id)
    if (id == null) notes.push(`Subnet "${cliText(s.name)}" has VLAN "${s.vlan}", which isn't 1-${MAX_VLAN}. Skipped.`)
    else if (id === 1) continue // VLAN 1 exists already and can't be created or renamed
    else if (vlanSubnets.some((x) => x.id === id)) notes.push(`VLAN ${id} is on more than one subnet. Using "${cliText(vlanSubnets.find((x) => x.id === id)!.s.name)}".`)
    else vlanSubnets.push({ s, id })
  }
  vlanSubnets.sort((a, b) => a.id - b.id)

  const ports = device.ports.filter((p) => !p.isUnused)
  const ifNum = switchPortNumbers(device.ports)

  const lags: { num: number; name: string; members: Port[] }[] = []
  const lagByKey = new Map<string, { num: number; name: string; members: Port[] }>()
  for (const p of ports) {
    const k = lagKey(p)
    if (!k) continue
    const key = k.toLowerCase()
    let g = lagByKey.get(key)
    if (!g) {
      g = { num: lags.length + 1, name: k, members: [] }
      lagByKey.set(key, g)
      lags.push(g)
    }
    g.members.push(p)
  }

  // {{VLANS}}
  const vlanLines: string[] = []
  if (vlanSubnets.length) {
    vlanLines.push('vlan ' + vlanSubnets.map((x) => x.id).join(','))
    for (const { s, id } of vlanSubnets) vlanLines.push(`vlan name ${id} "${cliText(s.name)}"`)
  }

  // {{USERS}}
  const userLines: string[] = []
  if (opts.adminPassword) {
    const u = cliText(opts.adminUser) || 'admin'
    if (/[\s"]/.test(opts.adminPassword)) {
      notes.push('The admin password has a space or quote, which the CLI cannot take. Login not set.')
    } else {
      userLines.push(`username "${u}" password ${opts.adminPassword} level 15`)
    }
  }

  // {{LAGS}} (membership; `no port-channel auto` lives in the template)
  const lagDefLines: string[] = []
  for (const lag of lags) {
    lagDefLines.push(`port-channel name lag ${lag.num} ${lagToken(lag.name)}`)
    for (const m of lag.members) {
      lagDefLines.push(`interface 1/0/${ifNum.get(m.id)}`)
      lagDefLines.push(`addport lag ${lag.num}`)
      lagDefLines.push('exit')
    }
  }

  // {{SYSNAME}}
  const sysname = cliText(device.name) ? `snmp-server sysname "${cliText(device.name)}"` : ''

  // {{INTERFACES}} — only ports that actually have VLAN config. LAG members are
  // configured in the LAG section; ports with nothing set (e.g. an OOB port, or a
  // port whose sequential number would exceed the physical count) are skipped so
  // the config never references an interface that doesn't exist.
  const ifLines: string[] = []
  for (const p of ports) {
    if (lagKey(p)) continue
    const vlines = vlanIfLines(
      vlanOfSubnet(p.untaggedSubnetId),
      p.taggedSubnetIds.map(vlanOfSubnet).filter((v): v is number => v != null)
    )
    if (vlines.length === 0) continue
    ifLines.push(`! Port ${cliText(p.label)}`)
    ifLines.push(`interface 1/0/${ifNum.get(p.id)}`)
    ifLines.push(PER_INTERFACE_HOUSE)
    ifLines.push(...vlines)
    ifLines.push('exit')
  }
  for (const lag of lags) {
    const rep = lag.members[0]
    ifLines.push(`interface lag ${lag.num}`)
    ifLines.push(PER_INTERFACE_HOUSE)
    ifLines.push('port-channel static')
    ifLines.push(`description "${cliText(lag.name)}"`)
    ifLines.push(
      ...vlanIfLines(
        vlanOfSubnet(rep.untaggedSubnetId),
        rep.taggedSubnetIds.map(vlanOfSubnet).filter((v): v is number => v != null)
      )
    )
    ifLines.push('exit')
  }

  // {{MGMT}}
  let mgmt = ''
  if (device.managementIp) {
    // The narrowest subnet holding the IP, so an "everything" /8 can't win.
    const sub = subnets
      .filter((s) => s.cidr && ipInCidr(device.managementIp as string, s.cidr) === true)
      .sort((a, b) => (parseCidr(b.cidr)?.prefix ?? 0) - (parseCidr(a.cidr)?.prefix ?? 0))[0]
    const vlanId = sub ? vlanOfSubnet(sub.id) : null
    // Logs need a route out: nothing in this config gives the switch a gateway.
    if (sub) {
      for (const ip of logServerList(opts.monitoring)) {
        if (ipInCidr(ip, sub.cidr) === false) {
          notes.push(`Logging server ${ip} is outside ${cliText(sub.name)} (${sub.cidr}), so the switch needs a route to reach it.`)
        }
      }
    }
    if (vlanId == null) {
      // Guessing VLAN 1 would lock you out: every native port excludes it.
      notes.push(`Management IP ${device.managementIp} isn't in a subnet with a VLAN. Not set.`)
    } else {
      mgmt = `ip management vlan ${vlanId} ${device.managementIp} ${maskFromCidr(sub.cidr)}`
    }
  }
  const wantsMonitoring = !!opts.monitoring?.snmpCommunity.trim() || logServerList(opts.monitoring).length > 0
  if (wantsMonitoring && !device.managementIp) {
    notes.push('No management IP, so the monitoring server has no address to poll this switch at.')
  }
  const monitoring = monitoringLines(opts.monitoring, !!opts.crewCopy, notes)
  if (device.oobIp) notes.push(`Out-of-band IP ${device.oobIp} isn't set by this config.`)

  const fill: Record<string, string> = {
    VLANS: vlanLines.join('\n'),
    USERS: userLines.join('\n'),
    LAGS: lagDefLines.join('\n'),
    SYSNAME: sysname,
    MONITORING: monitoring.join('\n'),
    INTERFACES: ifLines.join('\n'),
    MGMT: mgmt
  }
  // Replace each {{TOKEN}}; drop the whole line if its content is empty (no blank gaps).
  // Templates saved before this token existed: same mode, just before the interfaces.
  const template = opts.baseTemplate.includes('{{MONITORING}}')
    ? opts.baseTemplate
    : opts.baseTemplate.replace('{{INTERFACES}}', '{{MONITORING}}\n{{INTERFACES}}')
  const config = template.replace(/^.*\{\{(\w+)\}\}.*$\n?/gm, (line, token: string) => {
    const content = fill[token]
    if (content === undefined) return line // unknown token: leave as-is
    return content ? content + '\n' : ''
  })
  return notes.map((n) => `! CHECK: ${n}\n`).join('') + config
}
