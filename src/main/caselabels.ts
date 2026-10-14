import { BrowserWindow, dialog, shell } from 'electron'
import { writeFileSync } from 'fs'
import { getProjectMeta } from './repository'
import type { LabelTemplate } from '../shared/types'

function esc(s: string): string {
  return String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string
  )
}

/** One case label's inner HTML (an 8.5" x 5.5" block). */
function labelHtml(t: LabelTemplate, showNameText: string, logo: string | null): string {
  const band = t.color ? `<div class="band" style="background:${esc(t.color)}"></div>` : ''
  const showTop = t.showName && showNameText ? `<span class="lshow">${esc(showNameText)}</span>` : '<span></span>'
  const logoTop = logo ? `<img class="llogo" src="${logo}" alt="">` : ''
  const top = t.showName && showNameText ? `<div class="ltop">${showTop}${logoTop}</div>` : logo ? `<div class="ltop"><span></span>${logoTop}</div>` : ''
  const fields = t.fields
    .filter((f) => (f.label || '').trim() || (f.value || '').trim())
    .map((f) => `<div class="lf"><span class="lk">${esc(f.label)}</span><span class="lv">${esc(f.value)}</span></div>`)
    .join('')
  return `<div class="label">${band}<div class="lbody">${top}<div class="ltitle">${esc(t.title || '')}</div><div class="lfields">${fields}</div></div></div>`
}

function sheetHtml(labels: string[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: Letter; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #111; }
    .label { width: 8.5in; height: 5.5in; padding: 0.35in 0.45in; overflow: hidden; position: relative;
             border-bottom: 1px dashed #cfcfcf; display: flex; }
    .band { position: absolute; left: 0; top: 0; bottom: 0; width: 0.28in; }
    .lbody { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .ltop { display: flex; align-items: center; justify-content: space-between; gap: 0.3in; }
    .lshow { font-size: 15pt; color: #555; text-transform: uppercase; letter-spacing: 0.02em;
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .llogo { max-height: 0.55in; max-width: 2.2in; object-fit: contain; }
    .ltitle { font-size: 46pt; font-weight: 800; line-height: 1.02; margin: 6pt 0 2pt; word-break: break-word; }
    .lfields { margin-top: 10pt; display: flex; flex-direction: column; gap: 4pt; }
    .lf { font-size: 18pt; line-height: 1.15; }
    .lk { font-weight: 700; text-transform: uppercase; font-size: 12pt; color: #333; margin-right: 10pt; }
  </style></head><body>${labels.join('')}</body></html>`
}

/** Render `copies` of a label template to a PDF (2 per Letter sheet) and save it. */
export async function printCaseLabels(
  template: LabelTemplate,
  copies: number
): Promise<string | null> {
  const showNameText = getProjectMeta('showName') ?? ''
  const logo = getProjectMeta('logo')
  const n = Math.max(1, Math.min(200, Math.trunc(copies) || 1))
  const one = labelHtml(template, showNameText, logo)
  const html = sheetHtml(Array(n).fill(one))

  const res = await dialog.showSaveDialog({
    defaultPath: `${(template.name || 'case label').replace(/[/\\:]/g, '-')} labels.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (res.canceled || !res.filePath) return null

  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
  try {
    await win.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    writeFileSync(res.filePath, pdf)
  } finally {
    win.destroy()
  }
  shell.openPath(res.filePath)
  return res.filePath
}
