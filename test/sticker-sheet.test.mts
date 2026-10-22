import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDocxLabelSheet, stickerSlots, tidyLabels } from '../src/shared/sticker-sheet.ts'

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
