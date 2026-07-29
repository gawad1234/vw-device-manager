export interface Subnet {
  id: number
  name: string
  cidr: string
  vlan: string | null
  gateway: string | null
  notes: string | null
  createdAt: string
}

export type SubnetInput = Omit<Subnet, 'id' | 'createdAt'>

export interface Device {
  id: number
  name: string
  deviceType: string | null
  ipAddress: string | null
  macAddress: string | null
  subnetId: number | null
  location: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type DeviceInput = Omit<Device, 'id' | 'createdAt' | 'updatedAt'>

export interface DeviceWarning {
  type: 'ip-conflict' | 'ip-outside-subnet' | 'invalid-ip'
  message: string
}

export interface SaveDeviceResult {
  device: Device | null
  warnings: DeviceWarning[]
  /** set when the save was rejected outright (e.g. duplicate IP) */
  error?: string
}

export interface VwDeviceManagerApi {
  subnets: {
    list: () => Promise<Subnet[]>
    create: (input: SubnetInput) => Promise<Subnet>
    update: (id: number, input: SubnetInput) => Promise<Subnet>
    remove: (id: number) => Promise<void>
  }
  devices: {
    list: () => Promise<Device[]>
    create: (input: DeviceInput) => Promise<SaveDeviceResult>
    update: (id: number, input: DeviceInput) => Promise<SaveDeviceResult>
    remove: (id: number) => Promise<void>
  }
}
