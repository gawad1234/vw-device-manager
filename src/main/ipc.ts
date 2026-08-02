import { ipcMain } from 'electron'
import * as repo from './repository'
import type { DeviceInput, PortInput, SubnetInput } from '../shared/types'

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

  ipcMain.handle('signals:list', () => repo.listNetworkSignals())
  ipcMain.handle('signals:add', (_e, signal: string) => repo.addNetworkSignal(signal))
  ipcMain.handle('signals:remove', (_e, signal: string) => repo.removeNetworkSignal(signal))
}
