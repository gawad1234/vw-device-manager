import { getDb, persist } from './db'
import { isValidIpv4, ipInCidr } from './ip-utils'
import type { SqlValue } from 'sql.js'
import type {
  Device,
  DeviceInput,
  DeviceWarning,
  SaveDeviceResult,
  Subnet,
  SubnetInput
} from '../shared/types'

type Row = Record<string, unknown>

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

function mapDevice(row: Row): Device {
  return {
    id: row.id as number,
    name: row.name as string,
    deviceType: (row.device_type as string | null) ?? null,
    ipAddress: (row.ip_address as string | null) ?? null,
    macAddress: (row.mac_address as string | null) ?? null,
    subnetId: (row.subnet_id as number | null) ?? null,
    location: (row.location as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

function queryAll(sql: string, params: SqlValue[] = []): Row[] {
  const stmt = getDb().prepare(sql)
  stmt.bind(params)
  const rows: Row[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

function queryOne(sql: string, params: SqlValue[] = []): Row | null {
  return queryAll(sql, params)[0] ?? null
}

function lastInsertRowId(): number {
  const res = getDb().exec('SELECT last_insert_rowid() AS id')
  return res[0].values[0][0] as number
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
  getDb().run(
    `INSERT INTO subnets (name, cidr, vlan, gateway, notes) VALUES (?, ?, ?, ?, ?)`,
    [input.name, input.cidr, input.vlan, input.gateway, input.notes]
  )
  const id = lastInsertRowId()
  persist()
  return getSubnetById(id) as Subnet
}

export function updateSubnet(id: number, input: SubnetInput): Subnet {
  getDb().run(
    `UPDATE subnets SET name = ?, cidr = ?, vlan = ?, gateway = ?, notes = ? WHERE id = ?`,
    [input.name, input.cidr, input.vlan, input.gateway, input.notes, id]
  )
  persist()
  return getSubnetById(id) as Subnet
}

export function deleteSubnet(id: number): void {
  getDb().run('DELETE FROM subnets WHERE id = ?', [id])
  persist()
}

// ---- Devices ------------------------------------------------------------

export function listDevices(): Device[] {
  return queryAll('SELECT * FROM devices ORDER BY name COLLATE NOCASE').map(mapDevice)
}

function getDeviceById(id: number): Device | null {
  const row = queryOne('SELECT * FROM devices WHERE id = ?', [id])
  return row ? mapDevice(row) : null
}

function findDeviceByIp(ip: string, excludeId?: number): Device | null {
  return (
    queryAll('SELECT * FROM devices WHERE ip_address = ?', [ip])
      .map(mapDevice)
      .find((d) => d.id !== excludeId) ?? null
  )
}

function buildWarnings(input: DeviceInput): DeviceWarning[] {
  const warnings: DeviceWarning[] = []
  if (!input.ipAddress) return warnings

  if (!isValidIpv4(input.ipAddress)) {
    warnings.push({
      type: 'invalid-ip',
      message: `"${input.ipAddress}" is not a valid IPv4 address.`
    })
    return warnings
  }

  if (input.subnetId != null) {
    const subnet = getSubnetById(input.subnetId)
    if (subnet && ipInCidr(input.ipAddress, subnet.cidr) === false) {
      warnings.push({
        type: 'ip-outside-subnet',
        message: `${input.ipAddress} is outside ${subnet.name}'s range (${subnet.cidr}).`
      })
    }
  }
  return warnings
}

export function createDevice(input: DeviceInput): SaveDeviceResult {
  if (input.ipAddress) {
    const conflict = findDeviceByIp(input.ipAddress)
    if (conflict) {
      return {
        device: null,
        warnings: [],
        error: `IP ${input.ipAddress} is already assigned to "${conflict.name}".`
      }
    }
  }

  const warnings = buildWarnings(input)
  getDb().run(
    `INSERT INTO devices (name, device_type, ip_address, mac_address, subnet_id, location, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.deviceType,
      input.ipAddress,
      input.macAddress,
      input.subnetId,
      input.location,
      input.notes
    ]
  )
  const id = lastInsertRowId()
  persist()
  return { device: getDeviceById(id), warnings }
}

export function updateDevice(id: number, input: DeviceInput): SaveDeviceResult {
  if (input.ipAddress) {
    const conflict = findDeviceByIp(input.ipAddress, id)
    if (conflict) {
      return {
        device: null,
        warnings: [],
        error: `IP ${input.ipAddress} is already assigned to "${conflict.name}".`
      }
    }
  }

  const warnings = buildWarnings(input)
  getDb().run(
    `UPDATE devices
     SET name = ?, device_type = ?, ip_address = ?, mac_address = ?, subnet_id = ?, location = ?, notes = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      input.name,
      input.deviceType,
      input.ipAddress,
      input.macAddress,
      input.subnetId,
      input.location,
      input.notes,
      id
    ]
  )
  persist()
  return { device: getDeviceById(id), warnings }
}

export function deleteDevice(id: number): void {
  getDb().run('DELETE FROM devices WHERE id = ?', [id])
  persist()
}
