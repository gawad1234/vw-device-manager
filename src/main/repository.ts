import { dbAll, dbGet, dbRun, lastInsertRowId } from './db'
import { isValidIpv4, ipInCidr } from './ip-utils'
import type {
  Bundle,
  BundleInput,
  Cable,
  CableInput,
  Device,
  DeviceInput,
  DeviceWarning,
  Port,
  PortInput,
  SaveDeviceResult,
  SavePortResult,
  Subnet,
  SubnetInput
} from '../shared/types'

type Row = Record<string, unknown>
/** Bind values accepted for a positional `?` parameter (matches db.ts). */
type SqlValue = string | number | bigint | null | Uint8Array

function mapSubnet(row: Row): Subnet {
  return {
    id: row.id as number,
    name: row.name as string,
    cidr: row.cidr as string,
    vlan: (row.vlan as string | null) ?? null,
    gateway: (row.gateway as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string
  }
}

function mapPort(row: Row, taggedSubnetIds: number[]): Port {
  return {
    id: row.id as number,
    deviceId: row.device_id as number,
    label: row.label as string,
    ipAddress: (row.ip_address as string | null) ?? null,
    untaggedSubnetId: (row.untagged_subnet_id as number | null) ?? null,
    taggedSubnetIds,
    vwSocketKey: (row.vw_socket_key as string | null) ?? null,
    isPrimary: Boolean(row.is_primary)
  }
}

function mapDevice(row: Row, ports: Port[]): Device {
  return {
    id: row.id as number,
    name: row.name as string,
    deviceType: (row.device_type as string | null) ?? null,
    macAddress: (row.mac_address as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    isSwitch: Boolean(row.is_switch),
    managementIp: (row.management_ip as string | null) ?? null,
    oobIp: (row.oob_ip as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    ports
  }
}

function queryAll(sql: string, params: SqlValue[] = []): Row[] {
  return dbAll(sql, params) as Row[]
}

function queryOne(sql: string, params: SqlValue[] = []): Row | null {
  return (dbGet(sql, params) as Row | undefined) ?? null
}

// ---- Subnets ----------------------------------------------------------

export function listSubnets(): Subnet[] {
  return queryAll('SELECT * FROM subnets ORDER BY name COLLATE NOCASE').map(mapSubnet)
}

function getSubnetById(id: number): Subnet | null {
  const row = queryOne('SELECT * FROM subnets WHERE id = ?', [id])
  return row ? mapSubnet(row) : null
}

export function createSubnet(input: SubnetInput): Subnet {
  dbRun(
    `INSERT INTO subnets (name, cidr, vlan, gateway, notes) VALUES (?, ?, ?, ?, ?)`,
    [input.name, input.cidr, input.vlan, input.gateway, input.notes]
  )
  const id = lastInsertRowId()
  return getSubnetById(id) as Subnet
}

export function updateSubnet(id: number, input: SubnetInput): Subnet {
  dbRun(
    `UPDATE subnets SET name = ?, cidr = ?, vlan = ?, gateway = ?, notes = ? WHERE id = ?`,
    [input.name, input.cidr, input.vlan, input.gateway, input.notes, id]
  )
  return getSubnetById(id) as Subnet
}

export function deleteSubnet(id: number): void {
  // A deleted subnet is dereferenced everywhere it was used (untagged +
  // tagged), so ports don't point at a phantom network.
  dbRun('UPDATE ports SET untagged_subnet_id = NULL WHERE untagged_subnet_id = ?', [id])
  dbRun('DELETE FROM port_tagged_vlans WHERE subnet_id = ?', [id])
  dbRun('DELETE FROM subnets WHERE id = ?', [id])}

// ---- Ports --------------------------------------------------------------

function taggedForPort(portId: number): number[] {
  return queryAll('SELECT subnet_id FROM port_tagged_vlans WHERE port_id = ? ORDER BY subnet_id', [
    portId
  ]).map((t) => t.subnet_id as number)
}

function portsForDevice(deviceId: number): Port[] {
  return queryAll('SELECT * FROM ports WHERE device_id = ? ORDER BY id', [deviceId]).map((r) =>
    mapPort(r, taggedForPort(r.id as number))
  )
}

function getPortById(id: number): Port | null {
  const row = queryOne('SELECT * FROM ports WHERE id = ?', [id])
  return row ? mapPort(row, taggedForPort(id)) : null
}

/**
 * Find any OTHER place this IP is already used, for conflict detection. An IP
 * is an IP: this spans both port IPs and the device-level switch IPs
 * (management / out-of-band), so nothing can be double-assigned anywhere.
 *
 * `exclude` skips the slot being saved: `portId` skips that one port row;
 * `deviceId` skips BOTH of a device's own mgmt/OOB rows (they get rewritten
 * together, and a mgmt-vs-OOB clash within one save is checked separately).
 */
function findIpUse(
  ip: string,
  exclude?: { portId?: number; deviceId?: number }
): { label: string; deviceName: string } | null {
  const rows = queryAll(
    `SELECT 'port' AS kind, p.id AS ref_id, p.label AS label, d.name AS device_name
       FROM ports p JOIN devices d ON d.id = p.device_id
      WHERE p.ip_address = ?
     UNION ALL
     SELECT 'device', id, 'Management IP', name FROM devices WHERE management_ip = ?
     UNION ALL
     SELECT 'device', id, 'Out-of-band IP', name FROM devices WHERE oob_ip = ?`,
    [ip, ip, ip]
  )
  const hit = rows.find((r) =>
    r.kind === 'port' ? (r.ref_id as number) !== exclude?.portId : (r.ref_id as number) !== exclude?.deviceId
  )
  return hit ? { label: hit.label as string, deviceName: hit.device_name as string } : null
}

function buildPortWarnings(input: PortInput): DeviceWarning[] {
  const warnings: DeviceWarning[] = []
  if (!input.ipAddress) return warnings

  if (!isValidIpv4(input.ipAddress)) {
    warnings.push({
      type: 'invalid-ip',
      message: `"${input.ipAddress}" is not a valid IPv4 address.`
    })
    return warnings
  }

  if (input.untaggedSubnetId != null) {
    const subnet = getSubnetById(input.untaggedSubnetId)
    if (subnet && ipInCidr(input.ipAddress, subnet.cidr) === false) {
      warnings.push({
        type: 'ip-outside-subnet',
        message: `${input.ipAddress} is outside ${subnet.name}'s range (${subnet.cidr}).`
      })
    }
  }
  return warnings
}

export function createPort(deviceId: number, input: PortInput): SavePortResult {
  if (input.ipAddress) {
    const conflict = findIpUse(input.ipAddress)
    if (conflict) {
      return {
        port: null,
        warnings: [],
        error: `IP ${input.ipAddress} is already on "${conflict.deviceName}" (${conflict.label}).`
      }
    }
  }

  const warnings = buildPortWarnings(input)
  dbRun(
    `INSERT INTO ports (device_id, label, ip_address, untagged_subnet_id) VALUES (?, ?, ?, ?)`,
    [deviceId, input.label, input.ipAddress, input.untaggedSubnetId]
  )
  const id = lastInsertRowId()
  return { port: getPortById(id), warnings }
}

export function updatePort(id: number, input: PortInput): SavePortResult {
  if (input.ipAddress) {
    const conflict = findIpUse(input.ipAddress, { portId: id })
    if (conflict) {
      return {
        port: null,
        warnings: [],
        error: `IP ${input.ipAddress} is already on "${conflict.deviceName}" (${conflict.label}).`
      }
    }
  }

  const warnings = buildPortWarnings(input)
  dbRun(
    `UPDATE ports SET label = ?, ip_address = ?, untagged_subnet_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [input.label, input.ipAddress, input.untaggedSubnetId, id]
  )
  return { port: getPortById(id), warnings }
}

export function deletePort(id: number): void {
  dbRun('DELETE FROM port_tagged_vlans WHERE port_id = ?', [id])
  dbRun('DELETE FROM ports WHERE id = ?', [id])}

/** Mark this port as its device's "main" access route (or clear it). At most one
 *  port per device is primary, so the others are cleared first. Used by the
 *  Device list export to pick the device's main IP + VLAN. */
export function setPrimaryPort(portId: number, isPrimary: boolean): void {
  const row = queryOne('SELECT device_id FROM ports WHERE id = ?', [portId])
  if (!row) return
  dbRun('UPDATE ports SET is_primary = 0 WHERE device_id = ?', [row.device_id as number])
  if (isPrimary) dbRun('UPDATE ports SET is_primary = 1 WHERE id = ?', [portId])
}

/** Replace the port's tagged-VLAN set with exactly the given subnet ids. */
export function setPortTaggedVlans(portId: number, subnetIds: number[]): void {
  dbRun('DELETE FROM port_tagged_vlans WHERE port_id = ?', [portId])
  for (const subnetId of subnetIds) {
    dbRun('INSERT OR IGNORE INTO port_tagged_vlans (port_id, subnet_id) VALUES (?, ?)', [
      portId,
      subnetId
    ])
  }
}

// ---- Devices ------------------------------------------------------------

export function listDevices(): Device[] {
  return queryAll('SELECT * FROM devices ORDER BY name COLLATE NOCASE').map((r) =>
    mapDevice(r, portsForDevice(r.id as number))
  )
}

function getDeviceById(id: number): Device | null {
  const row = queryOne('SELECT * FROM devices WHERE id = ?', [id])
  return row ? mapDevice(row, portsForDevice(id)) : null
}

/** The two switch IPs, normalized: only kept when the device is a switch, and
 *  trimmed to null when blank — so toggling switch off clears them. */
function switchIps(input: DeviceInput): { mgmt: string | null; oob: string | null } {
  if (!input.isSwitch) return { mgmt: null, oob: null }
  return {
    mgmt: input.managementIp?.trim() || null,
    oob: input.oobIp?.trim() || null
  }
}

/** Validate a switch's management/OOB IPs. A duplicate (or the two being equal)
 *  is a hard error; an unparseable IP is a non-blocking warning — same
 *  conventions ports use. `excludeDeviceId` skips the device's own rows. */
function checkSwitchIps(
  mgmt: string | null,
  oob: string | null,
  excludeDeviceId: number
): { error?: string; warnings: DeviceWarning[] } {
  const warnings: DeviceWarning[] = []
  if (mgmt && oob && mgmt === oob) {
    return { warnings, error: `Management IP and Out-of-band IP can't both be ${mgmt}.` }
  }
  const slots: Array<[string | null, string]> = [
    [mgmt, 'Management IP'],
    [oob, 'Out-of-band IP']
  ]
  for (const [ip, human] of slots) {
    if (!ip) continue
    const conflict = findIpUse(ip, { deviceId: excludeDeviceId })
    if (conflict) {
      return {
        warnings,
        error: `${human} ${ip} is already on "${conflict.deviceName}" (${conflict.label}).`
      }
    }
    if (!isValidIpv4(ip)) {
      warnings.push({ type: 'invalid-ip', message: `${human} "${ip}" is not a valid IPv4 address.` })
    }
  }
  return { warnings }
}

export function createDevice(input: DeviceInput): SaveDeviceResult {
  const { mgmt, oob } = switchIps(input)
  const check = checkSwitchIps(mgmt, oob, -1) // no id yet — nothing to exclude
  if (check.error) return { device: null, warnings: [], error: check.error }

  dbRun(
    `INSERT INTO devices (name, device_type, mac_address, location, notes, category, is_switch, management_ip, oob_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.deviceType,
      input.macAddress,
      input.location,
      input.notes,
      input.category?.trim() || null,
      input.isSwitch ? 1 : 0,
      mgmt,
      oob
    ]
  )
  const id = lastInsertRowId()
  return { device: getDeviceById(id), warnings: check.warnings }
}

export function updateDevice(id: number, input: DeviceInput): SaveDeviceResult {
  const { mgmt, oob } = switchIps(input)
  const check = checkSwitchIps(mgmt, oob, id)
  if (check.error) return { device: null, warnings: [], error: check.error }

  dbRun(
    `UPDATE devices
     SET name = ?, device_type = ?, mac_address = ?, location = ?, notes = ?, category = ?,
         is_switch = ?, management_ip = ?, oob_ip = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      input.name,
      input.deviceType,
      input.macAddress,
      input.location,
      input.notes,
      input.category?.trim() || null,
      input.isSwitch ? 1 : 0,
      mgmt,
      oob,
      id
    ]
  )
  return { device: getDeviceById(id), warnings: check.warnings }
}

export function deleteDevice(id: number): void {
  dbRun(
    'DELETE FROM port_tagged_vlans WHERE port_id IN (SELECT id FROM ports WHERE device_id = ?)',
    [id]
  )
  dbRun('DELETE FROM ports WHERE device_id = ?', [id])
  dbRun('DELETE FROM devices WHERE id = ?', [id])
}

// Network signals + cable types are no longer per-project — they live in the
// shared library (see library.ts) and are wired to IPC directly there.

// ---- Cables -------------------------------------------------------------

function mapCable(row: Row): Cable {
  return {
    id: row.id as number,
    bundleId: row.bundle_id as number,
    name: row.name as string,
    cableType: (row.cable_type as string | null) ?? null,
    source: {
      deviceId: (row.source_device_id as number | null) ?? null,
      portId: (row.source_port_id as number | null) ?? null,
      text: (row.source_text as string | null) ?? null
    },
    destination: {
      deviceId: (row.dest_device_id as number | null) ?? null,
      portId: (row.dest_port_id as number | null) ?? null,
      text: (row.dest_text as string | null) ?? null
    },
    pulled: Boolean(row.pulled),
    labeled: Boolean(row.labeled),
    notes: (row.notes as string | null) ?? null
  }
}

function cablesForBundle(bundleId: number): Cable[] {
  return queryAll('SELECT * FROM cables WHERE bundle_id = ? ORDER BY id', [bundleId]).map(mapCable)
}

function getCableById(id: number): Cable | null {
  const row = queryOne('SELECT * FROM cables WHERE id = ?', [id])
  return row ? mapCable(row) : null
}

/** Flatten a CableInput into the positional column values shared by insert/update. */
function cableColumnValues(input: CableInput): SqlValue[] {
  return [
    input.name,
    input.cableType,
    input.source.deviceId,
    input.source.portId,
    input.source.text,
    input.destination.deviceId,
    input.destination.portId,
    input.destination.text,
    input.pulled ? 1 : 0,
    input.labeled ? 1 : 0,
    input.notes
  ]
}

export function createCable(bundleId: number, input: CableInput): Cable {
  dbRun(
    `INSERT INTO cables
       (bundle_id, name, cable_type,
        source_device_id, source_port_id, source_text,
        dest_device_id, dest_port_id, dest_text, pulled, labeled, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [bundleId, ...cableColumnValues(input)]
  )
  const id = lastInsertRowId()
  return getCableById(id) as Cable
}

export function updateCable(id: number, input: CableInput): Cable {
  dbRun(
    `UPDATE cables SET
       name = ?, cable_type = ?,
       source_device_id = ?, source_port_id = ?, source_text = ?,
       dest_device_id = ?, dest_port_id = ?, dest_text = ?,
       pulled = ?, labeled = ?, notes = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    [...cableColumnValues(input), id]
  )
  return getCableById(id) as Cable
}

export function deleteCable(id: number): void {
  dbRun('DELETE FROM cables WHERE id = ?', [id])}

// ---- Bundles ------------------------------------------------------------

function mapBundle(row: Row, cables: Cable[]): Bundle {
  return {
    id: row.id as number,
    name: row.name as string,
    color: (row.color as string | null) ?? null,
    fromLocation: (row.from_location as string | null) ?? null,
    toLocation: (row.to_location as string | null) ?? null,
    length: (row.length as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    cables
  }
}

export function listBundles(): Bundle[] {
  return queryAll('SELECT * FROM bundles ORDER BY name COLLATE NOCASE').map((r) =>
    mapBundle(r, cablesForBundle(r.id as number))
  )
}

function getBundleById(id: number): Bundle | null {
  const row = queryOne('SELECT * FROM bundles WHERE id = ?', [id])
  return row ? mapBundle(row, cablesForBundle(id)) : null
}

export function createBundle(input: BundleInput): Bundle {
  dbRun(
    `INSERT INTO bundles (name, color, from_location, to_location, length, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.name, input.color, input.fromLocation, input.toLocation, input.length, input.notes]
  )
  const id = lastInsertRowId()
  return getBundleById(id) as Bundle
}

export function updateBundle(id: number, input: BundleInput): Bundle {
  dbRun(
    `UPDATE bundles
       SET name = ?, color = ?, from_location = ?, to_location = ?, length = ?, notes = ?,
           updated_at = datetime('now')
     WHERE id = ?`,
    [input.name, input.color, input.fromLocation, input.toLocation, input.length, input.notes, id]
  )
  return getBundleById(id) as Bundle
}

export function deleteBundle(id: number): void {
  dbRun('DELETE FROM cables WHERE bundle_id = ?', [id])
  dbRun('DELETE FROM bundles WHERE id = ?', [id])
}

// ---- Project meta (per-show settings, e.g. logo) ------------------------

export function getProjectMeta(key: string): string | null {
  const row = queryOne('SELECT value FROM project_meta WHERE key = ?', [key])
  return row ? ((row.value as string | null) ?? null) : null
}

export function setProjectMeta(key: string, value: string | null): void {
  if (value == null) {
    dbRun('DELETE FROM project_meta WHERE key = ?', [key])
  } else {
    dbRun(
      'INSERT INTO project_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    )
  }
}
