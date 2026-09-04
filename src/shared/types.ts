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
  /** the device's designated "main" access route (at most one per device) —
   *  used as the device's main IP/VLAN in the Device list export */
  isPrimary: boolean
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
  /** user-assigned grouping (from the shared category list); null = uncategorized */
  category: string | null
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

// ---- Cable bundle manager -------------------------------------------------

/** A cable-type catalog entry (Cat6, Fiber SM, XLR, …). Lives in the shared
 *  library (universal across projects), keyed by name. */
export interface CableType {
  name: string
  notes: string | null
}

export type CableTypeInput = CableType

/** One end of a cable: a linked device (optionally a specific port), or free
 *  text when the device isn't in the app. Prefer the link for display. */
export interface CableEndpoint {
  deviceId: number | null
  portId: number | null
  text: string | null
}

export interface Cable {
  id: number
  bundleId: number
  name: string
  /** cable type by name, from the shared library (null = untyped) */
  cableType: string | null
  source: CableEndpoint
  destination: CableEndpoint
  /** install check sheet */
  pulled: boolean
  labeled: boolean
  notes: string | null
}

/** Editable cable fields. bundleId is passed to create(). */
export type CableInput = Omit<Cable, 'id' | 'bundleId'>

/** A group of cables that physically travel together (conduit/tray/snake). */
export interface Bundle {
  id: number
  name: string
  /** hex color code for visual bundle coding (e.g. "#e0685f"); null = none */
  color: string | null
  fromLocation: string | null
  toLocation: string | null
  /** length of the run — shared by every cable in the bundle */
  length: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  cables: Cable[]
}

export type BundleInput = Omit<Bundle, 'id' | 'createdAt' | 'updatedAt' | 'cables'>

/** An open-able project database. `name` is the file basename without extension. */
export interface ProjectInfo {
  path: string
  name: string
}

/** What to export and how. `bundleId` is required when `scope === 'bundle'`.
 *  `labelStyle` only applies when `doc === 'labels'`. */
export interface ExportOptions {
  scope: 'bundle' | 'all'
  bundleId?: number
  doc: 'pullsheet' | 'schedule' | 'labels' | 'ipschedule' | 'devicelist'
  format: 'pdf' | 'xlsx' | 'csv'
  labelStyle?: 'cards' | 'flag'
}

// ---- App updates ----------------------------------------------------------

/** Where the update flow currently is. Drives the Settings → Updates panel. */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/** A release newer than the running app (from the GitHub Releases feed). */
export interface UpdateInfo {
  version: string
  /** the GitHub release body as HTML (the patch notes); null if none supplied */
  releaseNotes: string | null
  /** ISO date string, if the feed provided one */
  releaseDate: string | null
}

/** Full snapshot the renderer renders — pushed on every state change and
 *  returned by updates.getState()/check(). */
export interface UpdateStatus {
  phase: UpdatePhase
  /** the version the app is currently running */
  currentVersion: string
  /** the available/downloaded update when phase says there is one */
  info: UpdateInfo | null
  /** human-readable message when phase === 'error' */
  error: string | null
  /** download progress 0–100 (Windows self-install only) */
  percent: number | null
  /** true on Windows (can download + restart-to-install); false on unsigned
   *  macOS (we open the download page instead) */
  canSelfInstall: boolean
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
    /** mark this port the device's main access route (or clear it) */
    setPrimary: (id: number, isPrimary: boolean) => Promise<void>
  }
  /** ConnectCAD socket "signal" values the sync scripts treat as network ports. */
  networkSignals: {
    list: () => Promise<string[]>
    add: (signal: string) => Promise<string[]>
    remove: (signal: string) => Promise<string[]>
  }
  bundles: {
    list: () => Promise<Bundle[]>
    create: (input: BundleInput) => Promise<Bundle>
    update: (id: number, input: BundleInput) => Promise<Bundle>
    remove: (id: number) => Promise<void>
  }
  cables: {
    create: (bundleId: number, input: CableInput) => Promise<Cable>
    update: (id: number, input: CableInput) => Promise<Cable>
    remove: (id: number) => Promise<void>
  }
  /** Shared cable-type library (universal across projects). */
  cableTypes: {
    list: () => Promise<CableType[]>
    add: (input: CableTypeInput) => Promise<CableType[]>
    remove: (name: string) => Promise<CableType[]>
  }
  /** Shared device-category list (universal across projects) for grouping devices. */
  deviceCategories: {
    list: () => Promise<string[]>
    add: (name: string) => Promise<string[]>
    remove: (name: string) => Promise<string[]>
  }
  /** Project files: one project (database) is active at a time; these switch it.
   *  A null result means the user cancelled the dialog. */
  projects: {
    current: () => Promise<ProjectInfo | null>
    recent: () => Promise<ProjectInfo[]>
    new: () => Promise<ProjectInfo | null>
    open: () => Promise<ProjectInfo | null>
    openRecent: (path: string) => Promise<ProjectInfo | null>
    saveCopyAs: () => Promise<ProjectInfo | null>
    reveal: () => Promise<void>
  }
  /** Fires when another process (a Vectorworks script) writes to the open
   *  project file, so the UI can auto-refresh. Returns an unsubscribe fn. */
  onDataChanged: (cb: () => void) => () => void
  /** Export bundles/cables to a file; returns the saved path (or null if the
   *  user cancelled the save dialog). Opens the file after saving. */
  exports: {
    run: (opts: ExportOptions) => Promise<string | null>
  }
  /** Per-project (per-show) logo, a data URL stamped onto paperwork. */
  showLogo: {
    get: () => Promise<string | null>
    set: (dataUrl: string | null) => Promise<void>
  }
  /** Per-project (per-show) name, stamped onto paperwork headers/footers. */
  showName: {
    get: () => Promise<string | null>
    set: (name: string | null) => Promise<void>
  }
  /** App auto-update, surfaced in Settings → Updates. `check` triggers a check
   *  and resolves with the resulting status; live changes also arrive via
   *  onUpdateStatus. `download` self-downloads on Windows / opens the Releases
   *  page on macOS; `install` restarts to apply (Windows only). autoCheck is a
   *  per-machine preference (checks on launch when true). */
  updates: {
    getState: () => Promise<UpdateStatus>
    check: () => Promise<UpdateStatus>
    download: () => Promise<void>
    install: () => Promise<void>
    getAutoCheck: () => Promise<boolean>
    setAutoCheck: (value: boolean) => Promise<boolean>
  }
  /** Fires whenever the update status changes. Returns an unsubscribe fn. */
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void
}
