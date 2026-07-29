import { ElectronAPI } from '@electron-toolkit/preload'
import type { VwDeviceManagerApi } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: VwDeviceManagerApi
  }
}
