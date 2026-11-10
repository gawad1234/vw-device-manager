import {
  listBundles,
  listCasesByIds,
  listCircuits,
  listDevices,
  listFixtures,
  listSubnets,
  listTruckTrips
} from './repository'
import { mainRoute } from '../shared/ip-utils'
import { isAccessory } from '../shared/lighting-checks'
import type { Bundle, CableEndpoint, PackCase } from '../shared/types'
import type {
  CableRec,
  CaseRec,
  DeviceRec,
  PaperworkSource,
  PatchRec,
  PortRec,
  SwitchPortRec
} from '../shared/paperwork'

// The rows each Paperwork source lists, read from the open project. Plain records:
// the shared builder (src/shared/paperwork.ts) turns them into tables.

// ---- Endpoint resolution -------------------------------------------------
// A cable endpoint is a device (+ optional port) or free text. Resolve it to a
// readable string using the current device list.
export type DeviceIndex = Map<number, { name: string; ports: Map<number, string> }>

export function buildDeviceIndex(): DeviceIndex {
  const idx: DeviceIndex = new Map()
  for (const d of listDevices()) {
    idx.set(d.id, { name: d.name, ports: new Map(d.ports.map((p) => [p.id, p.label])) })
  }
  return idx
}

export function resolveEndpoint(ep: CableEndpoint, idx: DeviceIndex): string {
  if (ep.deviceId != null) {
    const dev = idx.get(ep.deviceId)
    if (dev) {
      const port = ep.portId != null ? dev.ports.get(ep.portId) : undefined
      return port ? `${dev.name} · ${port}` : dev.name
    }
  }
  return ep.text?.trim() || '—'
}

interface DeviceEntry {
  name: string
  category: string // '' = uncategorized
  type: string
  location: string
  vlan: string
  ip: string
}

/** One entry per device: name, category, location, and its "main" VLAN + IP.
 *  The main IP is the user-designated primary port if set, else a switch's
 *  management IP (else OOB), else the first port with an IP. The main VLAN is
 *  that IP's VLAN — the port's untagged subnet when set, otherwise matched by
 *  CIDR. Sorted by category (uncategorized last), then device name. */
export function deviceListEntries(): DeviceEntry[] {
  const subnets = listSubnets()
  const catSortKey = (c: string): string => (c ? c.toLowerCase() : '￿') // uncategorized last

  return listDevices()
    .map((d) => {
      const { ip, vlan } = mainRoute(d, subnets)
      return {
        name: d.name,
        category: d.category?.trim() || '',
        type: d.deviceType ?? '',
        location: d.location ?? '',
        vlan,
        ip
      }
    })
    .sort(
      (a, b) =>
        catSortKey(a.category).localeCompare(catSortKey(b.category)) || a.name.localeCompare(b.name)
    )
}

export const TRIP_KIND_LABEL: Record<string, string> = {
  delivery: 'Delivery',
  'load-in': 'Load-in',
  'load-out': 'Load-out',
  return: 'Return',
  other: 'Trip'
}

/** A case's description: its "Description" field if it has one, else its other fields
 *  (minus any "Truck" field — on a load sheet the truck is the page itself). */
export function caseDescription(c: PackCase): string {
  const desc = c.fields.find((f) => /desc/i.test(f.label) && f.value.trim())
  if (desc) return desc.value
  return c.fields
    .filter((f) => f.value.trim() && !/truck/i.test(f.label))
    .map((f) => `${f.label}: ${f.value}`)
    .join(' · ')
}

export function cableRecords(bundles: Bundle[] = listBundles()): CableRec[] {
  const idx = buildDeviceIndex()
  return bundles.flatMap((b) =>
    b.cables.map((c) => ({
      bundle: b.name,
      bundleColor: b.color || '#cccccc',
      bundleFrom: b.fromLocation ?? '',
      bundleTo: b.toLocation ?? '',
      cable: c.name,
      type: c.cableType ?? '',
      from: resolveEndpoint(c.source, idx),
      to: resolveEndpoint(c.destination, idx),
      length: b.length ?? '',
      pulled: c.pulled,
      labeled: c.labeled,
      notes: c.notes ?? ''
    }))
  )
}

/** Used jacks of every device, split into switch ports and other devices' ports
 *  (a device with none gets one '—' row so it still appears). */
