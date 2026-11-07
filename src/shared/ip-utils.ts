import type { Device, Subnet } from './types'

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function isValidIpv4(value: string): boolean {
  const match = IPV4_PATTERN.exec(value.trim())
  if (!match) return false
  return match.slice(1, 5).every((octet) => Number(octet) >= 0 && Number(octet) <= 255)
}

function ipToInt(ip: string): number {
  return ip
    .trim()
    .split('.')
    .reduce((acc, octet) => (acc << 8) + Number(octet), 0)
}

/** Returns true if `ip` falls inside `cidr` (e.g. "10.0.10.0/24"). Returns null if the CIDR itself is malformed. */
export function ipInCidr(ip: string, cidr: string): boolean | null {
  const range = parseCidr(cidr)
  if (!range) return null
  if (!isValidIpv4(ip)) return false
  return (ipToInt(ip) & range.mask) >>> 0 === (ipToInt(range.ip) & range.mask) >>> 0
}

/** "10.0.10.0/24" split and checked, or null if malformed. The prefix must be
 *  written out: "10.0.10.0/" is not /0. */
export function parseCidr(cidr: string): { ip: string; prefix: number; mask: number } | null {
  const m = /^([^/]+)\/(\d{1,2})$/.exec(cidr.trim())
  if (!m || !isValidIpv4(m[1]) || Number(m[2]) > 32) return null
  const prefix = Number(m[2])
  return { ip: m[1], prefix, mask: prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0 }
}

/** A device's "main" IP and VLAN, as the Device list shows it. The main IP is
 *  the user-designated primary port if set, else a switch's management IP
 *  (else OOB), else the first in-use port with an IP. The VLAN is that port's
 *  untagged subnet when set, otherwise the subnet whose CIDR holds the IP. */
export function mainRoute(
  d: Pick<Device, 'ports' | 'isSwitch' | 'managementIp' | 'oobIp'>,
  subnets: Pick<Subnet, 'id' | 'cidr' | 'vlan'>[]
): { ip: string; vlan: string } {
  let ip = ''
  let subnetId: number | null = null
  const chosen = d.ports.find((x) => x.isPrimary && !x.isUnused)
  if (chosen) {
    ip = chosen.ipAddress ?? ''
    subnetId = chosen.untaggedSubnetId
  } else if (d.isSwitch && (d.managementIp || d.oobIp)) {
    ip = d.managementIp || d.oobIp || '' // switch IPs aren't tied to a port subnet
  } else {
    const usable = d.ports.filter((x) => !x.isUnused)
    const p = usable.find((x) => x.ipAddress) ?? usable[0]
    if (p) {
      ip = p.ipAddress ?? ''
      subnetId = p.untaggedSubnetId
    }
  }
  // the port's assigned network is authoritative
  const assigned = subnetId != null ? subnets.find((s) => s.id === subnetId) : undefined
  const hit =
    assigned ?? (ip ? subnets.find((s) => s.cidr && ipInCidr(ip, s.cidr) === true) : undefined)
  return { ip, vlan: hit?.vlan ?? '' }
}
