import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  FixtureInput,
  FixtureType,
  BundleInput,
  CableInput,
  CableTypeInput,
  CircuitStatusInput,
  DeviceInput,
  WallpaperConfig,
  ProjectorConfig,
  SoftwarePackageInput,
  CrewAssignmentInput,
  PrintStickersOptions,
  StickerDesignInput,
  StickerSheetInput,
  CrewMemberInput,
  ScheduleMeta,
  TruckInput,
  TruckTripInput,
  ExportOptions,
  HostConfigInput,
  LabelTemplateInput,
  OrderExportFormatInput,
  OrderKitInput,
  SwitchConfigSettings,
  PackCaseInput,
  PortInput,
  ServerPins,
  ShopOrderInput,
  SubnetInput,
  VwDeviceManagerApi
} from '../shared/types'

// Custom APIs for renderer
/** ipcRenderer.invoke, minus Electron's "Error invoking remote method 'x': Error:" prefix,
 *  so pages can show a handler's message as written. */
const invoke = (channel: string, ...args: unknown[]): Promise<any> => // eslint-disable-line @typescript-eslint/no-explicit-any
  ipcRenderer.invoke(channel, ...args).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(msg.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
  })

const api: VwDeviceManagerApi = {
  subnets: {
    list: () => invoke('subnets:list'),
    create: (input: SubnetInput) => invoke('subnets:create', input),
    update: (id: number, input: SubnetInput) => invoke('subnets:update', id, input),
    remove: (id: number) => invoke('subnets:remove', id)
  },
  devices: {
    list: () => invoke('devices:list'),
    create: (input: DeviceInput) => invoke('devices:create', input),
    update: (id: number, input: DeviceInput) => invoke('devices:update', id, input),
    remove: (id: number) => invoke('devices:remove', id),
    setWallpaper: (id: number, config: WallpaperConfig | null) =>
      invoke('devices:setWallpaper', id, config),
    setProjector: (id: number, config: ProjectorConfig | null) =>
      invoke('devices:setProjector', id, config),
    setSoftware: (id: number, packageIds: number[] | null) =>
      invoke('devices:setSoftware', id, packageIds)
  },
  stickers: {
    sheets: () => invoke('stickers:sheets'),
    saveSheet: (id: number | null, input: StickerSheetInput) =>
      invoke('stickers:saveSheet', id, input),
    removeSheet: (id: number) => invoke('stickers:removeSheet', id),
    designs: () => invoke('stickers:designs'),
    saveDesign: (id: number | null, input: StickerDesignInput) =>
      invoke('stickers:saveDesign', id, input),
    removeDesign: (id: number) => invoke('stickers:removeDesign', id),
    print: (opts: PrintStickersOptions) => invoke('stickers:print', opts),
    printTest: (sheetId: number) => invoke('stickers:printTest', sheetId)
  },
  crew: {
    directory: () => invoke('crew:directory'),
    createMember: (input: CrewMemberInput) => invoke('crew:createMember', input),
    updateMember: (id: number, input: CrewMemberInput) =>
      invoke('crew:updateMember', id, input),
    removeMember: (id: number) => invoke('crew:removeMember', id),
    assignments: () => invoke('crew:assignments'),
    assign: (input: CrewAssignmentInput) => invoke('crew:assign', input),
    updateAssignment: (id: number, input: CrewAssignmentInput) =>
      invoke('crew:updateAssignment', id, input),
    unassign: (id: number) => invoke('crew:unassign', id),
    getSchedule: () => invoke('crew:getSchedule'),
    setSchedule: (meta: ScheduleMeta) => invoke('crew:setSchedule', meta)
  },
  trucking: {
    trucks: () => invoke('trucking:trucks'),
    saveTruck: (id: number | null, input: TruckInput) =>
      invoke('trucking:saveTruck', id, input),
    removeTruck: (id: number) => invoke('trucking:removeTruck', id),
    trips: () => invoke('trucking:trips'),
    saveTrip: (id: number | null, input: TruckTripInput) =>
      invoke('trucking:saveTrip', id, input),
    removeTrip: (id: number) => invoke('trucking:removeTrip', id)
  },
  fixtures: {
    list: () => invoke('fixtures:list'),
    save: (id: number, input: FixtureInput) => invoke('fixtures:save', id, input)
  },
  lighting: {
    get: () => invoke('lighting:get'),
    setUniverse: (universe: number, deviceId: number | null, label: string) =>
      invoke('lighting:setUniverse', universe, deviceId, label),
    syncStatus: () => invoke('lightingSync:status'),
    setSync: (on: boolean) => invoke('lightingSync:set', on),
    chooseFile: () => invoke('lightingSync:choose'),
    onSyncStatus: (cb) => {
      const listener = (_e: unknown, status: Parameters<typeof cb>[0]): void => cb(status)
      ipcRenderer.on('lighting-sync-status', listener)
      return () => ipcRenderer.removeListener('lighting-sync-status', listener)
    }
  },
  fixtureTypes: {
    list: () => invoke('fixtureTypes:list'),
    save: (type: FixtureType) => invoke('fixtureTypes:save', type)
  },
  software: {
    list: () => invoke('software:list'),
    create: (input: SoftwarePackageInput) => invoke('software:create', input),
    update: (id: number, input: SoftwarePackageInput) =>
      invoke('software:update', id, input),
    remove: (id: number) => invoke('software:remove', id),
    pickInstaller: () => invoke('software:pickInstaller'),
    buildKit: (deviceId: number) => invoke('software:buildKit', deviceId)
  },
  projector: {
    saveCommands: (deviceId: number) => invoke('projector:saveCommands', deviceId)
  },
  wallpapers: {
    save: (files: { name: string; dataUrl: string }[]) =>
      invoke('wallpapers:save', files)
  },
  ports: {
    create: (deviceId: number, input: PortInput) =>
      invoke('ports:create', deviceId, input),
    update: (id: number, input: PortInput) => invoke('ports:update', id, input),
    remove: (id: number) => invoke('ports:remove', id),
    setTaggedVlans: (id: number, subnetIds: number[]) =>
      invoke('ports:setTaggedVlans', id, subnetIds),
    setPrimary: (id: number, isPrimary: boolean) =>
      invoke('ports:setPrimary', id, isPrimary),
    setUnused: (id: number, isUnused: boolean) =>
      invoke('ports:setUnused', id, isUnused),
    setLag: (id: number, lagGroup: string | null) =>
      invoke('ports:setLag', id, lagGroup)
  },
  networkSignals: {
    list: () => invoke('signals:list'),
    add: (signal: string) => invoke('signals:add', signal),
    remove: (signal: string) => invoke('signals:remove', signal)
  },
  bundles: {
    list: () => invoke('bundles:list'),
    create: (input: BundleInput) => invoke('bundles:create', input),
    update: (id: number, input: BundleInput) => invoke('bundles:update', id, input),
    remove: (id: number) => invoke('bundles:remove', id),
    duplicate: (id: number) => invoke('bundles:duplicate', id)
  },
  cables: {
    create: (bundleId: number, input: CableInput) =>
      invoke('cables:create', bundleId, input),
    update: (id: number, input: CableInput) => invoke('cables:update', id, input),
    remove: (id: number) => invoke('cables:remove', id)
  },
  cableTypes: {
    list: () => invoke('cableTypes:list'),
    add: (input: CableTypeInput) => invoke('cableTypes:add', input),
    remove: (name: string) => invoke('cableTypes:remove', name)
  },
  deviceCategories: {
    list: () => invoke('deviceCategories:list'),
    add: (name: string) => invoke('deviceCategories:add', name),
    remove: (name: string) => invoke('deviceCategories:remove', name)
  },
  projects: {
    current: () => invoke('project:current'),
    recent: () => invoke('project:recent'),
    new: () => invoke('project:new'),
    open: () => invoke('project:open'),
    openRecent: (path: string) => invoke('project:openRecent', path),
    saveCopyAs: () => invoke('project:saveCopyAs'),
    reveal: () => invoke('project:reveal'),
    join: (address: string, pin: string) => invoke('project:join', address, pin),
    leave: () => invoke('project:leave')
  },
  onDataChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('data-changed', listener)
    return () => ipcRenderer.removeListener('data-changed', listener)
  },
  exports: {
    run: (opts: ExportOptions) => invoke('export:run', opts)
  },
  showLogo: {
    get: () => invoke('showLogo:get'),
    set: (dataUrl: string | null) => invoke('showLogo:set', dataUrl)
  },
  showName: {
    get: () => invoke('showName:get'),
    set: (name: string | null) => invoke('showName:set', name)
  },
  companyLogo: {
    get: () => invoke('companyLogo:get'),
    set: (dataUrl: string | null) => invoke('companyLogo:set', dataUrl)
  },
  companyName: {
    get: () => invoke('companyName:get'),
    set: (name: string | null) => invoke('companyName:set', name)
  },
  switchConfig: {
    get: () => invoke('switchConfig:get'),
    set: (input: SwitchConfigSettings) => invoke('switchConfig:set', input)
  },
  updates: {
    getState: () => invoke('updates:getState'),
    check: () => invoke('updates:check'),
    download: () => invoke('updates:download'),
    install: () => invoke('updates:install'),
    getAutoCheck: () => invoke('updates:getAutoCheck'),
    setAutoCheck: (value: boolean) => invoke('updates:setAutoCheck', value)
  },
  onUpdateStatus: (cb) => {
    const listener = (_e: unknown, status: Parameters<typeof cb>[0]): void => cb(status)
    ipcRenderer.on('update-status', listener)
    return () => ipcRenderer.removeListener('update-status', listener)
  },
  server: {
    getState: () => invoke('server:getState'),
    setEnabled: (value: boolean) => invoke('server:setEnabled', value),
    setPort: (port: number) => invoke('server:setPort', port),
    getPins: () => invoke('server:getPins'),
    setPins: (pins: ServerPins) => invoke('server:setPins', pins),
    connectQr: () => invoke('server:connectQr')
  },
  onServerStatus: (cb) => {
    const listener = (_e: unknown, status: Parameters<typeof cb>[0]): void => cb(status)
    ipcRenderer.on('server-status', listener)
    return () => ipcRenderer.removeListener('server-status', listener)
  },
  configs: {
    list: () => invoke('configs:list'),
    create: (input: HostConfigInput) => invoke('configs:create', input),
    update: (id: number, input: HostConfigInput) => invoke('configs:update', id, input),
    remove: (id: number) => invoke('configs:remove', id),
    generate: (id: number) => invoke('configs:generate', id),
    exportJson: (id: number) => invoke('configs:exportJson', id)
  },
  orders: {
    list: () => invoke('orders:list'),
    create: (input: ShopOrderInput) => invoke('orders:create', input),
    update: (id: number, input: ShopOrderInput) => invoke('orders:update', id, input),
    remove: (id: number) => invoke('orders:remove', id)
  },
  labels: {
    list: () => invoke('labels:list'),
    create: (input: LabelTemplateInput) => invoke('labels:create', input),
    update: (id: number, input: LabelTemplateInput) => invoke('labels:update', id, input),
    remove: (id: number) => invoke('labels:remove', id),
    print: (id: number, copies: number) => invoke('labels:print', id, copies),
    printCases: (templateId: number, caseIds: number[]) =>
      invoke('labels:printCases', templateId, caseIds)
  },
  cases: {
    list: () => invoke('cases:list'),
    create: (input: PackCaseInput) => invoke('cases:create', input),
    update: (id: number, input: PackCaseInput) => invoke('cases:update', id, input),
    remove: (id: number) => invoke('cases:remove', id)
  },
  circuits: {
    list: () => invoke('circuits:list'),
    setStatus: (id: number, input: CircuitStatusInput) =>
      invoke('circuits:setStatus', id, input),
    import: () => invoke('circuits:import'),
    clear: () => invoke('circuits:clear')
  },
  orderFormats: {
    list: () => invoke('orderFormats:list'),
    create: (input: OrderExportFormatInput) => invoke('orderFormats:create', input),
    update: (id: number, input: OrderExportFormatInput) =>
      invoke('orderFormats:update', id, input),
    remove: (id: number) => invoke('orderFormats:remove', id)
  },
  orderKits: {
    list: () => invoke('orderKits:list'),
    create: (input: OrderKitInput) => invoke('orderKits:create', input),
    update: (id: number, input: OrderKitInput) => invoke('orderKits:update', id, input),
    remove: (id: number) => invoke('orderKits:remove', id)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
