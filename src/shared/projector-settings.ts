import type { ProjectorConfig } from './types'

// Panasonic PT-RZ / PT-RQ projector settings catalog.
//
// Every command string is copied from Panasonic's "Control Commands" list for
// PT-RQ32K/RZ31K/RQ22K/RZ21K/RQ13K/RZ12K (2018-07). The output is a command list
// CSV for Panasonic's Multi Monitoring & Control Software (MMCS manual p.102:
// one command per line ending in ",", max 100). Settings with kind 'manual'
// have no command (e.g. IP and projector name can't be set by command) and
// only appear on the setup sheet as steps to do at the projector.
//
// shortcut: one catalog for the whole 2018 family — not every option exists on
// every model (check the projector's menu). Split per series once newer
// command lists (RQ35K, RQ25K, RQ50K, RZ990, RQ7…) have been read.

export const PROJECTOR_MODELS = [
  'PT-RQ32K',
  'PT-RZ31K',
  'PT-RQ22K',
  'PT-RZ21K',
  'PT-RQ13K',
  'PT-RZ12K',
  'Other (unverified)'
]

export type ProjectorSettingKind = 'choice' | 'number' | 'text' | 'manual'

export interface ProjectorSetting {
  key: string
  group: string
  label: string
  kind: ProjectorSettingKind
  /** choice: what the user picks → the exact command to send */
  options?: { label: string; cmd: string }[]
  /** number/text: builds the command from the value */
  cmd?: (v: string) => string
  min?: number
  max?: number
  unit?: string
  /** shown under the setting in the UI and on the setup sheet */
  note?: string
}

/** Panasonic's 5-digit signed number format: 75 → "+00075". */
export function pad5(n: number): string {
  return (n < 0 ? '-' : '+') + String(Math.abs(Math.round(n))).padStart(5, '0')
}

/** Text going into a command: no commas or line breaks (they would break the CSV). */
function cleanText(v: string): string {
  return v.replace(/[,\r\n]/g, ' ').trim()
}

const onOff = (code: string): { label: string; cmd: string }[] => [
  { label: 'Off', cmd: `${code}:0` },
  { label: 'On', cmd: `${code}:1` }
]

const fade = (code: string): { label: string; cmd: string }[] =>
  ['0.0', '0.5', '1.0', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0', '5.0', '7.0', '10.0'].map(
    (s) => ({ label: s === '0.0' ? 'Off' : `${s} s`, cmd: `VXX:${code}=${s}` })
  )

const INPUTS: [string, string][] = [
  ['DIGITAL LINK', 'DL1'],
  ['SDI1', 'SD1'],
  ['SDI2', 'SD2'],
  ['SDI3', 'SD3'],
  ['SDI4', 'SD4'],
  ['HDMI1', 'HD1'],
  ['DVI-D', 'DVI'],
  ['RGB1', 'RG1'],
  ['RGB2', 'RG2'],
  ['SLOT1 : SDI1', 'AU1,SD1'],
  ['SLOT1 : SDI2', 'AU1,SD2'],
  ['SLOT1 : HDMI1', 'AU1,HD1'],
  ['SLOT1 : HDMI2', 'AU1,HD2'],
  ['SLOT1 : DVI1', 'AU1,DV1'],
  ['SLOT1 : DVI2', 'AU1,DV2'],
  ['SLOT2 : SDI1', 'AU2,SD1'],
  ['SLOT2 : SDI2', 'AU2,SD2'],
  ['SLOT2 : HDMI3', 'AU2,HD3'],
  ['SLOT2 : HDMI4', 'AU2,HD4'],
  ['SLOT2 : DVI3', 'AU2,DV3'],
  ['SLOT2 : DVI4', 'AU2,DV4']
]

// Lens memory name slots: Panasonic skips NCGS8 (memory 4 is NCGS9).
const LENS_NAME_CODES = ['5', '6', '7', '9', 'A', 'B', 'C', 'D', 'E', 'F']

