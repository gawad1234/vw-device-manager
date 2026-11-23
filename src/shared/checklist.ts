// Provisioning checklists: one sheet per device, built from an editable step library
// (library.json → checklistSteps). A step only appears when the device has the data its
// trigger reads, so a sheet never carries empty steps. Pure: tests import it.

/** Fixed order; a phase with no steps on a device is left off its sheet. */
export const PHASES = [
  'Receive & inspect',
  'Firmware / OS / software',
  'Display & output',
  'Network',
  'Device-specific config',
  'Labeling',
  'Burn-in / test',
  'Rack install',
  'Final sign-off'
] as const

/** What a step needs from the device to appear; most give one line per item. */
export const TRIGGERS = {
  always: { label: 'Always', fields: [] },
  location: { label: 'Has a location', fields: [] },
  mac: { label: 'Has a MAC address', fields: ['mac'] },
  ports: {
    label: 'Per port with IP / VLAN',
    fields: ['port', 'ip', 'network', 'vlan', 'tagged']
  },
  switchIps: { label: 'Switch Mgmt / OOB IP', fields: ['mgmtIp', 'oobIp'] },
  software: { label: 'Per software install', fields: ['software'] },
  projector: { label: 'Has projector settings', fields: ['model', 'settings'] },
  wallpaper: { label: 'Has wallpaper displays', fields: ['displays'] },
  patch: {
    label: 'Per patch connection',
    fields: ['direction', 'socket', 'other', 'cable', 'signal']
  },
  rack: { label: 'Per rack position', fields: ['rack'] }
} as const satisfies Record<string, { label: string; fields: readonly string[] }>

export type ChecklistTrigger = keyof typeof TRIGGERS

/** Every sheet line also knows these. */
export const BASE_FIELDS = ['device', 'category', 'location'] as const

export type Signoff = 'check' | 'initials' | 'value'
export const SIGNOFFS: Record<Signoff, string> = {
  check: 'Checkbox',
  initials: 'Initials',
  value: 'Write in a value'
}

export interface ChecklistStep {
  id: string
  /** 1-based index into PHASES */
  phase: number
  title: string
  trigger: ChecklistTrigger
  /** per-line text: {field} is filled in; a [bracketed part] drops out when its fields are all empty */
  detail: string
  signoff: Signoff
  /** device categories it applies to; empty = every device */
  categories: string[]
}

/** The device facts the triggers read (the main process fills it from the project). */
export interface ChecklistDevice {
  name: string
  category: string
  location: string
  mac: string
  isSwitch: boolean
  mgmtIp: string
  oobIp: string
  ports: { port: string; ip: string; network: string; vlan: string; tagged: string }[]
  software: string[]
  projectorModel: string
  /** how many projector settings are set */
  projectorSettings: number
  displays: number
  patch: { direction: string; socket: string; other: string; cable: string; signal: string }[]
  racks: string[]
}

/** One printed line. */
export interface ChecklistRec {
  device: string
  /** "4. Network": sections the sheet */
  phase: string
  /** sort key: phase, step, item */
  order: string
  step: string
  detail: string
  signoff: Signoff
}

type Vars = Record<string, string>

function items(trigger: ChecklistTrigger, d: ChecklistDevice): Vars[] {
  switch (trigger) {
    case 'always':
      return [{}]
    case 'location':
      return d.location ? [{}] : []
    case 'mac':
      return d.mac ? [{ mac: d.mac }] : []
    case 'ports':
      return d.ports.filter((p) => p.ip || p.vlan)
    case 'switchIps':
      return d.isSwitch && (d.mgmtIp || d.oobIp) ? [{ mgmtIp: d.mgmtIp, oobIp: d.oobIp }] : []
    case 'software':
      return d.software.map((software) => ({ software }))
    case 'projector':
      return d.projectorModel
        ? [{ model: d.projectorModel, settings: String(d.projectorSettings) }]
        : []
    case 'wallpaper':
      return d.displays > 0 ? [{ displays: String(d.displays) }] : []
    case 'patch':
      return d.patch
    case 'rack':
      return d.racks.map((rack) => ({ rack }))
  }
}

