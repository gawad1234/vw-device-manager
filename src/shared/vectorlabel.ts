// One cable's labels for VectorLabel (Gabe's label app). Its Auto Print watches
// <folder>/Exports/<project>/ for new "<name>_export_YYYYMMDD_HHMMSS.csv" files in the
// same shape its Vectorworks export writes: one row per cable end (_Side Source /
// Destination), so a dropped file prints both ends of that cable. Pure, so it's tested.
import type { Circuit } from './types'

/** Column order of VectorLabel's own ConnectCAD export (VectorworksPlugin/export_selected.py). */
export const VECTORLABEL_HEADERS = [
  '_Side',
  'Number',
  'Cable',
  'Signal',
  'Circuits',
  'CableLength',
  'CableCalculatedLength',
  'Number Display',
  'Cable Type',
  'Cable Outside Diameter',
  'CircuitType',
  'Device_Name',
  'Device_Tag',
  'Socket_Name',
  'Socket_Tag',
  'Socket_Signal',
  'Connector',
  'Socket_Circs',
  'Room',
  'Rack',
  'RackU',
  'Other_Device',
  'Other_Socket',
  'Other_Connector'
] as const

const cell = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

function endRow(c: Circuit, side: 'Source' | 'Destination'): Record<string, string> {
  const src = side === 'Source'
  const [me, other] = src
    ? [
        { n: c.srcName, s: c.srcSocket, k: c.srcConnector, r: c.srcRack, u: c.srcRackU },
        { n: c.dstName, s: c.dstSocket, k: c.dstConnector }
      ]
    : [
        { n: c.dstName, s: c.dstSocket, k: c.dstConnector, r: c.dstRack, u: c.dstRackU },
        { n: c.srcName, s: c.srcSocket, k: c.srcConnector }
      ]
  return {
    _Side: side,
    Number: c.cableNumber,
    Signal: c.signal,
    Circuits: '1',
    CableLength: c.estLength,
    Device_Name: me.n,
    Device_Tag: me.n,
    Socket_Name: me.s,
    Socket_Tag: me.s,
    Socket_Signal: c.signal,
    Connector: me.k,
    Socket_Circs: '1',
    Rack: me.r,
    RackU: me.u,
    Other_Device: other.n,
    Other_Socket: other.s,
    Other_Connector: other.k
  }
}

/** Header + a Source row + a Destination row, CRLF like Python's csv module. */
export function cableLabelCsv(c: Circuit): string {
  const rows = [endRow(c, 'Source'), endRow(c, 'Destination')]
  return (
    [
      VECTORLABEL_HEADERS.join(','),
      ...rows.map((r) => VECTORLABEL_HEADERS.map((h) => cell(r[h] ?? '')).join(','))
    ].join('\r\n') + '\r\n'
  )
}

const safe = (s: string): string => s.replace(/[\\/:*?"<>|\r\n]+/g, '-').trim()

/** Project subfolder + file name. The name must end "_export_YYYYMMDD_HHMMSS.csv" (local
 *  time) or Auto Print ignores it; the cable goes in front so two cables tapped in the
 *  same second don't collide. */
export function cableLabelFile(
  show: string,
  c: Circuit,
  now = new Date()
): { folder: string; file: string } {
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  const folder = safe(show) || 'Device Manager'
  const cable = safe(c.cableNumber || c.signal || `cable ${c.id}`)
  return { folder, file: `${folder} ${cable}_export_${stamp}.csv` }
}
