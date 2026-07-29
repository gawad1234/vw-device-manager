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
  const [rangeIp, prefixStr] = cidr.trim().split('/')
  const prefix = Number(prefixStr)
  if (!rangeIp || !isValidIpv4(rangeIp) || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    return null
  }
  if (!isValidIpv4(ip)) return false

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  return (ipToInt(ip) & mask) >>> 0 === (ipToInt(rangeIp) & mask) >>> 0
}
