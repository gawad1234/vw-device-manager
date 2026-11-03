import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  argb,
  DEFAULT_TABLE_STYLE,
  normalizeTableStyle,
  tableStyleCss
} from '../src/shared/table-style.ts'

test('a missing or hand-broken style falls back to the default look', () => {
  assert.deepEqual(normalizeTableStyle(null), DEFAULT_TABLE_STYLE)
  const s = normalizeTableStyle({ headerFill: 'red', borders: 'thick' as never, stripes: false })
  assert.equal(s.headerFill, DEFAULT_TABLE_STYLE.headerFill)
  assert.equal(s.borders, 'grid')
  assert.equal(s.stripes, false)
})

test('css follows stripes and line choice; Excel colors are ARGB', () => {
  const css = tableStyleCss({ ...DEFAULT_TABLE_STYLE, stripes: false, borders: 'rows' }, '.t')
  assert.match(css, /\.t tbody tr:nth-child\(even\) \{ background: transparent; \}/)
  assert.match(css, /border: none; border-bottom: 1px solid #cfcfcf/)
  assert.equal(argb('#1f2a37'), 'FF1F2A37')
})

test('font, header and padding: hand-broken values fall back, css follows them', () => {
  const s = normalizeTableStyle({ font: 'comic', headerScale: 999, padding: 'huge' as never })
  assert.equal(s.font, 'system')
  assert.equal(s.headerScale, 85)
  assert.equal(s.padding, 'normal')
  const css = tableStyleCss(
    {
      ...DEFAULT_TABLE_STYLE,
      font: 'georgia',
      headerScale: 120,
      headerCaps: false,
      headerBold: false,
      padding: 'roomy'
    },
    '.t'
  )
  assert.match(css, /\.t \{ font-family: Georgia, serif; \}/)
  assert.match(css, /\.t th, \.t td \{ padding: 8px 10px; \}/)
  assert.match(css, /font-size: 1\.2em; font-weight: 400; text-transform: none;/)
})
