import type { Device, Port, Subnet } from '../shared/types'
import { ipInCidr } from './ip-utils'

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

function maskFromCidr(cidr: string | null): string {
  const prefix = Number((cidr ?? '').split('/')[1])
  if (!(prefix >= 0 && prefix <= 32)) return '255.255.255.0'
  const m = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return [24, 16, 8, 0].map((sh) => (m >>> sh) & 255).join('.')
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
  const tags = [...new Set(tagged)].sort((a, b) => a - b)
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
    return Number.isInteger(n) && n > 0 ? n : null
  }
  // Every VLAN in the show (not just the ones this switch uses) — preloaded so they
  // are defined and ready to drop onto ports.
  const vlanSubnets = subnets
    .map((s) => ({ s, id: Number(s.vlan) }))
    .filter((x) => Number.isInteger(x.id) && x.id > 0)
    .sort((a, b) => a.id - b.id)

  const ports = device.ports.filter((p) => !p.isUnused)
  const ifNum = new Map<number, number>()
  ports.forEach((p, i) => ifNum.set(p.id, i + 1))

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
    for (const { s, id } of vlanSubnets) vlanLines.push(`vlan name ${id} "${s.name}"`)
  }

  // {{USERS}}
  const userLines: string[] = []
  if (opts.adminPassword) {
    const u = opts.adminUser.trim() || 'admin'
    userLines.push(`username "${u}" password ${opts.adminPassword} level 15`)
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
  const sysname = device.name.trim() ? `snmp-server sysname "${device.name.trim()}"` : ''

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
    ifLines.push(`description "${lag.name}"`)
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
    const sub = subnets.find((s) => s.cidr && ipInCidr(device.managementIp as string, s.cidr) === true)
    const vlanId = sub ? vlanOfSubnet(sub.id) ?? 1 : 1
    const mask = sub ? maskFromCidr(sub.cidr) : '255.255.255.0'
    mgmt = `ip management vlan ${vlanId} ${device.managementIp} ${mask}`
  }

  const fill: Record<string, string> = {
    VLANS: vlanLines.join('\n'),
    USERS: userLines.join('\n'),
    LAGS: lagDefLines.join('\n'),
    SYSNAME: sysname,
    INTERFACES: ifLines.join('\n'),
    MGMT: mgmt
  }
  // Replace each {{TOKEN}}; drop the whole line if its content is empty (no blank gaps).
  return opts.baseTemplate.replace(/^.*\{\{(\w+)\}\}.*$\n?/gm, (line, token: string) => {
    const content = fill[token]
    if (content === undefined) return line // unknown token: leave as-is
    return content ? content + '\n' : ''
  })
}
