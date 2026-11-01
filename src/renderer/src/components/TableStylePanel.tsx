import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_TABLE_STYLE,
  TABLE_STYLE_PRESETS,
  tableStyleCss,
  type TableStyle
} from '../../../shared/table-style'

const SAMPLE = [
  ['1', 'FOH', 'Source 4 26°', 'R02'],
  ['2', 'FOH', 'Source 4 26°', 'L201'],
  ['11', '1E', 'Lustr X8', ''],
  ['12', '1E', 'Lustr X8', ''],
  ['21', '2E', 'Mac Aura', '']
]

/** Settings › Table style: how every exported table looks (Excel and PDF). */
function TableStylePanel(): React.JSX.Element {
  const [style, setStyle] = useState<TableStyle>(DEFAULT_TABLE_STYLE)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.api.tableStyle.get().then(setStyle)
  }, [])

  // a color picker fires on every drag step: save once it settles
  function change(patch: Partial<TableStyle>): void {
    const next = { ...style, ...patch }
    setStyle(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => window.api.tableStyle.set(next), 400)
  }

  const color = (key: keyof TableStyle, label: string): React.JSX.Element => (
    <label className="tstyle-color">
      <input
        type="color"
        value={style[key] as string}
        onChange={(e) => change({ [key]: e.target.value })}
      />
      {label}
    </label>
  )

  return (
    <div className="panel">
      <h3>Table style</h3>
      <p className="muted">
        How the tables in every Excel and PDF export look: header colors, alternating row colors and
        lines. Shared across all projects.
      </p>
      <div className="tstyle-presets">
        {TABLE_STYLE_PRESETS.map((p) => (
          <button key={p.name} className="btn btn-small" onClick={() => change(p.style)}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="tstyle-controls">
        {color('headerFill', 'Header')}
        {color('headerText', 'Header text')}
        <label className="tstyle-color">
          <input
            type="checkbox"
            checked={style.stripes}
            onChange={(e) => change({ stripes: e.target.checked })}
          />
          Alternating rows
        </label>
        {style.stripes && color('stripeColor', 'Row color')}
        <label className="tstyle-color">
          Lines
          <select
            value={style.borders}
            onChange={(e) => change({ borders: e.target.value as TableStyle['borders'] })}
          >
            <option value="grid">Grid</option>
            <option value="rows">Between rows</option>
            <option value="none">None</option>
          </select>
        </label>
        {style.borders !== 'none' && color('borderColor', 'Line color')}
      </div>
      <div className="tstyle-preview">
        <style>{tableStyleCss(style, '.tstyle-preview table')}</style>
        <table>
          <thead>
            <tr>
              {['Chan', 'Position', 'Instrument type', 'Color'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SAMPLE.map((row, i) => (
              <tr key={i}>
                {row.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default TableStylePanel
