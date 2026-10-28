/** How each IPC channel behaves when this computer has joined a show on another
 *  computer (the host). Pure data so the host's allow-list and the tests share it. */
export type ChannelScope = 'read' | 'write' | 'local' | 'host-only'

/** Data reads: the host answers them for joined computers. */
const READ = new Set([
  'subnets:list',
  'devices:list',
  'stickers:sheets',
  'stickers:designs',
  'crew:directory',
  'crew:assignments',
  'crew:getSchedule',
  'trucking:trucks',
  'trucking:trips',
  'software:list',
  'signals:list',
  'bundles:list',
  'cableTypes:list',
  'deviceCategories:list',
  'showLogo:get',
  'showName:get',
  'companyLogo:get',
  'companyName:get',
  'switchConfig:get',
  'configs:list',
  'orders:list',
  'labels:list',
  'orderFormats:list',
  'orderKits:list',
  'cases:list',
  'circuits:list',
  'fixtures:list',
  'lighting:get',
  'fixtureTypes:list'
])

/** Need this machine's files, dialogs or printer but read the open project's data:
 *  refused while joined until they run on the host (step 2). */
const HOST_ONLY = new Set([
  'export:run',
  'stickers:print',
  'stickers:printTest',
  'labels:print',
  'labels:printCases',
  'projector:saveCommands',
  'configs:generate',
  'configs:exportJson',
  'software:pickInstaller',
  'software:buildKit',
  'circuits:import'
])

/** Always this machine: app updates, this machine's Show Server, project switching,
 *  the Vectorworks lighting sync (it runs on the computer that has the show open). */
const LOCAL_GROUPS = ['updates:', 'server:', 'project:', 'lightingSync:']

/** Anything not listed is a write — refused while joined, so a new channel is safe by default. */
export function channelScope(channel: string): ChannelScope {
  if (READ.has(channel)) return 'read'
  if (HOST_ONLY.has(channel)) return 'host-only'
  if (LOCAL_GROUPS.some((g) => channel.startsWith(g))) return 'local'
  return 'write'
}

/** May a joined computer call this channel on the host? */
export function remoteReadable(channel: string): boolean {
  return channelScope(channel) === 'read'
}

/** "192.168.1.20:8787", "http://host.local:8787/" → "http://host.local:8787"; no port → the Show Server default, 8787. */
export function normalizeAddress(address: string): string | null {
  const a = address
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(a)) return null
  return 'http://' + (a.includes(':') ? a : `${a}:8787`)
}

/** What a read says while the host can't be reached — the header banner already says so. */
export const HOST_UNREACHABLE = 'The host computer isn’t answering. Retrying…'