function portRecords(): { ports: PortRec[]; switchPorts: SwitchPortRec[] } {
  const subnets = new Map(listSubnets().map((s) => [s.id, s]))
  const vlanLabel = (id: number | null): string => {
    const s = id != null ? subnets.get(id) : undefined
    if (!s) return ''
    return s.vlan ? `VLAN ${s.vlan}${s.name ? ` (${s.name})` : ''}` : s.name
  }
  const ports: PortRec[] = []
  const switchPorts: SwitchPortRec[] = []
  for (const d of listDevices()) {
    const used = d.ports.filter((p) => !p.isUnused) // jacks flagged "not needed" stay off schedules
    if (d.isSwitch) {
      const base = {
        switch: d.name,
        mgmtIp: d.managementIp || '—',
        oobIp: d.oobIp || '—',
        location: d.location ?? ''
      }
      for (const p of used.length ? used : [null])
        switchPorts.push({
          ...base,
          port: p ? p.label : '—',
          vlan:
            (p && p.untaggedSubnetId != null ? subnets.get(p.untaggedSubnetId)?.vlan : '') ?? '',
          nativeVlan: p ? vlanLabel(p.untaggedSubnetId) : '',
          taggedVlans: p ? p.taggedSubnetIds.map(vlanLabel).filter(Boolean).join(', ') : ''
        })
      continue
    }
    const base = {
      device: d.name,
      mac: d.macAddress ?? '',
      type: d.deviceType ?? '',
      location: d.location ?? '',
      category: d.category?.trim() || ''
    }
    for (const p of used.length ? used : [null]) {
      const s = p && p.untaggedSubnetId != null ? subnets.get(p.untaggedSubnetId) : undefined
      ports.push({
        ...base,
        port: p ? p.label : '—',
        ip: p?.ipAddress ?? '',
        network: s?.name ?? '',
        vlan: s?.vlan ?? ''
      })
    }
  }
  return { ports, switchPorts }
}

/** Cases on truck trips (one trip, or all). */
export function caseRecords(tripId?: number): CaseRec[] {
  return listTruckTrips()
    .filter((t) => tripId == null || t.id === tripId)
    .flatMap((t) =>
      listCasesByIds(t.caseIds).map((c) => ({
        tripId: t.id,
        trip: `${TRIP_KIND_LABEL[t.kind] ?? 'Trip'} ${t.date}`.trim(),
        name: c.name,
        description: caseDescription(c),
        contents: c.contents,
        fields: Object.fromEntries(c.fields.map((f) => [f.label, f.value]))
      }))
    )
}

/** Every circuit end in the Patching tab, one per device at that end. */
export function patchRecords(): PatchRec[] {
  return listCircuits().flatMap((c) => {
    const base = {
      srcDevice: c.srcName,
      srcSocket: c.srcSocket,
      dstDevice: c.dstName,
      dstSocket: c.dstSocket,
      signal: c.signal,
      cable: c.cableNumber,
      tested: c.tested,
      notes: c.notes ?? ''
    }
    const rack = (r: string, u: string, slot: string): string =>
      [r, u && `U${u}`, slot && `slot ${slot}`].filter(Boolean).join(' · ')
    const out: PatchRec[] = []
    if (c.srcName)
      out.push({
        ...base,
        device: c.srcName,
        direction: 'Outputs',
        socket: c.srcSocket,
        connector: c.srcConnector,
        rack: rack(c.srcRack, c.srcRackU, c.srcSlot),
        patched: c.srcPatched
      })
    if (c.dstName)
      out.push({
        ...base,
        device: c.dstName,
        direction: 'Inputs',
        socket: c.dstSocket,
        connector: c.dstConnector,
        rack: rack(c.dstRack, c.dstRackU, c.dstSlot),
        patched: c.dstPatched
      })
    return out
  })
}

/** The devices that have patch connections, in name order. */
export function patchDevices(recs = patchRecords()): string[] {
  return [...new Set(recs.map((r) => r.device))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  )
}

/** Every record a source lists in the open project (cables: the given bundles, or all).
 *  Patch connections are per device: the Paperwork preview shows the first device. */
export function recordsFor(source: PaperworkSource, bundles?: Bundle[]): object[] {
  switch (source) {
    case 'cables':
      return cableRecords(bundles)
    case 'devices':
      return deviceListEntries() satisfies DeviceRec[]
    case 'ports':
      return portRecords().ports
    case 'switchPorts':
      return portRecords().switchPorts
    case 'cases':
      return caseRecords()
    case 'fixtures':
      return listFixtures().filter((f) => !isAccessory(f))
    case 'patch': {
      const recs = patchRecords()
      const first = patchDevices(recs)[0]
      return recs.filter((r) => r.device === first)
    }
  }
}
