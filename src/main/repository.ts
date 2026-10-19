import { dbAll, dbGet, dbRun, lastInsertRowId } from './db'
import { isValidIpv4, ipInCidr } from './ip-utils'
import type {
  Bundle,
  BundleInput,
  Cable,
  CableInput,
  CableOrderItem,
  Device,
  DeviceInput,
  DeviceWarning,
  HostConfig,
  HostConfigInput,
  LabelElement,
  LabelField,
  LabelTemplate,
  LabelTemplateInput,
  Circuit,
  CircuitStatusInput,
  CircuitImportResult,
  OrderColumn,
  OrderExportFormat,
  OrderExportFormatInput,
  OrderItem,
  PackCase,
  PackCaseInput,
  CaseField,
  Port,
  PortInput,
  SaveDeviceResult,
  SavePortResult,
  ShopOrder,
  ShopOrderInput,
  Subnet,
  SubnetInput,
  VlanEntry
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
    isPrimary: Boolean(row.is_primary),
    isUnused: Boolean(row.is_unused),
    lagGroup: (row.lag_group as string | null) ?? null
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
  if (isPrimary) dbRun('UPDATE ports SET is_primary = 1, is_unused = 0 WHERE id = ?', [portId])
}

/** Flag a jack as not used for the network (hidden from schedules/labels/sync),
 *  or restore it. Marking a port unused also clears its "main" flag. */
export function setPortUnused(portId: number, isUnused: boolean): void {
  if (isUnused) dbRun('UPDATE ports SET is_unused = 1, is_primary = 0 WHERE id = ?', [portId])
  else dbRun('UPDATE ports SET is_unused = 0 WHERE id = ?', [portId])
}