/** Fills {field}s; a [part] whose fields are all empty is dropped, then spacing is tidied. */
export function fillDetail(text: string, vars: Vars): string {
  const optional = text.replace(/\[([^\]]*)\]/g, (_, part: string) => {
    const keys = [...part.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    return keys.length && keys.every((k) => !vars[k]) ? '' : part
  })
  return optional
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The lines on one device's sheet, steps in library order within each phase. */
export function checklistRecords(steps: ChecklistStep[], d: ChecklistDevice): ChecklistRec[] {
  const pad = (n: number, w: number): string => String(n).padStart(w, '0')
  const base: Vars = { device: d.name, category: d.category, location: d.location }
  return steps.flatMap((s, si) => {
    if (
      s.categories.length &&
      !s.categories.some((c) => c.toLowerCase() === d.category.toLowerCase())
    )
      return []
    return items(s.trigger, d).map((v, i) => ({
      device: d.name,
      phase: `${s.phase}. ${PHASES[s.phase - 1]}`,
      order: `${pad(s.phase, 2)}.${pad(si, 4)}.${pad(i, 5)}`,
      step: s.title,
      detail: fillDetail(s.detail, { ...base, ...v }),
      signoff: s.signoff
    }))
  })
}

const step = (
  id: string,
  phase: number,
  title: string,
  trigger: ChecklistTrigger,
  detail: string,
  signoff: Signoff = 'check'
): ChecklistStep => ({ id, phase, title, trigger, detail, signoff, categories: [] })

/** The starting library (also what "Reset to defaults" restores). */
export const DEFAULT_STEPS: ChecklistStep[] = [
  step('serial', 1, 'Record serial / asset tag', 'always', '', 'value'),
  step('inspect', 1, 'Physical check, no damage', 'always', ''),
  step('mac', 1, 'Confirm MAC address', 'mac', '{mac}'),
  step('software', 2, 'Install software', 'software', '{software}'),
  step('wallpaper', 3, 'Set wallpaper on every display', 'wallpaper', '{displays} display(s)'),
  step(
    'projector',
    3,
    'Apply projector settings',
    'projector',
    '{model} · [{settings} settings — see the projector setup sheet]'
  ),
  step(
    'ports',
    4,
    'Set IP and VLAN',
    'ports',
    '{port}: [{ip}] [({network})] [VLAN {vlan}] [tagged {tagged}]'
  ),
  step('switch-ips', 4, 'Set management IPs', 'switchIps', '[Mgmt {mgmtIp}] [OOB {oobIp}]'),
  step('patch', 6, 'Label and patch', 'patch', '{socket} → {other} [· cable {cable}] [· {signal}]'),
  step('burn-in', 7, 'Power on and test', 'always', ''),
  step('rack', 8, 'Install in rack', 'rack', '{rack}'),
  step('signoff', 9, 'Tech sign-off and date', 'always', '', 'initials')
]

/** library.json is a file anyone can edit: keep only steps the sheet can use. */
export function normalizeSteps(raw: unknown): ChecklistStep[] {
  if (!Array.isArray(raw)) return DEFAULT_STEPS
  return raw.flatMap((r, i): ChecklistStep[] => {
    if (!r || typeof r !== 'object') return []
    const s = r as Partial<ChecklistStep>
    const phase = Math.trunc(Number(s.phase))
    if (!(phase >= 1 && phase <= PHASES.length) || !(String(s.trigger) in TRIGGERS)) return []
    return [
      {
        id: String(s.id || `step-${i}`),
        phase,
        title: String(s.title ?? ''),
        trigger: s.trigger as ChecklistTrigger,
        detail: String(s.detail ?? ''),
        signoff: s.signoff && s.signoff in SIGNOFFS ? s.signoff : 'check',
        categories: Array.isArray(s.categories) ? s.categories.map(String).filter(Boolean) : []
      }
    ]
  })
}