export const PROJECTOR_SETTINGS: ProjectorSetting[] = [
  // ---- Network Settings (IP/subnet/router come from the device's ports) ----
  {
    key: 'projectorName',
    group: 'Network Settings',
    label: 'Projector name',
    kind: 'manual',
    note: 'Set in the menu or Panasonic Network Setup Software — no command exists.'
  },
  {
    key: 'projectorId',
    group: 'Network Settings',
    label: 'Projector ID',
    kind: 'number',
    min: 0,
    max: 64,
    note: '0 = ALL',
    cmd: (v) => `RIS:${String(Number(v)).padStart(2, '0')}`
  },
  // ---- Signal Settings -------------------------------------------------
  {
    key: 'input',
    group: 'Signal Settings',
    label: 'Input (switch now)',
    kind: 'choice',
    options: INPUTS.map(([label, code]) => ({ label, cmd: `IIS:${code}` }))
  },
  {
    key: 'startupInput',
    group: 'Signal Settings',
    label: 'Startup input',
    kind: 'choice',
    options: [
      { label: 'Last used', cmd: 'VXX:SISS1=LSU' },
      ...INPUTS.map(([label, code]) => ({ label, cmd: `VXX:SISS1=${code}` }))
    ]
  },
  {
    key: 'backupInput',
    group: 'Signal Settings',
    label: 'Backup input',
    kind: 'choice',
    options: [
      { label: 'Off', cmd: 'VXX:BACI2=+00000' },
      ...[1, 2, 3, 4].map((n) => ({ label: `Mode ${n}`, cmd: `VXX:BACI2=${pad5(n)}` }))
    ],
    note: 'RQ22K / RQ13K family — each mode is an input pair; see the projector menu.'
  },
  {
    key: 'backupInputSlot',
    group: 'Signal Settings',
    label: 'Backup input (option slots)',
    kind: 'choice',
    options: (
      [
        ['Off', 0],
        ['SDI1 / SDI2', 1],
        ['SDI1 (Slot 1) / SDI2 (Slot 1)', 11],
        ['HDMI1 (Slot 1) / HDMI2 (Slot 1)', 12],
        ['DVI1 (Slot 1) / DVI2 (Slot 1)', 13],
        ['SDI1 (Slot 1) / SDI3 (Slot 1)', 14],
        ['SDI3 (Slot 2) / SDI4 (Slot 2)', 21],
        ['HDMI3 (Slot 2) / HDMI4 (Slot 2)', 22],
        ['DVI3 (Slot 2) / DVI4 (Slot 2)', 23],
        ['SDI1 (Slot 2) / SDI3 (Slot 2)', 24],
        ['SDI1-2 / SDI3-4', 100],
        ['SDI1-2 (Slot 1) / SDI3-4 (Slot 2)', 101],
        ['HDMI1-2 (Slot 1) / HDMI3-4 (Slot 2)', 102],
        ['DVI1-2 (Slot 1) / DVI3-4 (Slot 2)', 103],
        ['SDI1-4 (on board) / SDI1-4 (slot)', 1000],
        ['SDI1-4 (on board) / SDI1-4 (Slot 1)', 1001],
        ['SDI1-4 (on board) / SDI1-4 (Slot 2)', 1002]
      ] as const
    ).map(([label, n]) => ({ label, cmd: `VXX:BACI6=${pad5(n)}` })),
    note: 'RQ32K family.'
  },
  {
    key: 'autoSwitch',
    group: 'Signal Settings',
    label: 'Auto switch (to backup)',
    kind: 'choice',
    options: [
      { label: 'Disable', cmd: 'VXX:BACI3=+00001' },
      { label: 'Enable', cmd: 'VXX:BACI3=+00002' }
    ]
  },
  {
    key: 'startupLogo',
    group: 'Signal Settings',
    label: 'Startup logo',
    kind: 'choice',
    options: [
      { label: 'Off', cmd: 'MLO:0' },
      { label: 'User logo', cmd: 'MLO:1' },
      { label: 'Default logo', cmd: 'MLO:2' }
    ]
  },
  {
    key: 'backColor',
    group: 'Signal Settings',
    label: 'Back color (no signal)',
    kind: 'choice',
    options: [
      { label: 'Blue', cmd: 'OBC:0' },
      { label: 'Black', cmd: 'OBC:1' },
      { label: 'User logo', cmd: 'OBC:2' },
      { label: 'Default logo', cmd: 'OBC:3' }
    ]
  },
  {
    key: 'projectionMethod',
    group: 'Installation & Lens',
    label: 'Projection method',
    kind: 'choice',
    options: [
      { label: 'Front / desk', cmd: 'OIL:0' },
      { label: 'Rear / desk', cmd: 'OIL:1' },
      { label: 'Front / ceiling', cmd: 'OIL:2' },
      { label: 'Rear / ceiling', cmd: 'OIL:3' },
      { label: 'Front / auto', cmd: 'OIL:4' },
      { label: 'Rear / auto', cmd: 'OIL:5' }
    ]
  },
  // ---- Light Settings --------------------------------------------------
  {
    key: 'operatingMode',
    group: 'Light Settings',
    label: 'Operating mode',
    kind: 'choice',
    options: [
      { label: 'Normal', cmd: 'VXX:OPEI1=+00000' },
      { label: 'Eco', cmd: 'VXX:OPEI1=+00001' },
      { label: 'High', cmd: 'VXX:OPEI1=+00004' },
      { label: 'Long life 1', cmd: 'VXX:OPEI1=+00011' },
      { label: 'Long life 2', cmd: 'VXX:OPEI1=+00012' },
      { label: 'Long life 3', cmd: 'VXX:OPEI1=+00013' },
      { label: 'User 1', cmd: 'VXX:OPEI1=+00101' },
      { label: 'User 2', cmd: 'VXX:OPEI1=+00102' },
      { label: 'User 3', cmd: 'VXX:OPEI1=+00103' }
    ]
  },
  {
    key: 'lightOutput',
    group: 'Light Settings',
    label: 'Light output',
    kind: 'number',
    min: 10,
    max: 100,
    unit: '%',
    // the command takes tenths of a percent (+00100 … +01000)
    cmd: (v) => `VXX:LOPI2=${pad5(Number(v) * 10)}`
  },
  {
    key: 'standbyMode',
    group: 'Light Settings',
    label: 'Standby mode',
    kind: 'choice',
    options: [
      { label: 'Normal', cmd: 'VXX:STMI0=+00000' },
      { label: 'Eco', cmd: 'VXX:STMI0=+00003' }
    ],
    note: 'Eco standby blocks network setup while the projector is in standby.'
  },
  {
    key: 'brightnessConstant',
    group: 'Light Settings',
    label: 'Brightness control — constant mode',
    kind: 'choice',
    options: [
      { label: 'Off', cmd: 'VXX:BCMI0=+00000' },
      { label: 'Auto', cmd: 'VXX:BCMI0=+00001' },
      { label: 'PC', cmd: 'VXX:BCMI0=+00002' }
    ]
  },
  {
    key: 'brightnessLink',
    group: 'Light Settings',
    label: 'Brightness control — link group',
    kind: 'choice',
    options: [
      { label: 'Off', cmd: 'VXX:BCLI0=+00000' },
      { label: 'Group A', cmd: 'VXX:BCLI0=+00001' },
      { label: 'Group B', cmd: 'VXX:BCLI0=+00002' },
      { label: 'Group C', cmd: 'VXX:BCLI0=+00003' },
      { label: 'Group D', cmd: 'VXX:BCLI0=+00004' }
    ]
  },
  // ---- Picture Settings ------------------------------------------------
  {
    key: 'pictureMode',
    group: 'Picture Settings',
    label: 'Picture mode',
    kind: 'choice',
    options: [
      { label: 'Dynamic', cmd: 'VPM:DYN' },
      { label: 'Natural', cmd: 'VPM:NAT' },
      { label: 'Standard', cmd: 'VPM:STD' },
      { label: 'Cinema', cmd: 'VPM:CIN' },
      { label: 'Graphic', cmd: 'VPM:GRA' },
      { label: 'DICOM sim.', cmd: 'VPM:DIC' },
      { label: 'User', cmd: 'VPM:USR' }
    ]
  },
  // ---- Shutter Settings ------------------------------------------------
  // shortcut: SEFS1/SEFS2/SEFI3 → fade-in/fade-out/startup follows the menu order
  // (the PDF's row labels didn't extract cleanly); confirm on the first real projector.
  {
    key: 'fadeIn',
    group: 'Shutter Settings',
    label: 'Shutter fade-in',
    kind: 'choice',
    options: fade('SEFS1')
  },
  {
    key: 'fadeOut',
    group: 'Shutter Settings',
    label: 'Shutter fade-out',
    kind: 'choice',
    options: fade('SEFS2')
  },
  {
    key: 'shutterStartup',
    group: 'Shutter Settings',
    label: 'Shutter at startup',
    kind: 'choice',
    options: [
      { label: 'Open', cmd: 'VXX:SEFI3=+00000' },
      { label: 'Close', cmd: 'VXX:SEFI3=+00001' }
    ]
  },
  // ---- Edge Blending + Installation & Lens -----------------------------
  {
    key: 'edgeBlend',
    group: 'Edge Blending',
    label: 'Edge blending',
    kind: 'choice',
    options: [
      { label: 'Off', cmd: 'VXX:EDBI0=+00000' },
      { label: 'On', cmd: 'VXX:EDBI0=+00001' },
      { label: 'User', cmd: 'VXX:EDBI0=+00002' }
    ]
  },
  ...(
    [
      ['Upper', 'VGU', 'EUWI0'],
      ['Lower', 'VGB', 'EBWI0'],
      ['Left', 'VGL', 'ELWI0'],
      ['Right', 'VGR', 'ERWI0']
    ] as const
  ).flatMap(([side, onCode, widthCode]): ProjectorSetting[] => [
    {
      key: `blend${side}`,
      group: 'Edge Blending',
      label: `Edge blend — ${side.toLowerCase()} side`,
      kind: 'choice',
      options: onOff(onCode)
    },
    {
      key: `blend${side}Width`,
      group: 'Edge Blending',
      label: `Edge blend — ${side.toLowerCase()} width`,
      kind: 'number',
      min: 0,
      max: 3712,
      unit: 'px',
      note: 'Max depends on the model (RZ: ~1000–1900, RQ: 2272–3712).',
      cmd: (v) => `VXX:${widthCode}=${pad5(Number(v))}`
    }
  ]),
  { key: 'lensModel', group: 'Installation & Lens', label: 'Lens model', kind: 'manual' },
  {
    key: 'blendRole',
    group: 'Installation & Lens',
    label: 'Position in the array',
    kind: 'manual'
  },
  ...LENS_NAME_CODES.map((code, i): ProjectorSetting => ({
    key: `lensMemory${i + 1}Name`,
    group: 'Installation & Lens',
    label: `Lens memory ${i + 1} name`,
    kind: 'text',
    cmd: (v) => `VXX:NCGS${code}=${cleanText(v)}`
  }))
]

