import { ipcMain, dialog, shell } from 'electron'
import { writeFileSync } from 'fs'
import * as repo from './repository'
import * as projects from './projects'
import * as library from './library'
import { exportDocument } from './exports'
import { generateVlanScript } from './vlan-script'
import { printCaseLabels, printCasesLabels } from './caselabels'
import { importCircuitReport } from './circuit-import'
import * as updater from './updater'
import * as server from './server'
import type {
  CircuitStatusInput,
  ServerPins,
  BundleInput,
  CableInput,
  CableTypeInput,
  DeviceInput,
  ExportOptions,
  HostConfigInput,
  LabelTemplateInput,
  OrderExportFormatInput,
  OrderKitInput,
  PackCaseInput,
  PortInput,
  ShopOrderInput,
  SubnetInput
} from '../shared/types'

export function registerIpcHandlers(): void {
  ipcMain.handle('subnets:list', () => repo.listSubnets())
  ipcMain.handle('subnets:create', (_e, input: SubnetInput) => repo.createSubnet(input))
  ipcMain.handle('subnets:update', (_e, id: number, input: SubnetInput) =>
    repo.updateSubnet(id, input)
  )
  ipcMain.handle('subnets:remove', (_e, id: number) => repo.deleteSubnet(id))

  ipcMain.handle('devices:list', () => repo.listDevices())
  ipcMain.handle('devices:create', (_e, input: DeviceInput) => repo.createDevice(input))
  ipcMain.handle('devices:update', (_e, id: number, input: DeviceInput) =>
    repo.updateDevice(id, input)
  )
  ipcMain.handle('devices:remove', (_e, id: number) => repo.deleteDevice(id))

  ipcMain.handle('ports:create', (_e, deviceId: number, input: PortInput) =>
    repo.createPort(deviceId, input)
  )
  ipcMain.handle('ports:update', (_e, id: number, input: PortInput) => repo.updatePort(id, input))
  ipcMain.handle('ports:remove', (_e, id: number) => repo.deletePort(id))
  ipcMain.handle('ports:setTaggedVlans', (_e, id: number, subnetIds: number[]) =>
    repo.setPortTaggedVlans(id, subnetIds)
  )
  ipcMain.handle('ports:setPrimary', (_e, id: number, isPrimary: boolean) =>
    repo.setPrimaryPort(id, isPrimary)
  )
  ipcMain.handle('ports:setUnused', (_e, id: number, isUnused: boolean) =>
    repo.setPortUnused(id, isUnused)
  )
  ipcMain.handle('ports:setLag', (_e, id: number, lagGroup: string | null) =>
    repo.setPortLag(id, lagGroup)
  )

  // Network signals + cable types are the shared, cross-project library.
  ipcMain.handle('signals:list', () => library.listNetworkSignals())
  ipcMain.handle('signals:add', (_e, signal: string) => library.addNetworkSignal(signal))
  ipcMain.handle('signals:remove', (_e, signal: string) => library.removeNetworkSignal(signal))

  ipcMain.handle('bundles:list', () => repo.listBundles())
  ipcMain.handle('bundles:create', (_e, input: BundleInput) => repo.createBundle(input))
  ipcMain.handle('bundles:update', (_e, id: number, input: BundleInput) =>
    repo.updateBundle(id, input)
  )
  ipcMain.handle('bundles:remove', (_e, id: number) => repo.deleteBundle(id))
  ipcMain.handle('bundles:duplicate', (_e, id: number) => repo.duplicateBundle(id))

  ipcMain.handle('cables:create', (_e, bundleId: number, input: CableInput) =>
    repo.createCable(bundleId, input)
  )
  ipcMain.handle('cables:update', (_e, id: number, input: CableInput) =>
    repo.updateCable(id, input)
  )
  ipcMain.handle('cables:remove', (_e, id: number) => repo.deleteCable(id))

  ipcMain.handle('cableTypes:list', () => library.listCableTypes())
  ipcMain.handle('cableTypes:add', (_e, input: CableTypeInput) => library.addCableType(input))
  ipcMain.handle('cableTypes:remove', (_e, name: string) => library.removeCableType(name))

  ipcMain.handle('deviceCategories:list', () => library.listDeviceCategories())
  ipcMain.handle('deviceCategories:add', (_e, name: string) => library.addDeviceCategory(name))
  ipcMain.handle('deviceCategories:remove', (_e, name: string) => library.removeDeviceCategory(name))

  ipcMain.handle('project:current', () => projects.getCurrentProject())
  ipcMain.handle('project:recent', () => projects.listRecent())
  ipcMain.handle('project:new', () => projects.newProject())
  ipcMain.handle('project:open', () => projects.openProject())
  ipcMain.handle('project:openRecent', (_e, path: string) => projects.openProjectPath(path))
  ipcMain.handle('project:saveCopyAs', () => projects.saveCopyAs())
  ipcMain.handle('project:reveal', () => projects.revealCurrent())

  ipcMain.handle('export:run', (_e, opts: ExportOptions) => exportDocument(opts))

  // Per-show logo stamped onto generated paperwork.
  ipcMain.handle('showLogo:get', () => repo.getProjectMeta('logo'))
  ipcMain.handle('showLogo:set', (_e, dataUrl: string | null) =>
    repo.setProjectMeta('logo', dataUrl)
  )
  ipcMain.handle('showName:get', () => repo.getProjectMeta('showName'))
  ipcMain.handle('showName:set', (_e, name: string | null) =>
    repo.setProjectMeta('showName', name)
  )

  // Host VLAN configs → PowerShell script generation (Configs tab).
  ipcMain.handle('configs:list', () => repo.listHostConfigs())
  ipcMain.handle('configs:create', (_e, input: HostConfigInput) => repo.createHostConfig(input))
  ipcMain.handle('configs:update', (_e, id: number, input: HostConfigInput) =>
    repo.updateHostConfig(id, input)
  )
  ipcMain.handle('configs:remove', (_e, id: number) => repo.deleteHostConfig(id))
  ipcMain.handle('configs:generate', async (_e, id: number) => {
    const config = repo.getHostConfigById(id)
    if (!config) return null
    const script = generateVlanScript(config)
    const safe = (config.name || 'host-config').replace(/[/\\:*?"<>|]/g, '-')
    const res = await dialog.showSaveDialog({
      defaultPath: `${safe}.ps1`,
      filters: [{ name: 'PowerShell script', extensions: ['ps1'] }]
    })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, script, 'utf-8')
    shell.showItemInFolder(res.filePath) // reveal (don't execute) the .ps1
    return res.filePath
  })
  // Export the VLAN list as JSON for the standalone host VlanManager tool / the
  // engine's -ConfigPath (schema: [{Name,VlanId,Tagged,Dhcp,IPAddress,PrefixLength,Gateway,DnsServers}]).
  ipcMain.handle('configs:exportJson', async (_e, id: number) => {
    const config = repo.getHostConfigById(id)
    if (!config) return null
    const json = config.vlans.map((v) => ({
      Name: v.name,
      VlanId: Math.trunc(v.vlanId) || 0,
      Tagged: !!v.tagged,
      Dhcp: !!v.dhcp,
      IPAddress: v.dhcp ? null : v.ipAddress || null,
      PrefixLength: Math.trunc(v.prefixLength) || 24,
      Gateway: !v.dhcp && v.gateway ? v.gateway : null,
      DnsServers: (v.dnsServers || []).filter(Boolean)
    }))
    const safe = (config.name || 'host-config').replace(/[/\\:*?"<>|]/g, '-')
    const res = await dialog.showSaveDialog({
      defaultPath: `${safe}.vlans.json`,
      filters: [{ name: 'VLAN config (JSON)', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, JSON.stringify(json, null, 2), 'utf-8')
    shell.showItemInFolder(res.filePath)
    return res.filePath
  })

  // Shop orders (Orders tab).
  ipcMain.handle('orders:list', () => repo.listShopOrders())
  ipcMain.handle('orders:create', (_e, input: ShopOrderInput) => repo.createShopOrder(input))
  ipcMain.handle('orders:update', (_e, id: number, input: ShopOrderInput) =>
    repo.updateShopOrder(id, input)
  )
  ipcMain.handle('orders:remove', (_e, id: number) => repo.deleteShopOrder(id))

  // Case label templates (Labels tab).
  ipcMain.handle('labels:list', () => repo.listLabelTemplates())
  ipcMain.handle('labels:create', (_e, input: LabelTemplateInput) => repo.createLabelTemplate(input))
  ipcMain.handle('labels:update', (_e, id: number, input: LabelTemplateInput) =>
    repo.updateLabelTemplate(id, input)
  )
  ipcMain.handle('labels:remove', (_e, id: number) => repo.deleteLabelTemplate(id))
  ipcMain.handle('labels:print', (_e, id: number, copies: number) => {
    const t = repo.getLabelTemplateById(id)
    return t ? printCaseLabels(t, copies) : null
  })
  ipcMain.handle('labels:printCases', (_e, templateId: number, caseIds: number[]) => {
    const t = repo.getLabelTemplateById(templateId)
    if (!t) return null
    return printCasesLabels(t, repo.listCasesByIds(caseIds))
  })

  // Shop-order export formats ("order types").
  ipcMain.handle('orderFormats:list', () => repo.listOrderExportFormats())
  ipcMain.handle('orderFormats:create', (_e, input: OrderExportFormatInput) =>
    repo.createOrderExportFormat(input)
  )
  ipcMain.handle('orderFormats:update', (_e, id: number, input: OrderExportFormatInput) =>
    repo.updateOrderExportFormat(id, input)
  )
  ipcMain.handle('orderFormats:remove', (_e, id: number) => repo.deleteOrderExportFormat(id))

  // Auto-add kits.
  ipcMain.handle('orderKits:list', () => repo.listOrderKits())
  ipcMain.handle('orderKits:create', (_e, input: OrderKitInput) => repo.createOrderKit(input))
  ipcMain.handle('orderKits:update', (_e, id: number, input: OrderKitInput) =>
    repo.updateOrderKit(id, input)
  )
  ipcMain.handle('orderKits:remove', (_e, id: number) => repo.deleteOrderKit(id))

  // Cases (packing manager).
  ipcMain.handle('cases:list', () => repo.listCases())
  ipcMain.handle('cases:create', (_e, input: PackCaseInput) => repo.createCase(input))
  ipcMain.handle('cases:update', (_e, id: number, input: PackCaseInput) =>
    repo.updateCase(id, input)
  )
  ipcMain.handle('cases:remove', (_e, id: number) => repo.deleteCase(id))

  // Patching (circuits imported from a ConnectCAD circuit report).
  ipcMain.handle('circuits:list', () => repo.listCircuits())
  ipcMain.handle('circuits:setStatus', (_e, id: number, input: CircuitStatusInput) =>
    repo.setCircuitStatus(id, input)
  )
  ipcMain.handle('circuits:import', () => importCircuitReport())
  ipcMain.handle('circuits:clear', () => repo.clearCircuits())

  // App auto-update (Settings → Updates).
  ipcMain.handle('updates:getState', () => updater.getUpdateStatus())
  ipcMain.handle('updates:check', () => updater.checkForUpdates())
  ipcMain.handle('updates:download', () => updater.downloadUpdate())
  ipcMain.handle('updates:install', () => updater.quitAndInstall())
  ipcMain.handle('updates:getAutoCheck', () => updater.getAutoCheck())
  ipcMain.handle('updates:setAutoCheck', (_e, value: boolean) => updater.setAutoCheck(value))

  // LAN Show Server (Settings → Show Server).
  ipcMain.handle('server:getState', () => server.getServerStatus())
  ipcMain.handle('server:setEnabled', (_e, value: boolean) => server.setEnabled(value))
  ipcMain.handle('server:setPort', (_e, port: number) => server.setPort(port))
  ipcMain.handle('server:getPins', () => server.getPins())
  ipcMain.handle('server:setPins', (_e, pins: ServerPins) => server.setPins(pins))
  ipcMain.handle('server:connectQr', () => server.connectQr())
}
