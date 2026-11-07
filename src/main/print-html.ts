import { BrowserWindow } from 'electron'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/** Load a page in a hidden window and hand it to `fn` to print. The page goes
 *  through a temp file because Chromium refuses data: URLs past about 1 MB, which
 *  a long table or a logo repeated on every label easily reaches. */
export async function withPrintWindow<T>(
  html: string,
  fn: (win: BrowserWindow) => Promise<T>
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'device-manager-print-'))
  const win = new BrowserWindow({ show: false })
  try {
    const file = join(dir, 'page.html')
    writeFileSync(file, html, 'utf-8')
    await win.loadFile(file)
    return await fn(win)
  } finally {
    win.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
}
