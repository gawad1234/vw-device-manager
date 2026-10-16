import { dialog } from 'electron'
import { readFileSync } from 'fs'
import { mergeCircuits, circuitKey, type CircuitImport } from './repository'
import type { CircuitImportResult } from '../shared/types'

// A ConnectCAD "Circuit Report" CSV. The file has a multi-row header and uses
// the machine field order (per column index, 0-based):
//   0 Number  1 Cable  2 Signal  3 Circuits  4 Est.Length
//   5 Src_Room 6 Src_Rack 7 Src_RackU 8 Src_Slot 9 Src_Dev 10 Src_Skt 11 Src_Adapter 12 Src_Conn
//   13 Dst_Room 14 Dst_Rack 15 Dst_RackU 16 Dst_Slot 17 Dst_Dev 18 Dst_Skt 19 Dst_Adapter 20 Dst_Conn
//   21 Route
// Header rows (Signal === "Signal") and a numeric width/metadata row are skipped.

/** Quote-aware single CSV line → fields. */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

const HEADER_TOKENS = new Set(['signal', 'number'])

export function parseCircuitReport(text: string): CircuitImport[] {
  const norm = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rows: CircuitImport[] = []
  for (const line of norm.split('\n')) {
    if (!line.trim()) continue
    const c = parseCsvLine(line)
    if (c.length < 21) continue
    const t = (i: number): string => (c[i] ?? '').trim()
    const signal = t(2)
    const srcDev = t(9)
    const dstDev = t(17)
    if (!srcDev && !dstDev) continue // not a circuit row
    if (HEADER_TOKENS.has(signal.toLowerCase())) continue // header row
    if (/^\d+$/.test(signal)) continue // numeric width/metadata row
    rows.push({
      cableNumber: t(0),
      signal,
      estLength: t(4),
      srcName: srcDev,
      srcSocket: t(10),
      srcConnector: t(12),
      srcRack: t(6) || t(5),
      srcRackU: t(7),
      srcSlot: t(8),
      dstName: dstDev,
      dstSocket: t(18),
      dstConnector: t(20),
      dstRack: t(14) || t(13),
      dstRackU: t(15),
      dstSlot: t(16)
    })
  }
  // De-dupe by connection identity (last wins) so the UNIQUE upsert is clean.
  const seen = new Map<string, CircuitImport>()
  for (const r of rows) seen.set(circuitKey(r), r)
  return [...seen.values()]
}

/** Open a file dialog, import the chosen circuit-report CSV, and merge it. */
export async function importCircuitReport(): Promise<CircuitImportResult | null> {
  const res = await dialog.showOpenDialog({
    title: 'Import ConnectCAD circuit report',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths[0]) return null
  const text = readFileSync(res.filePaths[0], 'utf-8')
  const rows = parseCircuitReport(text)
  return mergeCircuits(rows)
}
