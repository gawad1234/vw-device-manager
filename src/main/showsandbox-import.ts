import { dialog } from 'electron'
import { readFileSync } from 'fs'
import { dbGet, dbRun, withTx } from './db'
import * as repo from './repository'
import { ipInCidr } from '../shared/ip-utils'
import { planShowImport, type ShowPlan } from '../shared/showsandbox'
import type { ShowSandboxImportResult } from '../shared/types'

// Writes a ShowSandbox plan into the open project. Safe to run again after the
// show changes: everything is matched by name, and an existing row only gets
// fields it has EMPTY filled — MACs, notes, IPs and install ticks typed on site are
// never overwritten by the plan.

const idOf = (sql: string, params: (string | number)[]): number | null => {
  const row = dbGet(sql, params)
  return row ? Number(row.id) : null
}

export function applyShowPlan(plan: ShowPlan): ShowSandboxImportResult {
  const r: ShowSandboxImportResult = {
    showName: plan.showName,
    devicesAdded: 0,
    devicesMatched: 0,
    portsAdded: 0,
    subnetsAdded: 0,
    bundlesAdded: 0,
    cablesAdded: 0,
    cablesSkipped: 0,
    circuitsAdded: 0,
    circuitsKept: 0,
    warnings: []
  }
  return withTx(() => {
    for (const s of plan.subnets) {
      if (idOf('SELECT id FROM subnets WHERE cidr = ?', [s.cidr]) != null) continue
      repo.createSubnet({ name: s.name, cidr: s.cidr, vlan: s.vlan, gateway: null, notes: null })
      r.subnetsAdded++
    }
    const subnets = repo.listSubnets()
    const subnetFor = (ip: string): number | null =>
      subnets.find((s) => ipInCidr(ip, s.cidr))?.id ?? null

    const deviceIds = new Map<string, number>()
    const portIds = new Map<string, number>() // `${device}\0${label}`
    for (const d of plan.devices) {
      let id = idOf('SELECT id FROM devices WHERE name = ? ORDER BY id LIMIT 1', [d.name])
      if (id != null) {
        dbRun(
          `UPDATE devices SET device_type = COALESCE(device_type, ?), location = COALESCE(location, ?),
             updated_at = datetime('now') WHERE id = ?`,
          [d.deviceType, d.location, id]
        )
        r.devicesMatched++
      } else {
        const res = repo.createDevice({
          name: d.name,
          deviceType: d.deviceType,
          macAddress: null,
          location: d.location,
          notes: null,
          category: null,
          isSwitch: d.isSwitch,
          managementIp: null,
          oobIp: null
        })
        if (!res.device) {
          r.warnings.push(`${d.name}: ${res.error}`)
          continue
        }
        id = res.device.id
        r.devicesAdded++
      }
      deviceIds.set(d.name, id)

      for (const p of d.ports) {
        const subnetId = p.ip ? subnetFor(p.ip) : null
        let pid = idOf('SELECT id FROM ports WHERE device_id = ? AND label = ?', [id, p.label])
        if (pid != null) {
          if (
            p.ip &&
            idOf('SELECT id FROM ports WHERE id = ? AND ip_address IS NULL', [pid]) != null
          ) {
            const res = repo.updatePort(pid, {
              label: p.label,
              ipAddress: p.ip,
              untaggedSubnetId: subnetId
            })
            if (res.error) r.warnings.push(`${d.name} ${p.label}: ${res.error}`)
          }
        } else {
          let res = repo.createPort(id, {
            label: p.label,
            ipAddress: p.ip,
            untaggedSubnetId: subnetId
          })
          if (!res.port) {
            // IP already used elsewhere: keep the jack, leave its address for you to settle
            r.warnings.push(`${d.name} ${p.label}: ${res.error}`)
            res = repo.createPort(id, { label: p.label, ipAddress: null, untaggedSubnetId: null })
          }
          pid = res.port!.id
          r.portsAdded++
        }
        portIds.set(`${d.name}\0${p.label}`, pid)
      }
    }

    const bundleIds = new Map<string, number>()
    for (const c of plan.cables) {
      let bid = bundleIds.get(c.bundle) ?? idOf('SELECT id FROM bundles WHERE name = ?', [c.bundle])
      if (bid == null) {
        bid = repo.createBundle({
          name: c.bundle,
          color: null,
          fromLocation: null,
          toLocation: null,
          length: null,
          notes: null
        }).id
        r.bundlesAdded++
      }
      bundleIds.set(c.bundle, bid)
      if (idOf('SELECT id FROM cables WHERE bundle_id = ? AND name = ?', [bid, c.name]) != null) {
        r.cablesSkipped++
        continue
      }
      const end = (
        e: ShowPlan['cables'][number]['from']
      ): { deviceId: number | null; portId: number | null; text: string | null } => {
        const deviceId = deviceIds.get(e.device) ?? null
        return {
          deviceId,
          portId: e.port ? (portIds.get(`${e.device}\0${e.port}`) ?? null) : null,
          text: deviceId == null ? `${e.device} ${e.socket}` : null
        }
      }
      repo.createCable(bid, {
        name: c.name,
        cableType: c.cableType,
        source: end(c.from),
        destination: end(c.to),
        pulled: false,
        labeled: false,
        notes: c.notes
      })
      r.cablesAdded++
    }

    const merged = repo.mergeCircuits(plan.circuits, { addOnly: true })
    r.circuitsAdded = merged.added
    r.circuitsKept = plan.circuits.length - merged.added
    return r
  })
}

/** Open a file dialog, read the chosen ShowSandbox show, and merge it into the project. */
export async function importShowSandbox(): Promise<ShowSandboxImportResult | null> {
  const res = await dialog.showOpenDialog({
    title: 'Import ShowSandbox show',
    filters: [{ name: 'ShowSandbox show', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths[0]) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(res.filePaths[0], 'utf-8'))
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  return applyShowPlan(planShowImport(raw))
}
