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
