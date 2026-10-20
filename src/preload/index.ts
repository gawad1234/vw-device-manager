import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  BundleInput,
  CableInput,
  CableTypeInput,
  CircuitStatusInput,
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
  ServerPins,
  ShopOrderInput,
  SubnetInput,
  VwDeviceManagerApi
} from '../shared/types'

// Custom APIs for renderer
const api: VwDeviceManagerApi = {
  subnets: {
    list: () => ipcRenderer.invoke('subnets:list'),
    create: (input: SubnetInput) => ipcRenderer.invoke('subnets:create', input),
    update: (id: number, input: SubnetInput) => ipcRenderer.invoke('subnets:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('subnets:remove', id)
  },
  devices: {
    list: () => ipcRenderer.invoke('devices:list'),
    create: (input: DeviceInput) => ipcRenderer.invoke('devices:create', input),
    update: (id: number, input: DeviceInput) => ipcRenderer.invoke('devices:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('devices:remove', id),
    setWallpaper: (id: number, config: WallpaperConfig | null) =>
      ipcRenderer.invoke('devices:setWallpaper', id, config)
  },
  wallpapers: {
    save: (files: { name: string; dataUrl: string }[]) =>
      ipcRenderer.invoke('wallpapers:save', files)
  },
  ports: {
    create: (deviceId: number, input: PortInput) =>
      ipcRenderer.invoke('ports:create', deviceId, input),
    update: (id: number, input: PortInput) => ipcRenderer.invoke('ports:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('ports:remove', id),
    setTaggedVlans: (id: number, subnetIds: number[]) =>
      ipcRenderer.invoke('ports:setTaggedVlans', id, subnetIds),
    setPrimary: (id: number, isPrimary: boolean) =>
      ipcRenderer.invoke('ports:setPrimary', id, isPrimary),
    setUnused: (id: number, isUnused: boolean) =>
      ipcRenderer.invoke('ports:setUnused', id, isUnused),
    setLag: (id: number, lagGroup: string | null) =>
      ipcRenderer.invoke('ports:setLag', id, lagGroup)
  },
  networkSignals: {
    list: () => ipcRenderer.invoke('signals:list'),
    add: (signal: string) => ipcRenderer.invoke('signals:add', signal),
    remove: (signal: string) => ipcRenderer.invoke('signals:remove', signal)
  },
  bundles: {
    list: () => ipcRenderer.invoke('bundles:list'),
    create: (input: BundleInput) => ipcRenderer.invoke('bundles:create', input),
    update: (id: number, input: BundleInput) => ipcRenderer.invoke('bundles:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('bundles:remove', id),
    duplicate: (id: number) => ipcRenderer.invoke('bundles:duplicate', id)
  },
  cables: {
    create: (bundleId: number, input: CableInput) =>
      ipcRenderer.invoke('cables:create', bundleId, input),
    update: (id: number, input: CableInput) => ipcRenderer.invoke('cables:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('cables:remove', id)
  },
  cableTypes: {
    list: () => ipcRenderer.invoke('cableTypes:list'),
    add: (input: CableTypeInput) => ipcRenderer.invoke('cableTypes:add', input),
    remove: (name: string) => ipcRenderer.invoke('cableTypes:remove', name)
  },
  deviceCategories: {
    list: () => ipcRenderer.invoke('deviceCategories:list'),
    add: (name: string) => ipcRenderer.invoke('deviceCategories:add', name),
    remove: (name: string) => ipcRenderer.invoke('deviceCategories:remove', name)
  },
  projects: {
    current: () => ipcRenderer.invoke('project:current'),
    recent: () => ipcRenderer.invoke('project:recent'),
    new: () => ipcRenderer.invoke('project:new'),
    open: () => ipcRenderer.invoke('project:open'),
    openRecent: (path: string) => ipcRenderer.invoke('project:openRecent', path),
    saveCopyAs: () => ipcRenderer.invoke('project:saveCopyAs'),
    reveal: () => ipcRenderer.invoke('project:reveal')
  },
  onDataChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('data-changed', listener)
    return () => ipcRenderer.removeListener('data-changed', listener)
  },
  exports: {
    run: (opts: ExportOptions) => ipcRenderer.invoke('export:run', opts)
  },
  showLogo: {
    get: () => ipcRenderer.invoke('showLogo:get'),
    set: (dataUrl: string | null) => ipcRenderer.invoke('showLogo:set', dataUrl)
  },
  showName: {
    get: () => ipcRenderer.invoke('showName:get'),
    set: (name: string | null) => ipcRenderer.invoke('showName:set', name)
  },
  companyLogo: {
    get: () => ipcRenderer.invoke('companyLogo:get'),
    set: (dataUrl: string | null) => ipcRenderer.invoke('companyLogo:set', dataUrl)
  },
  companyName: {
    get: () => ipcRenderer.invoke('companyName:get'),
    set: (name: string | null) => ipcRenderer.invoke('companyName:set', name)
  },
  switchConfig: {
    get: () => ipcRenderer.invoke('switchConfig:get'),
    set: (input: SwitchConfigSettings) => ipcRenderer.invoke('switchConfig:set', input)
  },
  updates: {
    getState: () => ipcRenderer.invoke('updates:getState'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    getAutoCheck: () => ipcRenderer.invoke('updates:getAutoCheck'),
    setAutoCheck: (value: boolean) => ipcRenderer.invoke('updates:setAutoCheck', value)
  },
  onUpdateStatus: (cb) => {
    const listener = (_e: unknown, status: Parameters<typeof cb>[0]): void => cb(status)
    ipcRenderer.on('update-status', listener)
    return () => ipcRenderer.removeListener('update-status', listener)
  },
  server: {
    getState: () => ipcRenderer.invoke('server:getState'),
    setEnabled: (value: boolean) => ipcRenderer.invoke('server:setEnabled', value),
    setPort: (port: number) => ipcRenderer.invoke('server:setPort', port),
    getPins: () => ipcRenderer.invoke('server:getPins'),
    setPins: (pins: ServerPins) => ipcRenderer.invoke('server:setPins', pins),
    connectQr: () => ipcRenderer.invoke('server:connectQr')
  },
  onServerStatus: (cb) => {
    const listener = (_e: unknown, status: Parameters<typeof cb>[0]): void => cb(status)
    ipcRenderer.on('server-status', listener)
    return () => ipcRenderer.removeListener('server-status', listener)
  },
  configs: {
    list: () => ipcRenderer.invoke('configs:list'),
    create: (input: HostConfigInput) => ipcRenderer.invoke('configs:create', input),
    update: (id: number, input: HostConfigInput) => ipcRenderer.invoke('configs:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('configs:remove', id),
    generate: (id: number) => ipcRenderer.invoke('configs:generate', id),
    exportJson: (id: number) => ipcRenderer.invoke('configs:exportJson', id)
  },
  orders: {
    list: () => ipcRenderer.invoke('orders:list'),
    create: (input: ShopOrderInput) => ipcRenderer.invoke('orders:create', input),
    update: (id: number, input: ShopOrderInput) => ipcRenderer.invoke('orders:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('orders:remove', id)
  },
  labels: {
    list: () => ipcRenderer.invoke('labels:list'),
    create: (input: LabelTemplateInput) => ipcRenderer.invoke('labels:create', input),
    update: (id: number, input: LabelTemplateInput) => ipcRenderer.invoke('labels:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('labels:remove', id),
    print: (id: number, copies: number) => ipcRenderer.invoke('labels:print', id, copies),
    printCases: (templateId: number, caseIds: number[]) =>
      ipcRenderer.invoke('labels:printCases', templateId, caseIds)
  },
  cases: {
    list: () => ipcRenderer.invoke('cases:list'),
    create: (input: PackCaseInput) => ipcRenderer.invoke('cases:create', input),
    update: (id: number, input: PackCaseInput) => ipcRenderer.invoke('cases:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('cases:remove', id)
  },
  circuits: {
    list: () => ipcRenderer.invoke('circuits:list'),
    setStatus: (id: number, input: CircuitStatusInput) =>
      ipcRenderer.invoke('circuits:setStatus', id, input),
    import: () => ipcRenderer.invoke('circuits:import'),
    clear: () => ipcRenderer.invoke('circuits:clear')
  },
  orderFormats: {
    list: () => ipcRenderer.invoke('orderFormats:list'),
    create: (input: OrderExportFormatInput) => ipcRenderer.invoke('orderFormats:create', input),
    update: (id: number, input: OrderExportFormatInput) =>
      ipcRenderer.invoke('orderFormats:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('orderFormats:remove', id)
  },
  orderKits: {
    list: () => ipcRenderer.invoke('orderKits:list'),
    create: (input: OrderKitInput) => ipcRenderer.invoke('orderKits:create', input),
    update: (id: number, input: OrderKitInput) => ipcRenderer.invoke('orderKits:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('orderKits:remove', id)
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
