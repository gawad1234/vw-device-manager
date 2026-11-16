import { execFile } from 'node:child_process'
import { isValidIpv4 } from '../shared/ip-utils'

/** One ping, ~1 s wait, per platform's flags. */
export function pingArgs(ip: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') return ['-n', '1', '-w', '1000', ip]
  if (platform === 'darwin') return ['-c', '1', '-t', '1', ip]
  return ['-c', '1', '-W', '1', ip]
}

/** Run `fn` over `items`, at most `limit` at a time; results keep input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

function ping(ip: string): Promise<boolean> {
  // no shell; ip already validated. Windows ping exits 0 on "unreachable" replies, so check for TTL.
  return new Promise((resolve) =>
    execFile('ping', pingArgs(ip), { timeout: 3000, windowsHide: true }, (err, stdout) =>
      resolve(!err && (process.platform !== 'win32' || /ttl=/i.test(stdout)))
    )
  )
}

/** Which of these IPv4 addresses answer a ping. Anything that isn't a plain IPv4 is false, untried. */
export async function checkHosts(
  ips: string[],
  run: (ip: string) => Promise<boolean> = ping
): Promise<Record<string, boolean>> {
  const unique = [...new Set(ips.map((ip) => String(ip).trim()))]
  // ping reads "010" as octal, so ping 192.168.1.50 for "192.168.001.050"; results stay keyed by the original
  const results = await mapLimit(unique, 16, (ip) =>
    isValidIpv4(ip) ? run(ip.split('.').map(Number).join('.')) : Promise.resolve(false)
  )
  return Object.fromEntries(unique.map((ip, i) => [ip, results[i]]))
}

let sweep: { key: string; result: Promise<Record<string, boolean>> } | null = null

/** checkHosts, but a sweep for the same list that's still running is shared instead of started again. */
export function checkHostsOnce(
  ips: string[],
  run?: (ip: string) => Promise<boolean>
): Promise<Record<string, boolean>> {
  const key = ips.join('\n')
  if (sweep?.key === key) return sweep.result
  const current = { key, result: checkHosts(ips, run) }
  sweep = current
  const clear = (): void => {
    if (sweep === current) sweep = null
  }
  current.result.then(clear, clear)
  return current.result
}
