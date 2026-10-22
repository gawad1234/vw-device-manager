// Silent-install switch presets for Windows installers. Every vendor picks
// their own installer builder, so these are starting points: the user confirms
// (or edits) the switches once per installer in the software library.

export const SILENT_PRESETS: { label: string; args: string }[] = [
  { label: 'MSI (quiet, no restart)', args: '/qn /norestart' },
  { label: 'Inno Setup', args: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-' },
  { label: 'NSIS', args: '/S' },
  { label: 'InstallShield', args: '/s /v"/qn /norestart"' },
  { label: 'Generic (/quiet)', args: '/quiet /norestart' }
]

export function isMsi(path: string): boolean {
  return /\.msi$/i.test(path)
}

/** Best first guess for a newly picked installer: MSI switches for .msi, else NSIS. */
export function defaultSilentArgs(path: string): string {
  return isMsi(path) ? SILENT_PRESETS[0].args : '/S'
}
