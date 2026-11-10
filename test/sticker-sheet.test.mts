import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cableEndGender,
  parseDocLabelSheet,
  parseDocxLabelSheet,
  stickerSlots,
  tidyLabels
} from '../src/shared/sticker-sheet.ts'

const page = '<w:pgSz w:w="12240" w:h="15840" /><w:pgMar w:top="720" w:left="472" />'
const anchor = (x: number, y: number, prst = 'roundRect'): string =>
  `<wp:anchor><wp:positionH relativeFrom="page"><wp:posOffset>${x}</wp:posOffset></wp:positionH>` +
  `<wp:positionV relativeFrom="page"><wp:posOffset>${y}</wp:posOffset></wp:positionV>` +
  `<wp:extent cx="1600200" cy="457200" /><a:prstGeom prst="${prst}"/></wp:anchor>`

test('positioned label shapes (OnlineLabels style) become label boxes in sheet order', () => {
  // two rows of two 1.75" x 0.5" labels, written out of order, plus a duplicate
  const xml =
    page +
    anchor(2157730, 457200) +
    anchor(299720, 914400) +
    anchor(299720, 457200) +
    anchor(2157730, 914400) +
    anchor(299720, 457200)
  const s = parseDocxLabelSheet(xml)!
  assert.equal(s.pageW, 8.5)
  assert.equal(s.pageH, 11)
  assert.equal(s.rounded, true)
  assert.deepEqual(s.labels, [
    { x: 0.328, y: 0.5, w: 1.75, h: 0.5 },
    { x: 2.36, y: 0.5, w: 1.75, h: 0.5 },
    { x: 0.328, y: 1, w: 1.75, h: 0.5 },
    { x: 2.36, y: 1, w: 1.75, h: 0.5 }
  ])
})

test('an Avery-style table skips the narrow spacer column', () => {
  const tr = '<w:tr><w:trPr><w:trHeight w:val="1440" /></w:trPr></w:tr>'
  const xml =
    page +
    '<w:tbl><w:tblGrid><w:gridCol w:w="5040" /><w:gridCol w:w="144" /><w:gridCol w:w="5040" /></w:tblGrid>' +
    tr +
    tr +
    '</w:tbl>'
  const s = parseDocxLabelSheet(xml)!
  assert.equal(s.labels.length, 4)
  assert.deepEqual(s.labels[1], { x: 0.328 + 3.5 + 0.1, y: 0.5, w: 3.5, h: 1 })
})

test('odd-sized shapes (logos, frames) are ignored; nothing usable returns null', () => {
  const kept = tidyLabels(
    [
      { x: 1, y: 1, w: 2, h: 1 },
      { x: 4, y: 1, w: 2, h: 1 },
      { x: 0, y: 0, w: 8.5, h: 11 }, // page frame
      { x: 5, y: 5, w: 0.1, h: 0.1 } // speck
    ],
    8.5,
    11
  )
  assert.equal(kept.length, 2)
  assert.equal(parseDocxLabelSheet(page + '<w:p/>'), null)
})

test('printing starts at the chosen sticker and runs onto new sheets', () => {
  assert.deepEqual(stickerSlots(4, 5, 2), [
    { page: 0, index: 2 },
    { page: 0, index: 3 },
    { page: 1, index: 0 },
    { page: 1, index: 1 },
    { page: 1, index: 2 }
  ])
})

test('{Gender}: XLR source end is M, destination F; other cables blank', () => {
  assert.equal(cableEndGender('XLR 3-pin', true), 'M')
  assert.equal(cableEndGender('xlr', false), 'F')
  assert.equal(cableEndGender('Cat5 Ethercon', true), '')
  assert.equal(cableEndGender('', false), '')
})

test('.doc (binary Word) label table: Avery 5160 layout from its property codes', () => {
  // made-up bytes laid out the way Word stores them: page + margins, then 10 rows,
  // each a row height followed by the row's cell edges (3 labels, 2 spacer columns)
  const bytes: number[] = [0, 0, 0]
  const op = (code: number, ...vals: number[]): void => {
    bytes.push(code & 255, code >> 8)
    for (const v of vals) bytes.push(v & 255, (v >> 8) & 255)
  }
  op(0xb01f, 12240)
  op(0xb020, 15840)
  op(0xb021, 367)
  op(0x9023, 720)
  const edges = [-86, 3701, 3873, 7660, 7832, 11619]
  for (let r = 0; r < 10; r++) {
    bytes.push(0, 0, 0, 0)
    op(0x9407, -1440)
    bytes.push(0x08, 0xd6, 114, 0, 5)
    for (const e of edges) bytes.push(e & 255, (e >> 8) & 255)
    bytes.push(...new Array(100).fill(0))
  }
  const s = parseDocLabelSheet(new Uint8Array(bytes))!
  assert.equal(s.pageW, 8.5)
  assert.equal(s.pageH, 11)
  assert.equal(s.labels.length, 30)
  assert.deepEqual(s.labels[0], { x: 0.195, y: 0.5, w: 2.63, h: 1 })
  assert.deepEqual(s.labels[2], { x: 5.694, y: 0.5, w: 2.63, h: 1 })
  assert.equal(s.labels[29].y, 9.5)
  assert.equal(parseDocLabelSheet(new Uint8Array(200)), null)
})