/** Set (or clear, with null) the free-text LAG name grouping switch ports into one link. */
export function setPortLag(portId: number, lagGroup: string | null): void {
  dbRun('UPDATE ports SET lag_group = ? WHERE id = ?', [lagGroup?.trim() || null, portId])
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

export function getDeviceById(id: number): Device | null {
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

/** Copy a bundle and all its cables into a new "(copy)" bundle. The copy's
 *  cables start with a fresh checklist (pulled/labeled reset). Returns the new
 *  bundle, or null if the source is gone. */
export function duplicateBundle(id: number): Bundle | null {
  const src = getBundleById(id)
  if (!src) return null
  dbRun(
    `INSERT INTO bundles (name, color, from_location, to_location, length, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`${src.name} (copy)`, src.color, src.fromLocation, src.toLocation, src.length, src.notes]
  )
  const newId = lastInsertRowId()
  for (const c of src.cables) {
    createCable(newId, {
      name: c.name,
      cableType: c.cableType,
      source: c.source,
      destination: c.destination,
      pulled: false,
      labeled: false,
      notes: c.notes
    })
  }
  return getBundleById(newId)
}

// ---- Project meta (per-show settings, e.g. logo) ------------------------

// ---- Host VLAN configs --------------------------------------------------

function mapHostConfig(row: Row): HostConfig {
  let vlans: VlanEntry[] = []
  try {
    vlans = JSON.parse((row.vlans_json as string) || '[]') as VlanEntry[]
  } catch {
    vlans = []
  }
  return {
    id: row.id as number,
    name: row.name as string,
    switchName: (row.switch_name as string) || 'VLAN-Trunk',
    vlans,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function listHostConfigs(): HostConfig[] {
  return queryAll('SELECT * FROM host_configs ORDER BY name COLLATE NOCASE').map(mapHostConfig)
}

export function getHostConfigById(id: number): HostConfig | null {
  const row = queryOne('SELECT * FROM host_configs WHERE id = ?', [id])
  return row ? mapHostConfig(row) : null
}

export function createHostConfig(input: HostConfigInput): HostConfig {
  dbRun('INSERT INTO host_configs (name, switch_name, vlans_json) VALUES (?, ?, ?)', [
    input.name,
    input.switchName,
    JSON.stringify(input.vlans)
  ])
  return getHostConfigById(lastInsertRowId()) as HostConfig
}

export function updateHostConfig(id: number, input: HostConfigInput): HostConfig {
  dbRun(
    `UPDATE host_configs SET name = ?, switch_name = ?, vlans_json = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [input.name, input.switchName, JSON.stringify(input.vlans), id]
  )
  return getHostConfigById(id) as HostConfig
}

export function deleteHostConfig(id: number): void {
  dbRun('DELETE FROM host_configs WHERE id = ?', [id])
}

// ---- Shop orders --------------------------------------------------------

function mapShopOrder(row: Row): ShopOrder {
  let items: OrderItem[] = []
  let cables: CableOrderItem[] = []
  try {
    items = JSON.parse((row.items_json as string) || '[]') as OrderItem[]
  } catch {
    items = []
  }
  try {
    cables = JSON.parse((row.cables_json as string) || '[]') as CableOrderItem[]
  } catch {
    cables = []
  }
  return {
    id: row.id as number,
    name: row.name as string,
    vendor: (row.vendor as string | null) ?? null,
    orderDate: (row.order_date as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    items,
    cables,
    lastExportAt: (row.last_export_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function listShopOrders(): ShopOrder[] {
  return queryAll('SELECT * FROM shop_orders ORDER BY created_at DESC').map(mapShopOrder)
}

export function getShopOrderById(id: number): ShopOrder | null {
  const row = queryOne('SELECT * FROM shop_orders WHERE id = ?', [id])
  return row ? mapShopOrder(row) : null
}

export function createShopOrder(input: ShopOrderInput): ShopOrder {
  dbRun(
    'INSERT INTO shop_orders (name, vendor, order_date, notes, items_json, cables_json) VALUES (?, ?, ?, ?, ?, ?)',
    [
      input.name,
      input.vendor,
      input.orderDate,
      input.notes,
      JSON.stringify(input.items),
      JSON.stringify(input.cables ?? [])
    ]
  )
  return getShopOrderById(lastInsertRowId()) as ShopOrder
}

export function updateShopOrder(id: number, input: ShopOrderInput): ShopOrder {
  dbRun(
    `UPDATE shop_orders SET name = ?, vendor = ?, order_date = ?, notes = ?, items_json = ?,
       cables_json = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      input.name,
      input.vendor,
      input.orderDate,
      input.notes,
      JSON.stringify(input.items),
      JSON.stringify(input.cables ?? []),
      id
    ]
  )
  return getShopOrderById(id) as ShopOrder
}

export function deleteShopOrder(id: number): void {
  dbRun('DELETE FROM shop_orders WHERE id = ?', [id])
}

/** The item list as it was at the last export (the change-highlight baseline). */
export function getOrderExportSnapshot(id: number): OrderItem[] | null {
  const row = queryOne('SELECT last_export_json FROM shop_orders WHERE id = ?', [id])
  if (!row || row.last_export_json == null) return null
  try {
    return JSON.parse(row.last_export_json as string) as OrderItem[]
  } catch {
    return null
  }
}

/** Record that the order was just exported: snapshot its items + stamp the time. */
export function markOrderExported(id: number, items: OrderItem[]): void {
  dbRun(
    "UPDATE shop_orders SET last_export_json = ?, last_export_at = datetime('now') WHERE id = ?",
    [JSON.stringify(items), id]
  )
}

// ---- Case label templates -----------------------------------------------

function mapLabelTemplate(row: Row): LabelTemplate {
  let fields: LabelField[] = []
  let elements: LabelElement[] = []
  try {
    fields = JSON.parse((row.fields_json as string) || '[]') as LabelField[]
  } catch {
    fields = []
  }
  try {
    elements = JSON.parse((row.elements_json as string) || '[]') as LabelElement[]
  } catch {
    elements = []
  }
  return {
    id: row.id as number,
    name: row.name as string,
    title: (row.title as string | null) ?? '',
    color: (row.color as string | null) ?? null,
    showName: Boolean(row.show_name),
    fields,
    elements,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function listLabelTemplates(): LabelTemplate[] {
  return queryAll('SELECT * FROM label_templates ORDER BY name COLLATE NOCASE').map(mapLabelTemplate)
}

export function getLabelTemplateById(id: number): LabelTemplate | null {
  const row = queryOne('SELECT * FROM label_templates WHERE id = ?', [id])
  return row ? mapLabelTemplate(row) : null
}

export function createLabelTemplate(input: LabelTemplateInput): LabelTemplate {
  dbRun(
    'INSERT INTO label_templates (name, title, color, show_name, fields_json, elements_json) VALUES (?, ?, ?, ?, ?, ?)',
    [
      input.name,
      input.title,
      input.color,
      input.showName ? 1 : 0,
      JSON.stringify(input.fields),
      JSON.stringify(input.elements ?? [])
    ]
  )
  return getLabelTemplateById(lastInsertRowId()) as LabelTemplate
}

export function updateLabelTemplate(id: number, input: LabelTemplateInput): LabelTemplate {
  dbRun(
    `UPDATE label_templates SET name = ?, title = ?, color = ?, show_name = ?, fields_json = ?,
       elements_json = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      input.name,
      input.title,
      input.color,
      input.showName ? 1 : 0,
      JSON.stringify(input.fields),
      JSON.stringify(input.elements ?? []),
      id
    ]
  )
  return getLabelTemplateById(id) as LabelTemplate
}

export function deleteLabelTemplate(id: number): void {
  dbRun('DELETE FROM label_templates WHERE id = ?', [id])
}

function mapCase(row: Row): PackCase {
  let fields: CaseField[] = []
  try {
    fields = JSON.parse((row.fields_json as string) || '[]') as CaseField[]
  } catch {
    fields = []
  }
  return {
    id: row.id as number,
    name: row.name as string,
    fields,
    contents: (row.contents as string | null) ?? '',
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function listCases(): PackCase[] {
  return queryAll('SELECT * FROM cases ORDER BY name COLLATE NOCASE').map(mapCase)
}

export function getCaseById(id: number): PackCase | null {
  const row = queryOne('SELECT * FROM cases WHERE id = ?', [id])
  return row ? mapCase(row) : null
}

export function listCasesByIds(ids: number[]): PackCase[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(', ')
  const rows = queryAll(`SELECT * FROM cases WHERE id IN (${placeholders})`, ids).map(mapCase)
  // preserve the caller's order
  const byId = new Map(rows.map((c) => [c.id, c]))
  return ids.map((id) => byId.get(id)).filter((c): c is PackCase => c != null)
}

export function createCase(input: PackCaseInput): PackCase {
  dbRun('INSERT INTO cases (name, fields_json, contents, notes) VALUES (?, ?, ?, ?)', [
    input.name,
    JSON.stringify(input.fields),
    input.contents,
    input.notes
  ])
  return getCaseById(lastInsertRowId()) as PackCase
}

export function updateCase(id: number, input: PackCaseInput): PackCase {
  dbRun(
    `UPDATE cases SET name = ?, fields_json = ?, contents = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [input.name, JSON.stringify(input.fields), input.contents, input.notes, id]
  )
  return getCaseById(id) as PackCase
}

export function deleteCase(id: number): void {
  dbRun('DELETE FROM cases WHERE id = ?', [id])
}

function mapOrderExportFormat(row: Row): OrderExportFormat {
  let columns: OrderColumn[] = []
  try {
    columns = JSON.parse((row.columns_json as string) || '[]') as OrderColumn[]
  } catch {
    columns = []
  }
  return {
    id: row.id as number,
    name: row.name as string,
    columns,
    groupByCategory: Boolean(row.group_by_category),
    sort: (row.sort as OrderExportFormat['sort']) ?? 'category',
    orientation: (row.orientation as OrderExportFormat['orientation']) ?? 'portrait',
    density: (row.density as OrderExportFormat['density']) ?? 'normal',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function listOrderExportFormats(): OrderExportFormat[] {
  return queryAll('SELECT * FROM order_export_formats ORDER BY name COLLATE NOCASE').map(
    mapOrderExportFormat
  )
}

export function getOrderExportFormatById(id: number): OrderExportFormat | null {
  const row = queryOne('SELECT * FROM order_export_formats WHERE id = ?', [id])
  return row ? mapOrderExportFormat(row) : null
}

export function createOrderExportFormat(input: OrderExportFormatInput): OrderExportFormat {
  dbRun(
    `INSERT INTO order_export_formats (name, columns_json, group_by_category, sort, orientation, density)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      JSON.stringify(input.columns),
      input.groupByCategory ? 1 : 0,
      input.sort,
      input.orientation,
      input.density
    ]
  )
  return getOrderExportFormatById(lastInsertRowId()) as OrderExportFormat
}

export function updateOrderExportFormat(
  id: number,
  input: OrderExportFormatInput
): OrderExportFormat {
  dbRun(
    `UPDATE order_export_formats SET name = ?, columns_json = ?, group_by_category = ?, sort = ?,
       orientation = ?, density = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      input.name,
      JSON.stringify(input.columns),
      input.groupByCategory ? 1 : 0,
      input.sort,
      input.orientation,
      input.density,
      id
    ]
  )
  return getOrderExportFormatById(id) as OrderExportFormat
}

export function deleteOrderExportFormat(id: number): void {
  dbRun('DELETE FROM order_export_formats WHERE id = ?', [id])
}

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

// ---- Patching (circuits) --------------------------------------------------

/** All report fields of a circuit (no status / id / timestamps) — the shape the
 *  importer passes to mergeCircuits. */
export type CircuitImport = Omit<
  Circuit,
  'id' | 'srcPatched' | 'dstPatched' | 'tested' | 'notes' | 'createdAt' | 'updatedAt'
>

/** Stable physical-connection identity, used to merge on re-import. */
export function circuitKey(c: Pick<CircuitImport, 'srcName' | 'srcSocket' | 'dstName' | 'dstSocket'>): string {
  const n = (s: string): string => (s || '').trim().toLowerCase()
  return `${n(c.srcName)}|${n(c.srcSocket)}>${n(c.dstName)}|${n(c.dstSocket)}`
}

function mapCircuit(row: Row): Circuit {
  return {
    id: row.id as number,
    cableNumber: (row.cable_number as string) ?? '',
    signal: (row.signal as string) ?? '',
    estLength: (row.est_length as string) ?? '',
    srcName: (row.src_name as string) ?? '',
    srcSocket: (row.src_socket as string) ?? '',
    srcConnector: (row.src_connector as string) ?? '',
    srcRack: (row.src_rack as string) ?? '',
    srcRackU: (row.src_rack_u as string) ?? '',
    srcSlot: (row.src_slot as string) ?? '',
    dstName: (row.dst_name as string) ?? '',
    dstSocket: (row.dst_socket as string) ?? '',
    dstConnector: (row.dst_connector as string) ?? '',
    dstRack: (row.dst_rack as string) ?? '',
    dstRackU: (row.dst_rack_u as string) ?? '',
    dstSlot: (row.dst_slot as string) ?? '',
    srcPatched: Boolean(row.src_patched),
    dstPatched: Boolean(row.dst_patched),
    tested: Boolean(row.tested),
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function listCircuits(): Circuit[] {
  return queryAll(
    `SELECT * FROM circuits
     ORDER BY src_rack COLLATE NOCASE, CAST(src_rack_u AS INTEGER), src_name COLLATE NOCASE, cable_number COLLATE NOCASE`
  ).map(mapCircuit)
}

export function getCircuitById(id: number): Circuit | null {
  const row = queryOne('SELECT * FROM circuits WHERE id = ?', [id])
  return row ? mapCircuit(row) : null
}

export function setCircuitStatus(id: number, input: CircuitStatusInput): Circuit {
  // Backstop invariant: a circuit can't be "tested" unless BOTH ends are
  // patched. (So un-patching either end always clears tested.) The inverse —
  // turning tested ON marking both ends patched — is applied by the caller that
  // flips tested, so an un-patch here is never silently re-patched.
  const { srcPatched, dstPatched } = input
  const tested = input.tested && srcPatched && dstPatched
  dbRun(
    `UPDATE circuits SET src_patched = ?, dst_patched = ?, tested = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [srcPatched ? 1 : 0, dstPatched ? 1 : 0, tested ? 1 : 0, input.notes, id]
  )
  return getCircuitById(id) as Circuit
}

export function clearCircuits(): void {
  dbRun('DELETE FROM circuits')
}

/** Upsert the imported circuits by connection identity, preserving patched/
 *  tested/notes on ones that persist, and removing circuits no longer present
 *  in the report (the drawing is authoritative for which circuits exist). */
export function mergeCircuits(rows: CircuitImport[]): CircuitImportResult {
  let added = 0
  let updated = 0
  const keys: string[] = []
  for (const r of rows) {
    const key = circuitKey(r)
    keys.push(key)
    const existing = queryOne('SELECT id FROM circuits WHERE conn_key = ?', [key])
    const vals = [
      r.cableNumber, r.signal, r.estLength,
      r.srcName, r.srcSocket, r.srcConnector, r.srcRack, r.srcRackU, r.srcSlot,
      r.dstName, r.dstSocket, r.dstConnector, r.dstRack, r.dstRackU, r.dstSlot
    ]
    if (existing) {
      dbRun(
        `UPDATE circuits SET cable_number=?, signal=?, est_length=?,
           src_name=?, src_socket=?, src_connector=?, src_rack=?, src_rack_u=?, src_slot=?,
           dst_name=?, dst_socket=?, dst_connector=?, dst_rack=?, dst_rack_u=?, dst_slot=?,
           updated_at=datetime('now')
         WHERE conn_key=?`,
        [...vals, key]
      )
      updated++
    } else {
      dbRun(
        `INSERT INTO circuits (conn_key, cable_number, signal, est_length,
           src_name, src_socket, src_connector, src_rack, src_rack_u, src_slot,
           dst_name, dst_socket, dst_connector, dst_rack, dst_rack_u, dst_slot)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [key, ...vals]
      )
      added++
    }
  }
  // Remove circuits no longer in the report. An empty parse almost always means
  // the wrong file was picked, not an emptied drawing — so DON'T wipe on zero
  // rows (that would destroy the crew's patch status). Deliberate wiping is the
  // Clear button (clearCircuits).
  let removed = 0
  if (keys.length) {
    const ph = keys.map(() => '?').join(',')
    const stale = queryOne(`SELECT count(*) AS n FROM circuits WHERE conn_key NOT IN (${ph})`, keys)
    removed = (stale?.n as number) ?? 0
    dbRun(`DELETE FROM circuits WHERE conn_key NOT IN (${ph})`, keys)
  }
  const totalRow = queryOne('SELECT count(*) AS n FROM circuits')
  return { added, updated, removed, total: (totalRow?.n as number) ?? 0 }
}