export const PROJECTOR_GROUPS = [...new Set(PROJECTOR_SETTINGS.map((s) => s.group))]

const BY_KEY = new Map(PROJECTOR_SETTINGS.map((s) => [s.key, s]))

export function projectorSetting(key: string): ProjectorSetting | undefined {
  return BY_KEY.get(key)
}

/** Human-readable value of one chosen setting (for the UI summary and setup sheet). */
export function projectorValueLabel(s: ProjectorSetting, v: string): string {
  if (s.kind === 'choice') return s.options?.find((o) => o.cmd === v)?.label ?? v
  return s.unit ? `${v} ${s.unit}` : v
}

/** The commands for every chosen setting that has one, in catalog order.
 *  Choice values ARE the command; number/text values go through `cmd`.
 *  Out-of-range numbers and blank values are skipped rather than sent. */
export function projectorCommands(config: ProjectorConfig): string[] {
  const out: string[] = []
  for (const s of PROJECTOR_SETTINGS) {
    const v = config.values[s.key]?.trim()
    if (!v || s.kind === 'manual') continue
    if (s.kind === 'choice') {
      if (s.options?.some((o) => o.cmd === v)) out.push(v)
    } else if (s.kind === 'number') {
      const n = Number(v)
      if (Number.isFinite(n) && n >= (s.min ?? -Infinity) && n <= (s.max ?? Infinity))
        out.push(s.cmd!(v))
    } else if (cleanText(v)) out.push(s.cmd!(v))
  }
  return out
}

/** MMCS command list CSV: one command per line, each ending in ",". */
export function projectorCommandsCsv(config: ProjectorConfig): string {
  return (
    projectorCommands(config)
      .map((c) => `${c},`)
      .join('\r\n') + '\r\n'
  )
}

/** MMCS reads at most 100 commands from a command list. */
export const MMCS_MAX_COMMANDS = 100
