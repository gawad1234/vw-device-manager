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
