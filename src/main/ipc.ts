import { ipcMain, dialog, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { copyFile } from 'fs/promises'
import { join } from 'path'
import * as repo from './repository'
import * as projects from './projects'
import * as library from './library'
import { exportDocument } from './exports'
import { generateVlanScript } from './vlan-script'
import { printCaseLabels, printCasesLabels } from './caselabels'
import { importCircuitReport } from './circuit-import'
import * as updater from './updater'
import * as server from './server'
import * as remote from './remote'
import { handlers, bumpChange, type Handler } from './rpc-registry'
import { channelScope } from '../shared/remote-scope'
import { projectorCommandsCsv } from '../shared/projector-settings'
import { generateInstallScript, INSTALL_BAT, kitFileNames } from './software-kit'
import { printStickers, printStickerTest } from './stickers'
import type {
  BuildKitResult,
  PrintStickersOptions,
  StickerDesignInput,
  StickerSheetInput,
  CrewAssignmentInput,
  CrewMemberInput,
  ScheduleMeta,
  TruckInput,
  TruckTripInput,
  SoftwarePackageInput,
  ProjectorConfig,
  CircuitStatusInput,
  ServerPins,
  ProjectInfo,
  BundleInput,
  CableInput,
  CableTypeInput,
  DeviceInput,
  WallpaperConfig,
  ExportOptions,
  HostConfigInput,
  LabelTemplateInput,
  OrderExportFormatInput,
  OrderKitInput,
  SwitchConfigSettings,
  PackCaseInput,
  PortInput,
  ShopOrderInput,
  SubnetInput
} from '../shared/types'

const VIEW_ONLY =
  'This computer is viewing a shared show. Editing from joined computers comes in the next update.'
const HOST_ONLY = 'Do this from the host computer for now.'

/** Register an IPC handler. While this computer has joined a show on another
 *  computer, data reads go to that host and changes are refused (view-only). */
function handle(channel: string, fn: Handler): void {
  handlers.set(channel, fn)
  const scope = channelScope(channel)
  ipcMain.handle(channel, async (event, ...args) => {
    if (remote.isJoined()) {
      if (scope === 'read') return remote.call(channel, args)
      if (scope === 'write') throw new Error(VIEW_ONLY)
      if (scope === 'host-only') throw new Error(HOST_ONLY)
    }
    const result = await fn(event, ...args)
    if (scope === 'write') bumpChange()
    return result
  })
}

export function registerIpcHandlers(): void {
  handle('subnets:list', () => repo.listSubnets())
  handle('subnets:create', (_e, input: SubnetInput) => repo.createSubnet(input))
  handle('subnets:update', (_e, id: number, input: SubnetInput) =>
    repo.updateSubnet(id, input)
  )
  handle('subnets:remove', (_e, id: number) => repo.deleteSubnet(id))

  handle('devices:list', () => repo.listDevices())
  handle('devices:create', (_e, input: DeviceInput) => repo.createDevice(input))
  handle('devices:update', (_e, id: number, input: DeviceInput) =>
    repo.updateDevice(id, input)
  )
  handle('devices:remove', (_e, id: number) => repo.deleteDevice(id))
  handle('devices:setWallpaper', (_e, id: number, config: WallpaperConfig | null) =>
    repo.setDeviceWallpaper(id, config)
  )
  handle('devices:setProjector', (_e, id: number, config: ProjectorConfig | null) =>
    repo.setDeviceProjector(id, config)
  )

  handle('devices:setSoftware', (_e, id: number, packageIds: number[] | null) =>
    repo.setDeviceSoftware(id, packageIds)
  )

  // Cable loom stickers: sheet types + designs (shared library), printing.
  handle('stickers:sheets', () => library.listStickerSheets())
  handle('stickers:saveSheet', (_e, id: number | null, input: StickerSheetInput) =>
    library.saveStickerSheet(id, input)
  )
  handle('stickers:removeSheet', (_e, id: number) => library.deleteStickerSheet(id))
  handle('stickers:designs', () => library.listStickerDesigns())
  handle('stickers:saveDesign', (_e, id: number | null, input: StickerDesignInput) =>
    library.saveStickerDesign(id, input)
  )
  handle('stickers:removeDesign', (_e, id: number) => library.deleteStickerDesign(id))
  handle('stickers:print', (_e, opts: PrintStickersOptions) => printStickers(opts))
  handle('stickers:printTest', (_e, sheetId: number) => printStickerTest(sheetId))

  // Crew: shared directory (library.json, gitignored) + this show's bookings.
  handle('crew:directory', () => library.listCrew())
  handle('crew:createMember', (_e, input: CrewMemberInput) =>
    library.createCrewMember(input)
  )
  handle('crew:updateMember', (_e, id: number, input: CrewMemberInput) =>
    library.updateCrewMember(id, input)
  )
  handle('crew:removeMember', (_e, id: number) => library.deleteCrewMember(id))
  handle('crew:assignments', () => repo.listCrewAssignments())
  handle('crew:assign', (_e, input: CrewAssignmentInput) =>
    repo.saveCrewAssignment(null, input)
  )
  handle('crew:updateAssignment', (_e, id: number, input: CrewAssignmentInput) =>
    repo.saveCrewAssignment(id, input)
  )
  handle('crew:unassign', (_e, id: number) => repo.deleteCrewAssignment(id))
  handle('crew:getSchedule', () => repo.getScheduleMeta())
  handle('crew:setSchedule', (_e, meta: ScheduleMeta) => repo.setScheduleMeta(meta))

  // Trucking (per show).
  handle('trucking:trucks', () => repo.listTrucks())
  handle('trucking:saveTruck', (_e, id: number | null, input: TruckInput) =>
    repo.saveTruck(id, input)
  )
  handle('trucking:removeTruck', (_e, id: number) => repo.deleteTruck(id))
  handle('trucking:trips', () => repo.listTruckTrips())
  handle('trucking:saveTrip', (_e, id: number | null, input: TruckTripInput) =>
    repo.saveTruckTrip(id, input)
  )
  handle('trucking:removeTrip', (_e, id: number) => repo.deleteTruckTrip(id))

  // Software library (shared) + per-computer install kits.
  handle('software:list', () => library.listSoftware())
  handle('software:create', (_e, input: SoftwarePackageInput) =>
    library.createSoftware(input)
  )
  handle('software:update', (_e, id: number, input: SoftwarePackageInput) =>
    library.updateSoftware(id, input)
  )
  handle('software:remove', (_e, id: number) => library.deleteSoftware(id))
  handle('software:pickInstaller', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose a Windows installer',
      properties: ['openFile'],
      filters: [{ name: 'Windows installers', extensions: ['exe', 'msi'] }]
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  // Writes "<Computer> Setup/" (installers\ + Install.ps1 + Install.bat) into a folder
  // the user picks, e.g. a USB stick. Fails up front if any installer file is missing.
  handle(
    'software:buildKit',
    async (_e, deviceId: number): Promise<BuildKitResult | null> => {
      const device = repo.getDeviceById(deviceId)
      const byId = new Map(library.listSoftware().map((p) => [p.id, p]))
      const pkgs = (device?.software ?? []).flatMap((id) => byId.get(id) ?? [])
      if (!device || !pkgs.length) return { error: 'No software is ticked for this computer.' }
      const missing = pkgs.filter((p) => !existsSync(p.path))
      if (missing.length)
        return {
          error: `Installer not found on this computer: ${missing.map((p) => `${p.name} (${p.path})`).join('; ')}`
        }
      const res = await dialog.showOpenDialog({
        title: 'Choose where to write the install kit (e.g. a USB stick)',
        properties: ['openDirectory', 'createDirectory']
      })
      if (res.canceled || !res.filePaths[0]) return null
      const safe = (device.name || 'Computer').replace(/[/\\:*?"<>|]/g, '-')
      const kitDir = join(res.filePaths[0], `${safe} Setup`)
      const files = kitFileNames(pkgs.map((p) => p.path))
      mkdirSync(join(kitDir, 'installers'), { recursive: true })
      for (let i = 0; i < pkgs.length; i++)
        await copyFile(pkgs[i].path, join(kitDir, 'installers', files[i]))
      const items = pkgs.map((p, i) => ({ name: p.name, file: files[i], args: p.args }))
      // BOM: Windows PowerShell 5.1 reads BOM-less scripts as ANSI and garbles non-ASCII names.
      writeFileSync(
        join(kitDir, 'Install.ps1'),
        '\ufeff' + generateInstallScript(device.name, items).replace(/\r?\n/g, '\r\n'),
        'utf-8'
      )
      writeFileSync(join(kitDir, 'Install.bat'), INSTALL_BAT, 'utf-8')
      shell.showItemInFolder(join(kitDir, 'Install.bat'))
      return { path: kitDir, count: pkgs.length }
    }
  )

  // Save a projector's command list CSV for Panasonic Multi Monitoring & Control.
  handle('projector:saveCommands', async (_e, deviceId: number) => {
    const device = repo.getDeviceById(deviceId)
    if (!device?.projector) return null
    const safe = (device.name || 'projector').replace(/[/\\:*?"<>|]/g, '-')
    const res = await dialog.showSaveDialog({
      defaultPath: `${safe}-commands.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, projectorCommandsCsv(device.projector), 'utf-8')
    shell.showItemInFolder(res.filePath)
    return res.filePath
  })

  // Save generated wallpaper PNGs to a folder the user picks.
  handle(
    'wallpapers:save',
    async (_e, files: { name: string; dataUrl: string }[]): Promise<number> => {
      const res = await dialog.showOpenDialog({
        title: 'Save wallpapers to folder',
        properties: ['openDirectory', 'createDirectory']
      })
      if (res.canceled || !res.filePaths[0]) return -1
      const dir = res.filePaths[0]
      let n = 0
      for (const f of files) {
        const base64 = f.dataUrl.replace(/^data:image\/png;base64,/, '')
        writeFileSync(join(dir, f.name), Buffer.from(base64, 'base64'))
        n++
      }
      return n
    }
  )

  handle('ports:create', (_e, deviceId: number, input: PortInput) =>
    repo.createPort(deviceId, input)
  )
  handle('ports:update', (_e, id: number, input: PortInput) => repo.updatePort(id, input))
  handle('ports:remove', (_e, id: number) => repo.deletePort(id))
  handle('ports:setTaggedVlans', (_e, id: number, subnetIds: number[]) =>
    repo.setPortTaggedVlans(id, subnetIds)
  )
  handle('ports:setPrimary', (_e, id: number, isPrimary: boolean) =>
    repo.setPrimaryPort(id, isPrimary)
  )
  handle('ports:setUnused', (_e, id: number, isUnused: boolean) =>
    repo.setPortUnused(id, isUnused)
  )
  handle('ports:setLag', (_e, id: number, lagGroup: string | null) =>
    repo.setPortLag(id, lagGroup)
  )

  // Network signals + cable types are the shared, cross-project library.
  handle('signals:list', () => library.listNetworkSignals())
  handle('signals:add', (_e, signal: string) => library.addNetworkSignal(signal))
  handle('signals:remove', (_e, signal: string) => library.removeNetworkSignal(signal))

  handle('bundles:list', () => repo.listBundles())
  handle('bundles:create', (_e, input: BundleInput) => repo.createBundle(input))
  handle('bundles:update', (_e, id: number, input: BundleInput) =>
    repo.updateBundle(id, input)
  )
  handle('bundles:remove', (_e, id: number) => repo.deleteBundle(id))
  handle('bundles:duplicate', (_e, id: number) => repo.duplicateBundle(id))

  handle('cables:create', (_e, bundleId: number, input: CableInput) =>
    repo.createCable(bundleId, input)
  )
  handle('cables:update', (_e, id: number, input: CableInput) =>
    repo.updateCable(id, input)
  )
  handle('cables:remove', (_e, id: number) => repo.deleteCable(id))

  handle('cableTypes:list', () => library.listCableTypes())
  handle('cableTypes:add', (_e, input: CableTypeInput) => library.addCableType(input))
  handle('cableTypes:remove', (_e, name: string) => library.removeCableType(name))

  handle('deviceCategories:list', () => library.listDeviceCategories())
  handle('deviceCategories:add', (_e, name: string) => library.addDeviceCategory(name))
  handle('deviceCategories:remove', (_e, name: string) => library.removeDeviceCategory(name))

  handle('project:current', () => remote.info() ?? projects.getCurrentProject())
  handle('project:recent', () => projects.listRecent())
  // Opening a local project (not a cancelled dialog) leaves a shared show.
  const leaveIfOpened = (p: ProjectInfo | null): ProjectInfo | null => (p && remote.leave(), p)
  handle('project:new', async () => leaveIfOpened(await projects.newProject()))
  handle('project:open', async () => leaveIfOpened(await projects.openProject()))
  handle('project:openRecent', async (_e, path: string) =>
    leaveIfOpened(await projects.openProjectPath(path))
  )
  handle('project:join', (_e, address: string, pin: string) => remote.join(address, pin))
  handle('project:leave', () => (remote.leave(), projects.getCurrentProject()))
  handle('project:saveCopyAs', () => projects.saveCopyAs())
  handle('project:reveal', () => projects.revealCurrent())

  handle('export:run', (_e, opts: ExportOptions) => exportDocument(opts))

  // Per-show logo stamped onto generated paperwork.
  handle('showLogo:get', () => repo.getProjectMeta('logo'))
  handle('showLogo:set', (_e, dataUrl: string | null) =>
    repo.setProjectMeta('logo', dataUrl)
  )
  handle('showName:get', () => repo.getProjectMeta('showName'))
  handle('showName:set', (_e, name: string | null) =>
    repo.setProjectMeta('showName', name)
  )
  // Company branding — shared across all projects (library), unlike the per-show branding above.
  handle('companyLogo:get', () => library.getCompanyLogo())
  handle('companyLogo:set', (_e, dataUrl: string | null) => library.setCompanyLogo(dataUrl))
  handle('companyName:get', () => library.getCompanyName())
  handle('companyName:set', (_e, name: string | null) => library.setCompanyName(name))
  handle('switchConfig:get', () => library.getSwitchConfig())
  handle('switchConfig:set', (_e, input: SwitchConfigSettings) =>
    library.setSwitchConfig(input)
  )

  // Host VLAN configs → PowerShell script generation (Configs tab).
  handle('configs:list', () => repo.listHostConfigs())
  handle('configs:create', (_e, input: HostConfigInput) => repo.createHostConfig(input))
  handle('configs:update', (_e, id: number, input: HostConfigInput) =>
    repo.updateHostConfig(id, input)
  )
  handle('configs:remove', (_e, id: number) => repo.deleteHostConfig(id))
  handle('configs:generate', async (_e, id: number) => {
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
  handle('configs:exportJson', async (_e, id: number) => {
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
  handle('orders:list', () => repo.listShopOrders())
  handle('orders:create', (_e, input: ShopOrderInput) => repo.createShopOrder(input))
  handle('orders:update', (_e, id: number, input: ShopOrderInput) =>
    repo.updateShopOrder(id, input)
  )
  handle('orders:remove', (_e, id: number) => repo.deleteShopOrder(id))

  // Case label templates (Labels tab).
  handle('labels:list', () => repo.listLabelTemplates())
  handle('labels:create', (_e, input: LabelTemplateInput) => repo.createLabelTemplate(input))
  handle('labels:update', (_e, id: number, input: LabelTemplateInput) =>
    repo.updateLabelTemplate(id, input)
  )
  handle('labels:remove', (_e, id: number) => repo.deleteLabelTemplate(id))
  handle('labels:print', (_e, id: number, copies: number) => {
    const t = repo.getLabelTemplateById(id)
    return t ? printCaseLabels(t, copies) : null
  })
  handle('labels:printCases', (_e, templateId: number, caseIds: number[]) => {
    const t = repo.getLabelTemplateById(templateId)
    if (!t) return null
    return printCasesLabels(t, repo.listCasesByIds(caseIds))
  })

  // Shop-order export formats ("order types").
  handle('orderFormats:list', () => repo.listOrderExportFormats())
  handle('orderFormats:create', (_e, input: OrderExportFormatInput) =>
    repo.createOrderExportFormat(input)
  )
  handle('orderFormats:update', (_e, id: number, input: OrderExportFormatInput) =>
    repo.updateOrderExportFormat(id, input)
  )
  handle('orderFormats:remove', (_e, id: number) => repo.deleteOrderExportFormat(id))

  // Auto-add kits — shared library, like categories/cable types/signals.
  handle('orderKits:list', () => library.listOrderKits())
  handle('orderKits:create', (_e, input: OrderKitInput) => library.createOrderKit(input))
  handle('orderKits:update', (_e, id: number, input: OrderKitInput) =>
    library.updateOrderKit(id, input)
  )
  handle('orderKits:remove', (_e, id: number) => library.deleteOrderKit(id))

  // Cases (packing manager).
  handle('cases:list', () => repo.listCases())
  handle('cases:create', (_e, input: PackCaseInput) => repo.createCase(input))
  handle('cases:update', (_e, id: number, input: PackCaseInput) =>
    repo.updateCase(id, input)
  )
  handle('cases:remove', (_e, id: number) => repo.deleteCase(id))

  // Patching (circuits imported from a ConnectCAD circuit report).
  handle('circuits:list', () => repo.listCircuits())
  handle('circuits:setStatus', (_e, id: number, input: CircuitStatusInput) =>
    repo.setCircuitStatus(id, input)
  )
  handle('circuits:import', () => importCircuitReport())
  handle('circuits:clear', () => repo.clearCircuits())

  // App auto-update (Settings → Updates).
  handle('updates:getState', () => updater.getUpdateStatus())
  handle('updates:check', () => updater.checkForUpdates())
  handle('updates:download', () => updater.downloadUpdate())
  handle('updates:install', () => updater.quitAndInstall())
  handle('updates:getAutoCheck', () => updater.getAutoCheck())
  handle('updates:setAutoCheck', (_e, value: boolean) => updater.setAutoCheck(value))

  // LAN Show Server (Settings → Show Server).
  handle('server:getState', () => server.getServerStatus())
  handle('server:setEnabled', (_e, value: boolean) => server.setEnabled(value))
  handle('server:setPort', (_e, port: number) => server.setPort(port))
  handle('server:getPins', () => server.getPins())
  handle('server:setPins', (_e, pins: ServerPins) => server.setPins(pins))
  handle('server:connectQr', () => server.connectQr())
}
