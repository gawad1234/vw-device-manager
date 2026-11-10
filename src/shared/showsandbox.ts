// Turns a ShowSandbox show file (`showsandbox-show/1`, the JSON ShowSandbox saves
// in ~/Library/Application Support/ShowSandbox/shows/) into what this app stores.
// Pure: no DB. main/showsandbox-import.ts writes the plan.
//
// Names are the join key with the drawing: a device is named by its ShowSandbox
// ident (SW1, CON1) or else its label, and a port by its jack label, because the
// VW Link script adopts an existing device by name and a hand-added port by label.

export interface PlanSubnet {
  name: string
  cidr: string
  vlan: string | null
}

export interface PlanPort {
  label: string
  ip: string | null
}

export interface PlanDevice {
  name: string
  deviceType: string | null
  location: string | null
  isSwitch: boolean
  ports: PlanPort[]
}

export interface PlanEnd {
  device: string
  /** set when the jack is a network port this plan creates */
  port: string | null
  /** the jack's label, kept for the cable notes when it isn't a network port */
  socket: string
}

export interface PlanCable {
  name: string
  cableType: string | null
  bundle: string
  from: PlanEnd
  to: PlanEnd
  notes: string | null
}

/** One row for the Patching page — the same fields a ConnectCAD circuit report gives
 *  (repository CircuitImport), so it merges into the same circuits table. */
export interface PlanCircuit {
  cableNumber: string
  signal: string
  estLength: string
  srcName: string
  srcSocket: string
  srcConnector: string
  srcRack: string
  srcRackU: string
  srcSlot: string
  dstName: string
  dstSocket: string
  dstConnector: string
  dstRack: string
  dstRackU: string
  dstSlot: string
}

