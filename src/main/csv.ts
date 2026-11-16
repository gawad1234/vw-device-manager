/** One CSV cell, quoted when needed. Pure — tests import it (exports.ts pulls in exceljs). */
export function csvCell(v: string): string {
  // A leading = + - @ makes Excel run the cell as a formula. Plain numbers are fine.
  const safe = /^[=+\-@\t\r]/.test(v) && !/^[+-]?\d[\d.,]*$/.test(v) ? "'" + v : v
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe
}
