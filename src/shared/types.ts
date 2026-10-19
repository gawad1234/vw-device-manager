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
  /** a jack not used for the network — hidden from schedules/labels/VW sync */
  isUnused: boolean
  /** free-text LAG name; switch ports sharing it form one logical link (manual) */
  lagGroup: string | null
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
  /** required for `order` / `receiving` docs */
  orderId?: number
  doc: 'pullsheet' | 'schedule' | 'labels' | 'ipschedule' | 'devicelist' | 'order' | 'receiving'
  format: 'pdf' | 'xlsx' | 'csv'
  labelStyle?: 'cards' | 'flag'
  /** order/receiving: color new/changed rows vs. the last export + add a Change column */
  highlightChanges?: boolean
  /** order/receiving: which saved export-format template to apply (null = built-in default) */
  formatId?: number
}

// ---- Shop-order export format templates -----------------------------------

/** The columns a shop-order export can show, in a stable key set. */
export type OrderColumnKey =
  | 'category'
  | 'item'
  | 'manufacturer'
  | 'model'
  | 'requested'
  | 'received'
  | 'outstanding'
  | 'notes'

/** One column in an export-format template (array order = print order). */
export interface OrderColumn {
  key: OrderColumnKey
  show: boolean
  /** relative width weight for the PDF, and the character width in Excel */
  width: number
}

/** A reusable "order type" format: which columns, how wide, grouping + layout. */
export interface OrderExportFormat {
  id: number
  name: string
  columns: OrderColumn[]
  /** PDF: a section per category; CSV/Excel: a leading Category column + sort */
  groupByCategory: boolean
  sort: 'category' | 'name' | 'outstanding'
  orientation: 'portrait' | 'landscape'
  density: 'compact' | 'normal' | 'large'
  createdAt: string
  updatedAt: string
}

export type OrderExportFormatInput = Omit<OrderExportFormat, 'id' | 'createdAt' | 'updatedAt'>

/** One companion line a kit adds. Equipment add-ons use name/manufacturer/model/
 *  category; cable add-ons use cableType/length. `perUnit` is how many to add per
 *  matched unit of the trigger item. */
export interface KitAddon {
  kind: 'equipment' | 'cable'
  name: string
  manufacturer: string | null
  modelNumber: string | null
  category: string | null
  cableType: string
  length: string
  perUnit: number
}

/** A reusable "when you add X, also add these" rule for shop orders. The trigger
 *  is matched (case-insensitive) against an order item's name OR model number. */
export interface OrderKit {
  id: number
  trigger: string
  addons: KitAddon[]
  createdAt: string
  updatedAt: string
}

export type OrderKitInput = Omit<OrderKit, 'id' | 'createdAt' | 'updatedAt'>

/** Display label + default width for each order column (shared by the editor). */
export const ORDER_COLUMN_META: Record<OrderColumnKey, { label: string; width: number }> = {
  category: { label: 'Category', width: 16 },
  item: { label: 'Item', width: 28 },
  manufacturer: { label: 'Manufacturer', width: 18 },
  model: { label: 'Model', width: 18 },
  requested: { label: 'Requested', width: 10 },
  received: { label: 'Received', width: 10 },
  outstanding: { label: 'Outstanding', width: 10 },
  notes: { label: 'Notes', width: 24 }
}

