import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  BundleInput,
  CableInput,
  CableTypeInput,
  DeviceInput,
  ExportOptions,
  PortInput,
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
    remove: (id: number) => ipcRenderer.invoke('devices:remove', id)
  },
  ports: {
    create: (deviceId: number, input: PortInput) =>
      ipcRenderer.invoke('ports:create', deviceId, input),
    update: (id: number, input: PortInput) => ipcRenderer.invoke('ports:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('ports:remove', id),
    setTaggedVlans: (id: number, subnetIds: number[]) =>
      ipcRenderer.invoke('ports:setTaggedVlans', id, subnetIds),
    setPrimary: (id: number, isPrimary: boolean) =>
      ipcRenderer.invoke('ports:setPrimary', id, isPrimary)
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
    remove: (id: number) => ipcRenderer.invoke('bundles:remove', id)
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
