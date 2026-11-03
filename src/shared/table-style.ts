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
  /** a key into TABLE_FONTS; used for the whole PDF page and every Excel cell */
  font: string
  /** header text size as a % of the table's text size */
  headerScale: number
  headerBold: boolean
  headerCaps: boolean
  /** space inside each cell */
  padding: 'tight' | 'normal' | 'roomy'
}

/** Fonts that exist on both Mac and Windows (and in Excel), with a CSS fallback. */
export const TABLE_FONTS: { key: string; label: string; css: string; excel: string }[] = [
  {
    key: 'system',
    label: 'System (default)',
    css: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    excel: 'Calibri'
  },
  { key: 'arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif', excel: 'Arial' },
  { key: 'helvetica', label: 'Helvetica', css: 'Helvetica, Arial, sans-serif', excel: 'Helvetica' },
  { key: 'verdana', label: 'Verdana', css: 'Verdana, Geneva, sans-serif', excel: 'Verdana' },
  { key: 'tahoma', label: 'Tahoma', css: 'Tahoma, Verdana, sans-serif', excel: 'Tahoma' },
  {
    key: 'trebuchet',
    label: 'Trebuchet MS',
    css: "'Trebuchet MS', sans-serif",
    excel: 'Trebuchet MS'
  },
  { key: 'georgia', label: 'Georgia', css: 'Georgia, serif', excel: 'Georgia' },
  {
    key: 'times',
    label: 'Times New Roman',
    css: "'Times New Roman', Times, serif",
    excel: 'Times New Roman'
  },
  {
    key: 'courier',
    label: 'Courier New',
    css: "'Courier New', Courier, monospace",
    excel: 'Courier New'
  }
]

export const tableFont = (s: TableStyle): (typeof TABLE_FONTS)[number] =>
  TABLE_FONTS.find((f) => f.key === s.font) ?? TABLE_FONTS[0]

const PADDING: Record<TableStyle['padding'], string> = {
  tight: '3px 5px',
  normal: '5px 7px',
  roomy: '8px 10px'
}

/** The look exports had before styles existed. */
export const DEFAULT_TABLE_STYLE: TableStyle = {
  headerFill: '#f2f2f2',
  headerText: '#1b1b1f',
  stripes: true,
  stripeColor: '#fafafa',
  borders: 'grid',
  borderColor: '#cfcfcf',
  font: 'system',
  headerScale: 85,
  headerBold: true,
  headerCaps: true,
  padding: 'normal'
}

/** Color presets: they leave the font, header and padding choices alone. */
export const TABLE_STYLE_PRESETS: { name: string; style: Partial<TableStyle> }[] = [
  {
    name: 'Classic',
    style: {
      headerFill: '#f2f2f2',
      headerText: '#1b1b1f',
      stripes: true,
      stripeColor: '#fafafa',
      borders: 'grid',
      borderColor: '#cfcfcf'
    }
  },
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
    borderColor: hex(s?.borderColor, d.borderColor),
    font: TABLE_FONTS.some((f) => f.key === s?.font) ? (s?.font as string) : d.font,
    headerScale:
      typeof s?.headerScale === 'number' && s.headerScale >= 50 && s.headerScale <= 200
        ? Math.round(s.headerScale)
        : d.headerScale,
    headerBold: typeof s?.headerBold === 'boolean' ? s.headerBold : d.headerBold,
    headerCaps: typeof s?.headerCaps === 'boolean' ? s.headerCaps : d.headerCaps,
    padding: s?.padding === 'tight' || s?.padding === 'roomy' ? s.padding : 'normal'
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
  const head =
    `font-size: ${s.headerScale / 100}em; font-weight: ${s.headerBold ? 700 : 400};` +
    ` text-transform: ${s.headerCaps ? 'uppercase' : 'none'}; letter-spacing: ${s.headerCaps ? '.03em' : 'normal'};`
  return (
    `${t} { font-family: ${tableFont(s).css}; } ${t} th, ${t} td { padding: ${PADDING[s.padding]}; }` +
    ` ${cells} ${t} th { background: ${s.headerFill}; color: ${s.headerText}; ${head} }` +
    ` ${t} tbody tr:nth-child(even) { background: ${s.stripes ? s.stripeColor : 'transparent'}; }` +
    // merged-cell tables shade whole groups (a device and its ports) instead of rows
    ` ${t} tr.g0 > td { background: #fff; } ${t} tr.g1 > td { background: ${s.stripes ? s.stripeColor : '#fff'}; }`
  )
}

/** ExcelJS colors are ARGB without the '#'. */
export const argb = (hex: string): string => `FF${hex.slice(1).toUpperCase()}`
