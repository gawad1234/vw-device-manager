import JSZip from 'jszip'
import { parseDocxLabelSheet, tidyLabels, type ParsedSheet } from '../../../shared/sticker-sheet'
import type { StickerRect } from '../../../shared/types'

/** Read a sticker manufacturer's template (.docx or .pdf) into label boxes. */
export async function importStickerTemplate(file: File): Promise<ParsedSheet> {
  const data = await file.arrayBuffer()
  if (/\.docx$/i.test(file.name)) {
    const zip = await JSZip.loadAsync(data)
    const xml = await zip.file('word/document.xml')?.async('string')
    const sheet = xml ? parseDocxLabelSheet(xml) : null
    if (!sheet) throw new Error('No labels found in that Word template.')
    return sheet
  }
  if (/\.pdf$/i.test(file.name)) return parsePdfLabelSheet(data)
  throw new Error('Pick a .docx or .pdf label template.')
}

type Matrix = [number, number, number, number, number, number]
const mul = (m: Matrix, c: Matrix): Matrix => [
  m[0] * c[0] + m[1] * c[2],
  m[0] * c[1] + m[1] * c[3],
  m[2] * c[0] + m[3] * c[2],
  m[2] * c[1] + m[3] * c[3],
  m[4] * c[0] + m[5] * c[2] + c[4],
  m[4] * c[1] + m[5] * c[3] + c[5]
]

/** Label outlines in a PDF template: the bounding box of every drawn path on page 1
 *  (tracking the transforms they're drawn under), then the most common size wins. */
async function parsePdfLabelSheet(data: ArrayBuffer): Promise<ParsedSheet> {
  // Loaded on demand; importing the worker module runs PDF.js in this thread
  // (no separate worker file, so it works under the app's script policy).
  const pdfjs = await import('pdfjs-dist')
  await import('pdfjs-dist/build/pdf.worker.mjs')
  const task = pdfjs.getDocument({ data })
  const pdf = await task.promise
  const page = await pdf.getPage(1)
  const [vx0, vy0, vx1, vy1] = page.view
  const pageW = (vx1 - vx0) / 72
  const pageH = (vy1 - vy0) / 72
  const ops = await page.getOperatorList()
  const { OPS } = pdfjs

  let ctm: Matrix = [1, 0, 0, 1, 0, 0]
  const stack: Matrix[] = []
  const boxes: StickerRect[] = []
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
    else if (fn === OPS.transform) ctm = mul(args as Matrix, ctm)
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm)
      if (args?.[0]) ctm = mul(args[0] as Matrix, ctm)
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm
    else if (fn === OPS.constructPath) {
      const mm = args?.[2] as ArrayLike<number> | null | undefined
      if (!mm || mm.length < 4) return
      const pts = [
        [mm[0], mm[1]],
        [mm[2], mm[1]],
        [mm[0], mm[3]],
        [mm[2], mm[3]]
      ].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]])
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      const minX = Math.min(...xs)
      const maxY = Math.max(...ys)
      boxes.push({
        x: (minX - vx0) / 72,
        y: (vy1 - maxY) / 72,
        w: (Math.max(...xs) - minX) / 72,
        h: (maxY - Math.min(...ys)) / 72
      })
    }
  })
  await task.destroy()
  const labels = tidyLabels(boxes, pageW, pageH)
  if (labels.length < 2) throw new Error('No label outlines found in that PDF template.')
  return { pageW, pageH, labels, rounded: false }
}
