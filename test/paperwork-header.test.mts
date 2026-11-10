import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_HEADER, headerHtml, normalizeHeader, watermarkHtml } from '../src/shared/paperwork-header.ts'

const data = {
  title: 'Pull Sheet',
  showName: 'Show <A>',
  showLogo: 'data:image/png;base64,AAA',
  companyName: 'ACME',
  companyLogo: null,
  date: 'November 7, 2026'
}

test('default header: names on the left, show logo on the right, values escaped', () => {
  const html = headerHtml(DEFAULT_HEADER, data)
  const left = html.slice(html.indexOf('ph-left'), html.indexOf('ph-center'))
  const right = html.slice(html.indexOf('ph-right'))
  assert.match(left, /cname">ACME/)
  assert.match(left, /class="show">Show &lt;A&gt;/)
  assert.match(left, /class="doctitle">Pull Sheet/)
  assert.match(right, /class="logo"/)
  assert.doesNotMatch(html, /hdate|htext/) // hidden by default
})

test('moving pieces: centered title, logo left, own line and date shown', () => {
  const h = normalizeHeader({
    ...DEFAULT_HEADER,
    slots: {
      ...DEFAULT_HEADER.slots,
      showName: 'hidden',
      docTitle: 'center',
      showLogo: 'left',
      date: 'right',
      text: 'right'
    },
    text: 'Office 555-0100'
  })
  const html = headerHtml(h, data)
  const center = html.slice(html.indexOf('ph-center'), html.indexOf('ph-right'))
  // with the show name hidden the title becomes the big line
  assert.match(center, /class="show">Pull Sheet/)
  assert.match(html.slice(html.indexOf('ph-left'), html.indexOf('ph-center')), /class="logo"/)
  assert.match(html.slice(html.indexOf('ph-right')), /Office 555-0100.*November 7, 2026/)
})

test('normalize keeps good values and repairs bad ones', () => {
  const h = normalizeHeader({ slots: { date: 'bogus' } as never, logoHeight: 999 })
  assert.equal(h.slots.date, 'hidden')
  assert.equal(h.slots.showLogo, 'right')
  assert.equal(h.logoHeight, 140)
  assert.equal(h.rule, true)
  assert.deepEqual(normalizeHeader(null), DEFAULT_HEADER)
})

test('watermark: off by default, needs a logo, escaped', () => {
  assert.equal(normalizeHeader({}).watermark, false)
  const on = normalizeHeader({ watermark: true })
  assert.equal(watermarkHtml(DEFAULT_HEADER, 'data:x'), '')
  assert.equal(watermarkHtml(on, null), '')
  assert.equal(watermarkHtml(on, 'a"b'), '<img class="wm" src="a&quot;b" alt="">')
})