export interface ShowPlan {
  showName: string
  subnets: PlanSubnet[]
  devices: PlanDevice[]
  cables: PlanCable[]
  circuits: PlanCircuit[]
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const NETWORK_CONNECTORS = new Set(['rj45', 'ethercon'])

interface DefPort {
  id: string
  label: string
  connector: string
  /** in | out | io */
  direction: string
}

/** ShowSandbox's library expandPorts(): a template port ({n} / {c}) becomes N ports. */
function expandPorts(def: Json): DefPort[] {
  const out: DefPort[] = []
  const add = (p: Json, subs: Record<string, string>): void => {
    const fill = (s: string): string =>
      Object.entries(subs).reduce((acc, [tok, rep]) => acc.split(tok).join(rep), s)
    const id = fill(str(p.id))
    out.push({
      id,
      label: fill(str(p.label)) || id,
      connector: str(p.connector),
      direction: str(p.direction)
    })
  }
  for (const raw of Array.isArray(def.ports) ? def.ports : []) {
    const p = obj(raw)
    if (!p.template) add(p, {})
    else if (typeof p.count === 'number')
      for (let n = 1; n <= p.count; n++) add(p, { '{n}': String(n) })
    else if (Array.isArray(p.range))
      for (const c of p.range) add(p, { '{c}': String(c), '{C}': String(c).toUpperCase() })
  }
  return out
}

export function planShowImport(raw: unknown): ShowPlan {
  const show = obj(raw)
  if (!str(show.schema).startsWith('showsandbox-show/')) {
    throw new Error('This is not a ShowSandbox show file.')
  }
  const meta = obj(show.meta)
  const library = obj(show.library_snapshot)
  const positions = new Map(
    (Array.isArray(show.positions) ? show.positions : []).map((p) => [
      str(obj(p).id),
      str(obj(p).label)
    ])
  )

  // ---- subnets: only the per-show overrides. ShowSandbox's built-in defaults
  // shortcut: shipped default IP scheme isn't copied; IPs on those subnets land with no VLAN — copy ipplan.js DEFAULT_IP_SCHEME here if that bites.
  const vlans = obj(meta.vlans)
  const subnets: PlanSubnet[] = Object.entries(obj(meta.ip_scheme)).flatMap(([name, v]) => {
    const s = obj(v)
    const base = str(s.subnet)
    if (!base) return []
    const tag = obj(vlans[name]).tag
    return [
      {
        name,
        cidr: `${base}/${Number(s.mask) || 24}`,
        vlan: tag != null && tag !== '' ? String(tag) : null
      }
    ]
  })

  // ---- devices
  const used = new Map<string, number>()
  const byUid = new Map<
    string,
    {
      name: string
      location: string | null
      rackU: string
      ports: Map<string, DefPort>
      net: Set<string>
    }
  >()
  const devices: PlanDevice[] = []
  for (const rawDev of Array.isArray(show.devices) ? show.devices : []) {
    const d = obj(rawDev)
    const def = obj(library[str(d.device_id)])
    const base = str(d.ident) || str(d.label) || str(def.name) || 'Device'
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    const name = seen ? `${base} (${seen + 1})` : base // two "Generic Amp"s stay two devices
    const location = str(d.rack) || positions.get(str(d.position)) || null
    const ips = obj(d.ips)
    const ports = new Map(expandPorts(def).map((p) => [p.id, p]))
    const net = new Set(
      [...ports.values()]
        .filter((p) => NETWORK_CONNECTORS.has(p.connector.toLowerCase()) || str(ips[p.id]))
        .map((p) => p.id)
    )
    const isSwitch = /switch/i.test(str(def.category))
    const rackU = Number(d.rack_u) > 0 ? String(d.rack_u) : '' // 0 = racked, U not set
    byUid.set(str(d.uid), { name, location, rackU, ports, net })
    devices.push({
      name,
      // "Generic" + "Generic Amp" stays "Generic Amp"
      deviceType:
        (str(def.name).startsWith(str(def.manufacturer))
          ? str(def.name)
          : `${str(def.manufacturer)} ${str(def.name)}`.trim()) || null,
      location,
      isSwitch,
      // a switch's ports are VLAN-only in this app, so its port IPs aren't carried
      ports: [...net].map((id) => ({
        label: ports.get(id)!.label,
        ip: isSwitch ? null : str(ips[id]) || null
      }))
    })
  }

  // ---- cables + circuits
  const jackets = new Map(
    (Array.isArray(show.multicores) ? show.multicores : []).map((m) => [str(obj(m).id), obj(m)])
  )
  const cables: PlanCable[] = []
  const circuits: PlanCircuit[] = []
  for (const rawConn of Array.isArray(show.connections) ? show.connections : []) {
    const c = obj(rawConn)
    const end = (
      e: unknown
    ): {
      device: string
      port: string | null
      socket: string
      location: string | null
      rackU: string
      connector: string
      direction: string
    } | null => {
      const dev = byUid.get(str(obj(e).device))
      if (!dev) return null
      const pid = str(obj(e).port)
      const def = dev.ports.get(pid)
      const socket = def?.label || pid
      return {
        device: dev.name,
        port: dev.net.has(pid) ? socket : null,
        socket,
        location: dev.location,
        rackU: dev.rackU,
        connector: def?.connector ?? '',
        direction: def?.direction ?? ''
      }
    }
    let a = end(c.from)
    let b = end(c.to)
    if (!a || !b) continue
    // ShowSandbox lets you draw a cable either way round; the patch sheet wants
    // source = the output. Only flip when both ends say so (io/blank stays as drawn).
    if (a.direction === 'in' && b.direction === 'out') [a, b] = [b, a]
    // ShowSandbox's derived loom (looms.js loomNameFor) for a run between two places;
    // a run inside one place has no loom there, but every cable here needs a bundle.
    const places = [a.location, b.location].filter(Boolean).sort((x, y) => x!.localeCompare(y!))
    const bundle =
      str(c.bundle) ||
      (places.length === 2 && places[0] !== places[1]
        ? `${places[0]}-${places[1]} LOOM`.toUpperCase()
        : `${places[0] ?? 'UNPLACED'} INBOARD`.toUpperCase())
    const sockets = [!a.port && `From: ${a.socket}`, !b.port && `To: ${b.socket}`].filter(Boolean)
    const notes = [str(c.notes), sockets.join(' · ')].filter(Boolean).join('\n') || null
    cables.push({
      // an unnamed cable is named by its two jacks, so two unnamed runs between the same devices stay two
      name: str(c.cable_name) || `${a.device} ${a.socket} → ${b.device} ${b.socket}`,
      cableType: str(c.cable_type) || null,
      bundle,
      from: { device: a.device, port: a.port, socket: a.socket },
      to: { device: b.device, port: b.port, socket: b.socket },
      notes
    })
    // A core's length is its jacket's (ShowSandbox cablemodel.cableLength).
    // shortcut: only hand-set lengths carry over, not ShowSandbox's position-distance estimate — port distanceM() if the Patching page needs them.
    const jacket = jackets.get(str(c.multicore))
    const lengthM = Number.isFinite(jacket?.length_m) ? jacket!.length_m : c.length_m
    circuits.push({
      cableNumber: str(c.cable_name),
      signal: str(c.signal_type),
      estLength: Number.isFinite(lengthM) ? `${lengthM} m` : '',
      srcName: a.device,
      srcSocket: a.socket,
      srcConnector: a.connector,
      srcRack: a.location ?? '',
      srcRackU: a.rackU,
      srcSlot: '', // shortcut: card slots (ShowSandbox cards.js) not mapped — add if patch sheets need them
      dstName: b.device,
      dstSocket: b.socket,
      dstConnector: b.connector,
      dstRack: b.location ?? '',
      dstRackU: b.rackU,
      dstSlot: ''
    })
  }

  return { showName: str(meta.name), subnets, devices, cables, circuits }
}
