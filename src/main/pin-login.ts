// PIN login rules for the show server, kept free of Electron so they can be tested.

export type Role = 'crew' | 'manager'

/**
 * Which role a typed PIN gets, and how it counts toward the lockout:
 * 'ok' = a PIN that is actually set matched (clears the count), 'fail' = counts as a wrong try,
 * 'none' = neither (blank PIN into an open tier). A wrong PIN that falls through to an open crew
 * tier still logs in as crew but counts as a failed manager guess.
 */
export function pinLogin(
  pin: string,
  managerPin: string,
  crewPin: string
): { role: Role | null; result: 'ok' | 'fail' | 'none' } {
  if (managerPin !== '' && pin === managerPin) return { role: 'manager', result: 'ok' }
  if (crewPin !== '' && pin === crewPin) return { role: 'crew', result: 'ok' }
  if (managerPin === '' && crewPin === '') return { role: 'manager', result: 'none' } // nothing set → open
  if (crewPin === '') return { role: 'crew', result: pin === '' ? 'none' : 'fail' }
  return { role: null, result: 'fail' }
}

// Wrong PINs per address. A 4-digit PIN would otherwise fall to a script in seconds.
export const MAX_PIN_TRIES = 5
export const PIN_LOCK_MS = 30_000
export const pinFailures = new Map<string, { count: number; until: number }>()

export function pinLocked(key: string, now = Date.now()): boolean {
  const f = pinFailures.get(key)
  return !!f && f.count >= MAX_PIN_TRIES && now < f.until
}

export function notePinResult(key: string, result: 'ok' | 'fail' | 'none', now = Date.now()): void {
  if (result === 'none') return
  if (result === 'ok') return void pinFailures.delete(key)
  const f = pinFailures.get(key)
  const count = f && now < f.until ? f.count + 1 : 1
  pinFailures.set(key, { count, until: now + PIN_LOCK_MS })
}
