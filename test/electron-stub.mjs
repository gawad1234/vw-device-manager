import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'vwdm-test-'))

export const app = { getPath: () => userData, getVersion: () => '0.0.0' }
export const is = { dev: false }
export const dialog = {}
export const shell = {}
export class BrowserWindow {}
