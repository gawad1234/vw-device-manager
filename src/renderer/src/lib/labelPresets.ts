import type { LabelElement } from '../../../shared/types'

const uid = (): string => Math.random().toString(36).slice(2, 10)

type El = Omit<LabelElement, 'id'>
const withIds = (els: El[]): LabelElement[] => els.map((e) => ({ id: uid(), ...e }))

function text(
  x: number,
  y: number,
  w: number,
  h: number,
  t: string,
  fontSize: number,
  opts?: Partial<El>
): El {
  return { type: 'text', x, y, w, h, text: t, fontSize, bold: true, align: 'left', color: '#111111', ...opts }
}
function box(x: number, y: number, w: number, h: number, borderWidth = 1.5): El {
  return { type: 'rect', x, y, w, h, fill: null, color: '#111111', borderWidth }
}
function showName(x: number, y: number, w: number, h: number, fontSize: number, opts?: Partial<El>): El {
  return { type: 'showname', x, y, w, h, fontSize, bold: true, align: 'left', color: '#111111', ...opts }
}
function logo(x: number, y: number, w: number, h: number): El {
  return { type: 'logo', x, y, w, h }
}

export interface LabelPreset {
  key: string
  name: string
  /** suggested template name when creating */
  suggested: string
  build: () => LabelElement[]
}

export const LABEL_PRESETS: LabelPreset[] = [
  {
    key: 'roadcase',
    name: 'Road case',
    suggested: 'Road case',
    build: () =>
      withIds([
        // top-left logo cell
        box(0.3, 0.3, 4.2, 2.2),
        logo(0.45, 0.45, 3.9, 1.9),
        // client / job + show date (right column)
        box(4.6, 0.3, 3.6, 1.1),
        text(4.72, 0.4, 3.4, 0.3, 'CLIENT/JOB:', 13),
        box(4.6, 1.45, 3.6, 1.05),
        text(4.72, 1.55, 3.4, 0.3, 'SHOW DATE:', 13),
        // venue / room row
        box(0.3, 2.6, 4.2, 1.0),
        text(0.42, 2.7, 4.0, 0.3, 'VENUE/ROOM:', 13),
        box(4.6, 2.6, 3.6, 1.0),
        text(4.72, 2.7, 3.4, 0.3, 'ROOM/LOCATION:', 13),
        // contents
        box(0.3, 3.7, 7.9, 1.35),
        text(0.42, 3.8, 4.0, 0.3, 'CONTENTS:', 13),
        text(6.1, 4.72, 2.0, 0.28, 'PACKED BY:', 12, { align: 'right' }),
        // show name footer
        showName(0.3, 5.12, 5.5, 0.32, 15)
      ])
  },
  {
    key: 'truck',
    name: 'Truck label',
    suggested: 'Truck',
    build: () =>
      withIds([
        logo(0.3, 0.3, 3.0, 1.2),
        showName(3.4, 0.45, 4.8, 0.9, 30, { align: 'right' }),
        box(0.3, 1.75, 3.9, 1.1),
        text(0.42, 1.85, 3.6, 0.3, 'TRUCK #:', 14),
        box(4.3, 1.75, 3.9, 1.1),
        text(4.42, 1.85, 3.6, 0.3, 'SENT TO:', 14),
        box(0.3, 2.95, 7.9, 0.95),
        text(0.42, 3.05, 4.0, 0.3, 'FROM:', 14),
        box(0.3, 4.0, 7.9, 1.2),
        text(0.42, 4.1, 4.0, 0.3, 'CONTENTS:', 14)
      ])
  },
  {
    key: 'contents',
    name: 'Contents',
    suggested: 'Contents',
    build: () =>
      withIds([
        logo(0.3, 0.3, 2.3, 1.1),
        showName(2.8, 0.4, 5.4, 0.95, 34, { align: 'right' }),
        box(0.3, 1.65, 3.9, 1.0),
        text(0.42, 1.75, 3.6, 0.3, 'CASE #:', 14),
        box(4.3, 1.65, 3.9, 1.0),
        text(4.42, 1.75, 3.6, 0.3, 'TO:', 14),
        box(0.3, 2.8, 7.9, 2.4),
        text(0.42, 2.9, 4.0, 0.3, 'CONTENTS:', 14)
      ])
  }
]