/** A fresh column set for a new format (sensible defaults, all common ones on). */
export function defaultOrderColumns(): OrderColumn[] {
  const on = new Set<OrderColumnKey>([
    'item',
    'manufacturer',
    'model',
    'requested',
    'received',
    'outstanding',
    'notes'
  ])
  return (Object.keys(ORDER_COLUMN_META) as OrderColumnKey[]).map((key) => ({
    key,
    show: on.has(key),
    width: ORDER_COLUMN_META[key].width
  }))
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

// ---- Show Server (LAN web server) -----------------------------------------

/** State of the embedded LAN web server, pushed on every change and returned by
 *  server.getState(). */
export interface ServerStatus {
  /** is the HTTP server currently listening */
  running: boolean
  /** persisted per-machine preference: auto-start on launch + stay on */
  enabled: boolean
  /** the TCP port it listens on */
  port: number
  /** reachable URLs — one per non-internal IPv4 LAN interface */
  urls: string[]
  /** how many distinct sessions are currently signed in */
  clientCount: number
  /** human-readable message when the server failed to start */
  error: string | null
}

/** The two show-level access PINs (blank crew PIN = crew area is open). */
export interface ServerPins {
  crew: string
  manager: string
}

// ---- Host VLAN config generator -------------------------------------------

/** One network on a host NIC config (mirrors the PowerShell $DefaultVlans entry). */
export interface VlanEntry {
  name: string
  vlanId: number
  /** false for the ONE untagged/native network; true for tagged VLANs */
  tagged: boolean
  /** use DHCP (the IP fields are ignored when true) */
  dhcp: boolean
  ipAddress: string | null
  prefixLength: number
  gateway: string | null
  dnsServers: string[]
}

/** A saved host configuration → a generated PowerShell VLAN-trunk script. */
export interface HostConfig {
  id: number
  name: string
  /** the Hyper-V external switch name (script default) */
  switchName: string
  vlans: VlanEntry[]
  createdAt: string
  updatedAt: string
}

export type HostConfigInput = Omit<HostConfig, 'id' | 'createdAt' | 'updatedAt'>

// ---- Patching (ConnectCAD circuit report) ---------------------------------

/** One cable/circuit from a Vectorworks ConnectCAD "Circuit Report": a run from
 *  a source device+socket to a destination device+socket. The geometry/identity
 *  fields come from the imported report; patched/tested/notes are tracked here
 *  (the drawing is the source of truth for which circuits exist). */
export interface Circuit {
  id: number
  /** the report's cable Number (e.g. U9002); may be blank for some circuits */
  cableNumber: string
  /** signal type: LAN, 3GV, HDMI, KVM NET, PWR, USB, OPT, … */
  signal: string
  /** estimated length as the report gives it ("---", "150", …) */
  estLength: string
  srcName: string
  srcSocket: string
  srcConnector: string
  srcRack: string
  srcRackU: string
  srcSlot: string
  dstName: string
  dstSocket: string
  dstConnector: string
  dstRack: string
  dstRackU: string
  dstSlot: string
  /** source end physically patched */
  srcPatched: boolean
  /** destination end physically patched */
  dstPatched: boolean
  /** signal confirmed / verified end-to-end (implies both ends patched) */
  tested: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
}

/** The crew-editable status on a circuit. The repository enforces the rule that
 *  `tested` implies both ends patched, and that un-patching an end clears
 *  `tested` — so callers can send intent and trust the normalized result. */
export interface CircuitStatusInput {
  srcPatched: boolean
  dstPatched: boolean
  tested: boolean
  notes: string | null
}

/** Summary returned after importing a circuit report. */
export interface CircuitImportResult {
  added: number
  updated: number
  removed: number
  total: number
}

// ---- Shop orders (equipment purchasing / receiving) -----------------------

/** One line on a shop order: a piece of equipment, how many were ordered, and
 *  how many have arrived. Outstanding = quantity - received. */
export interface OrderItem {
  name: string
  manufacturer: string | null
  modelNumber: string | null
  /** grouping, from the shared device-category list */
  category: string | null
  quantity: number
  received: number
  notes: string | null
}

/** A cable line on an order: a type at a specific length, with a quantity. */
export interface CableOrderItem {
  cableType: string
  length: string
  quantity: number
  received: number
  notes: string | null
}

export interface ShopOrder {
  id: number
  /** order name or number */
  name: string
  /** supplier / where it's coming from */
  vendor: string | null
  /** free-form order date */
  orderDate: string | null
  notes: string | null
  items: OrderItem[]
  /** cable lines (type · length · quantity), kept separate from equipment */
  cables: CableOrderItem[]
  /** when this order was last exported (for the change-highlight baseline) */
  lastExportAt: string | null
  createdAt: string
  updatedAt: string
}

export type ShopOrderInput = Omit<ShopOrder, 'id' | 'createdAt' | 'updatedAt' | 'lastExportAt'>

// ---- Case label templates (Uline S-19323, 8.5" x 5.5", 2-up) --------------

/** One user-defined field on a case label: a caption + its value. (legacy layout) */
export interface LabelField {
  label: string
  value: string
}

/** A freely-positioned element on the label canvas. Geometry is in INCHES on
 *  the 8.5" x 5.5" label (origin top-left). */
export interface LabelElement {
  id: string
  /** text/rect/line are freeform; showname/logo bind to the project's show name + logo */
  type: 'text' | 'rect' | 'line' | 'showname' | 'logo'
  x: number
  y: number
  w: number
  h: number
  /** text elements */
  text?: string
  fontSize?: number // points
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  /** vertical alignment of text within its box (default 'top') */
  valign?: 'top' | 'middle' | 'bottom'
  /** wrap long lines inside the box (default true); false = single line, clipped */
  wrap?: boolean
  /** shrink text to fit the box when it's too big (never grows past fontSize) */
  autoSize?: boolean
  /** text color / line color / rect border color */
  color?: string | null
  /** rect fill (null = transparent) */
  fill?: string | null
  /** rect border / line thickness, in points */
  borderWidth?: number
}

export interface LabelTemplate {
  id: number
  /** template name (not printed) */
  name: string
  /** the big line printed on the label (legacy fixed layout) */
  title: string
  /** hex color for the accent band; null = none (legacy fixed layout) */
  color: string | null
  /** print the project's show name along the top (legacy fixed layout) */
  showName: boolean
  /** legacy fixed-layout fields (used only when `elements` is empty) */
  fields: LabelField[]
  /** freeform layout — when non-empty, this is what prints */
  elements: LabelElement[]
  createdAt: string
  updatedAt: string
}

export type LabelTemplateInput = Omit<LabelTemplate, 'id' | 'createdAt' | 'updatedAt'>

// ---- Cases (what's packed in each case) -----------------------------------

/** A key/value detail on a case (e.g. Truck # = 12). */
export interface CaseField {
  label: string
  value: string
}

/** A physical case and what's packed in it. Prints to a label via a template:
 *  template text tokens {Case}, {Contents}, {Show}, or {FieldName} are filled in. */
export interface PackCase {
  id: number
  name: string
  fields: CaseField[]
  /** what's inside (free text, one item per line) */
  contents: string
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type PackCaseInput = Omit<PackCase, 'id' | 'createdAt' | 'updatedAt'>

/** A sub-editor row's save, called by a modal's "Save changes" so it flushes
 *  every child row (ports/cables), not just the top-level fields. */
export type RowSaver = () => Promise<{ ok: boolean; error?: string }>

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
    /** flag this jack as not used for the network (or restore it) */
    setUnused: (id: number, isUnused: boolean) => Promise<void>
    /** set/clear the LAG name grouping switch ports into one logical link */
    setLag: (id: number, lagGroup: string | null) => Promise<void>
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
    /** copy a bundle + its cables into a new "(copy)" bundle */
    duplicate: (id: number) => Promise<Bundle | null>
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
  /** The embedded LAN "Show Server" that crew reach from their own devices.
   *  enabled is a per-machine preference (which computer is the server); the
   *  crew/manager PINs are per-show (stored in the project). */
  server: {
    getState: () => Promise<ServerStatus>
    /** turn the server on/off (persists the preference + starts/stops now) */
    setEnabled: (value: boolean) => Promise<ServerStatus>
    /** change the port (persists + restarts if running) */
    setPort: (port: number) => Promise<ServerStatus>
    getPins: () => Promise<ServerPins>
    setPins: (pins: ServerPins) => Promise<void>
    /** a PNG data-URL QR of the primary connect URL (null when not running) */
    connectQr: () => Promise<string | null>
  }
  /** Fires whenever the server status changes. Returns an unsubscribe fn. */
  onServerStatus: (cb: (status: ServerStatus) => void) => () => void
  /** Saved host VLAN configs + generating their PowerShell scripts. */
  configs: {
    list: () => Promise<HostConfig[]>
    create: (input: HostConfigInput) => Promise<HostConfig>
    update: (id: number, input: HostConfigInput) => Promise<HostConfig>
    remove: (id: number) => Promise<void>
    /** generate the .ps1 for this config and save it (returns path, or null if cancelled) */
    generate: (id: number) => Promise<string | null>
    /** export the VLAN list as JSON for the host VlanManager tool (returns path, or null) */
    exportJson: (id: number) => Promise<string | null>
  }
  /** Shop orders: equipment purchasing + receiving tracking. */
  orders: {
    list: () => Promise<ShopOrder[]>
    create: (input: ShopOrderInput) => Promise<ShopOrder>
    update: (id: number, input: ShopOrderInput) => Promise<ShopOrder>
    remove: (id: number) => Promise<void>
  }
  /** Reusable export-format templates for shop-order / receiving documents. */
  orderFormats: {
    list: () => Promise<OrderExportFormat[]>
    create: (input: OrderExportFormatInput) => Promise<OrderExportFormat>
    update: (id: number, input: OrderExportFormatInput) => Promise<OrderExportFormat>
    remove: (id: number) => Promise<void>
  }
  /** Auto-add kits: adding an item matching a kit's trigger pulls its companions. */
  orderKits: {
    list: () => Promise<OrderKit[]>
    create: (input: OrderKitInput) => Promise<OrderKit>
    update: (id: number, input: OrderKitInput) => Promise<OrderKit>
    remove: (id: number) => Promise<void>
  }
  /** Case label templates → printed 2-up on Uline S-19323 (8.5"x5.5") sheets. */
  labels: {
    list: () => Promise<LabelTemplate[]>
    create: (input: LabelTemplateInput) => Promise<LabelTemplate>
    update: (id: number, input: LabelTemplateInput) => Promise<LabelTemplate>
    remove: (id: number) => Promise<void>
    /** render `copies` of the label to a PDF and save it (returns path, or null) */
    print: (id: number, copies: number) => Promise<string | null>
    /** print one label per case (filling the template's {tokens}); caseIds empty = all */
    printCases: (templateId: number, caseIds: number[]) => Promise<string | null>
  }
  /** Cases manager: organize what's packed in each case. */
  cases: {
    list: () => Promise<PackCase[]>
    create: (input: PackCaseInput) => Promise<PackCase>
    update: (id: number, input: PackCaseInput) => Promise<PackCase>
    remove: (id: number) => Promise<void>
  }
  /** Patching: circuits imported from a ConnectCAD circuit report, with
   *  per-circuit patched/tested/notes tracking. */
  circuits: {
    list: () => Promise<Circuit[]>
    setStatus: (id: number, input: CircuitStatusInput) => Promise<Circuit>
    /** open a file dialog, import a circuit-report CSV, merge, return a summary */
    import: () => Promise<CircuitImportResult | null>
    /** remove all circuits (start over) */
    clear: () => Promise<void>
  }
}
