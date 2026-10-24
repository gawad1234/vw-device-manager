// Shared by ipc.ts (registers handlers) and server.ts (serves them to joined
// computers) without the two importing each other.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (event: unknown, ...args: any[]) => unknown

/** Every IPC handler by channel, so the host can run the same code for a joined computer. */
export const handlers = new Map<string, Handler>()

let changeSeq = 0

/** Bump after anything changes the open project, so joined computers refresh. */
export function bumpChange(): void {
  changeSeq++
}

export function getChangeSeq(): number {
  return changeSeq
}
