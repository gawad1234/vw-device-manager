import { ipcMain } from 'electron'
import * as repo from './repository'
import * as projects from './projects'
import * as library from './library'
import type {
  BundleInput,
  CableInput,
  CableTypeInput,
  DeviceInput,
  PortInput,
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

  ipcMain.handle('project:current', () => projects.getCurrentProject())
  ipcMain.handle('project:recent', () => projects.listRecent())
  ipcMain.handle('project:new', () => projects.newProject())
  ipcMain.handle('project:open', () => projects.openProject())
  ipcMain.handle('project:openRecent', (_e, path: string) => projects.openProjectPath(path))
  ipcMain.handle('project:saveCopyAs', () => projects.saveCopyAs())
  ipcMain.handle('project:reveal', () => projects.revealCurrent())
}
