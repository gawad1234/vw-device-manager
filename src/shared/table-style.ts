// How every exported table looks (Excel sheets and PDF paperwork): header colors,
// alternating row stripes and grid lines. One style, shared by every show.

export interface TableStyle {
  /** header row background / text, as #rrggbb */
  headerFill: string
  headerText: string
  /** shade every other row */
  stripes: boolean
  stripeColor: string
  /** grid = every cell boxed; rows = a line under each row; none = no lines */
  borders: 'grid' | 'rows' | 'none'
  borderColor: string
}

/** The look exports had before styles existed. */
export const DEFAULT_TABLE_STYLE: TableStyle = {
  headerFill: '#f2f2f2',
  headerText: '#1b1b1f',
  stripes: true,
  stripeColor: '#fafafa',
  borders: 'grid',
  borderColor: '#cfcfcf'
}

export const TABLE_STYLE_PRESETS: { name: string; style: TableStyle }[] = [
  { name: 'Classic', style: DEFAULT_TABLE_STYLE },
  {
    name: 'Dark header',
    style: {
      headerFill: '#1f2a37',
      headerText: '#ffffff',
      stripes: true,
      stripeColor: '#eef2f7',
      borders: 'grid',
      borderColor: '#d5dbe3'
    }
  },
  {
    name: 'Blue bands',
    style: {
      headerFill: '#2f6fb3',
      headerText: '#ffffff',
      stripes: true,
      stripeColor: '#e3eefa',
      borders: 'rows',
      borderColor: '#c4d6ea'
    }
  },
  {
    name: 'Plain',
    style: {
      headerFill: '#ffffff',
      headerText: '#1b1b1f',
      stripes: false,
      stripeColor: '#f5f5f5',
      borders: 'rows',
      borderColor: '#bbbbbb'
    }
  }
]

const HEX = /^#[0-9a-f]{6}$/i

/** Fill gaps and drop bad values (library.json is hand-editable). */
export function normalizeTableStyle(s: Partial<TableStyle> | null | undefined): TableStyle {
  const d = DEFAULT_TABLE_STYLE
  const hex = (v: unknown, fb: string): string => (typeof v === 'string' && HEX.test(v) ? v : fb)
  return {
    headerFill: hex(s?.headerFill, d.headerFill),
    headerText: hex(s?.headerText, d.headerText),
    stripes: typeof s?.stripes === 'boolean' ? s.stripes : d.stripes,
    stripeColor: hex(s?.stripeColor, d.stripeColor),
    borders: s?.borders === 'rows' || s?.borders === 'none' ? s.borders : 'grid',
    borderColor: hex(s?.borderColor, d.borderColor)
  }
}

/** CSS for the PDF pages and the Paperwork preview; `t` scopes it (e.g. "table", ".lxr-table"). */
export function tableStyleCss(s: TableStyle, t = 'table'): string {
  const line = `1px solid ${s.borderColor}`
  const cells =
    s.borders === 'grid'
      ? `${t} th, ${t} td { border: ${line}; }`
      : s.borders === 'rows'
        ? `${t} th, ${t} td { border: none; border-bottom: ${line}; }`
        : `${t} th, ${t} td { border: none; }`
  return (
    `${cells} ${t} th { background: ${s.headerFill}; color: ${s.headerText}; }` +
    ` ${t} tbody tr:nth-child(even) { background: ${s.stripes ? s.stripeColor : 'transparent'}; }`
  )
}

/** ExcelJS colors are ARGB without the '#'. */
export const argb = (hex: string): string => `FF${hex.slice(1).toUpperCase()}`
