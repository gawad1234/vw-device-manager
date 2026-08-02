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

/** One network jack on a device. IP lives here (per-port); MAC is device-level. */
export interface Port {
  id: number
  deviceId: number
  label: string
  ipAddress: string | null
  /** the port's untagged/native network */
  untaggedSubnetId: number | null
  /** tagged VLANs trunked on this port (subnet ids) */
  taggedSubnetIds: number[]
  /** ties this port to its ConnectCAD jack; null = added by hand in the app */
  vwSocketKey: string | null
}

/** Editable port fields. deviceId is passed to create(); tagged VLANs are set
 *  via ports.setTaggedVlans. vwSocketKey is managed by the VW scripts. */
export interface PortInput {
  label: string
  ipAddress: string | null
  untaggedSubnetId: number | null
}

export interface Device {
  id: number
  name: string
  deviceType: string | null
  macAddress: string | null
  location: string | null
  notes: string | null
  /** Network switch? Switches have no per-port IP; they use the two IPs below
   *  and their ports are VLAN-only (untagged + optional tagged/trunk). */
  isSwitch: boolean
  /** device-level management IP (switches only) */
  managementIp: string | null
  /** device-level out-of-band (OOB) IP (switches only) */
  oobIp: string | null
  createdAt: string
  updatedAt: string
  ports: Port[]
}

export type DeviceInput = Omit<Device, 'id' | 'createdAt' | 'updatedAt' | 'ports'>

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

export interface SavePortResult {
  port: Port | null
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
  ports: {
    create: (deviceId: number, input: PortInput) => Promise<SavePortResult>
    update: (id: number, input: PortInput) => Promise<SavePortResult>
    remove: (id: number) => Promise<void>
    setTaggedVlans: (id: number, subnetIds: number[]) => Promise<void>
  }
  /** ConnectCAD socket "signal" values the sync scripts treat as network ports. */
  networkSignals: {
    list: () => Promise<string[]>
    add: (signal: string) => Promise<string[]>
    remove: (signal: string) => Promise<string[]>
  }
}
