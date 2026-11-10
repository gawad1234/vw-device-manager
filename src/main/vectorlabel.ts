// Print one cable's labels from a phone: drop a CSV where VectorLabel's Auto Print
// picks it up (see shared/vectorlabel.ts). The folder is per-machine, like the library.
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { readSettings, writeSettings } from './settings'
import { cableLabelCsv, cableLabelFile } from '../shared/vectorlabel'
import type { Circuit, LabelFolderState } from '../shared/types'

function labelFolder(): string {
  return readSettings().vectorLabelFolder || join(homedir(), 'Documents', 'VectorLabel')
}

/** Phones only get the Print label button where VectorLabel is set up on this computer. */
export function getLabelFolder(): LabelFolderState {
  const path = labelFolder()
  return { path, found: existsSync(path) }
}

export async function chooseLabelFolder(): Promise<LabelFolderState> {
  const win = BrowserWindow.getFocusedWindow()
  const opts = {
    title: 'VectorLabel watch folder',
    defaultPath: labelFolder(),
    properties: ['openDirectory' as const, 'createDirectory' as const]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (!res.canceled && res.filePaths[0])
    writeSettings({ ...readSettings(), vectorLabelFolder: res.filePaths[0] })
  return getLabelFolder()
}

/** Write via a ".part" file and rename, so Auto Print never reads half a file. */
export function printCableLabel(c: Circuit, show: string): void {
  const { folder, file } = cableLabelFile(show, c)
  const dir = join(labelFolder(), 'Exports', folder)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, file)
  writeFileSync(path + '.part', cableLabelCsv(c), 'utf-8')
  renameSync(path + '.part', path)
}
