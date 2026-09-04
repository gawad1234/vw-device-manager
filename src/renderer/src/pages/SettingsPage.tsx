import { useEffect, useState } from 'react'
import type { CableType } from '../../../shared/types'
import UpdatesPanel from '../components/UpdatesPanel'

interface Props {
  cableTypes: CableType[]
  categories: string[]
  onChanged: () => void
}

/** Read an image File, downscale it to `maxW` px wide, return a PNG data URL —
 *  keeps the logo small enough to store inside the project file. */
function downscaleImage(file: File, maxW: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width)
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('no canvas context'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

function SettingsPage({ cableTypes, categories, onChanged }: Props): React.JSX.Element {
  const [signals, setSignals] = useState<string[]>([])
  const [signalInput, setSignalInput] = useState('')
  const [typeName, setTypeName] = useState('')
  const [typeNotes, setTypeNotes] = useState('')
  const [typeError, setTypeError] = useState<string | null>(null)
  const [categoryInput, setCategoryInput] = useState('')
  const [logo, setLogo] = useState<string | null>(null)
  const [showName, setShowName] = useState('')

  useEffect(() => {
    window.api.networkSignals.list().then(setSignals)
    window.api.showLogo.get().then(setLogo)
    window.api.showName.get().then((n) => setShowName(n ?? ''))
  }, [])

  async function saveShowName(): Promise<void> {
    await window.api.showName.set(showName.trim() || null)
  }

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be re-picked later
    if (!file) return
    const dataUrl = await downscaleImage(file, 500)
    await window.api.showLogo.set(dataUrl)
    setLogo(dataUrl)
  }

  async function removeLogo(): Promise<void> {
    await window.api.showLogo.set(null)
    setLogo(null)
  }

  async function addSignal(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!signalInput.trim()) return
    setSignals(await window.api.networkSignals.add(signalInput))
    setSignalInput('')
  }

  async function removeSignal(signal: string): Promise<void> {
    setSignals(await window.api.networkSignals.remove(signal))
  }

  async function addCableType(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!typeName.trim()) return
    try {
      await window.api.cableTypes.add({ name: typeName.trim(), notes: typeNotes.trim() || null })
      setTypeName('')
      setTypeNotes('')
      setTypeError(null)
      onChanged()
    } catch {
      setTypeError(`A cable type named "${typeName.trim()}" already exists.`)
    }
  }

  async function removeCableType(t: CableType): Promise<void> {
    if (!window.confirm(`Remove cable type "${t.name}"? Cables already tagged with it keep the label.`))
      return
    await window.api.cableTypes.remove(t.name)
    onChanged()
  }

  async function addCategory(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!categoryInput.trim()) return
    await window.api.deviceCategories.add(categoryInput.trim())
    setCategoryInput('')
    onChanged()
  }

  async function removeCategory(name: string): Promise<void> {
    if (!window.confirm(`Remove category "${name}"? Devices in it become uncategorized.`)) return
    await window.api.deviceCategories.remove(name)
    onChanged()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      <UpdatesPanel />

      <div className="panel">
        <h3>Show branding</h3>
        <p className="muted">
          Stamped onto this project&rsquo;s generated paperwork (pull sheets, schedules, IP
          schedule, labels). Stored inside this project file, so each show has its own.
        </p>
        <label className="show-name-field">
          Show name
          <input
            value={showName}
            onChange={(e) => setShowName(e.target.value)}
            onBlur={saveShowName}
            placeholder="e.g. Summer Tour — Chicago"
          />
        </label>
        <div className="logo-row">
          {logo && (
            <div className="logo-preview">
              <img src={logo} alt="Show logo" />
            </div>
          )}
          <div className="signal-add">
            <label className="btn btn-small btn-primary file-btn">
              {logo ? 'Replace…' : 'Choose image…'}
              <input type="file" accept="image/png,image/jpeg" hidden onChange={onLogoFile} />
            </label>
            {logo && (
              <button className="btn btn-small btn-danger" onClick={removeLogo}>
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Network signal types</h3>
        <p className="muted">
          When linking, a ConnectCAD jack becomes a port if its <em>signal</em> matches one of
          these. Copper (RJ45), SFP/SFP+, and QSFP jacks usually all report as “LAN”, so the
          physical form factor doesn’t matter — match on the signal. Add any other signals your
          devices use (e.g. Dante, AES67). Matching is case-insensitive.
        </p>

        <form onSubmit={addSignal} className="signal-add">
          <input
            value={signalInput}
            onChange={(e) => setSignalInput(e.target.value)}
            placeholder="e.g. LAN, Dante, AES67"
          />
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </form>

        <ul className="signal-list">
          {signals.length === 0 && (
            <li className="muted">None — no jacks will be discovered as ports.</li>
          )}
          {signals.map((s) => (
            <li key={s}>
              <code>{s}</code>
              <button className="btn btn-small btn-danger" onClick={() => removeSignal(s)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <h3>Cable types</h3>
        <p className="muted">
          The catalog of cable types you can assign to cables in the Cables tab (e.g. Cat6,
          Fiber SM, XLR, Coax). Names are case-insensitive and must be unique.
        </p>

        <form onSubmit={addCableType} className="signal-add">
          <input
            value={typeName}
            onChange={(e) => setTypeName(e.target.value)}
            placeholder="e.g. Cat6"
          />
          <input
            value={typeNotes}
            onChange={(e) => setTypeNotes(e.target.value)}
            placeholder="Notes (optional)"
          />
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </form>
        {typeError && <div className="banner banner-error">{typeError}</div>}

        <ul className="signal-list">
          {cableTypes.length === 0 && <li className="muted">No cable types yet.</li>}
          {cableTypes.map((t) => (
            <li key={t.name}>
              <span>
                <code>{t.name}</code>
                {t.notes && <span className="muted"> — {t.notes}</span>}
              </span>
              <button className="btn btn-small btn-danger" onClick={() => removeCableType(t)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <h3>Device categories</h3>
        <p className="muted">
          Groupings you can assign to devices (e.g. Cameras, Displays, Network, Servers). The
          Devices tab groups and filters by these, and they section the Device list export. Shared
          across all projects; case-insensitive and unique.
        </p>

        <form onSubmit={addCategory} className="signal-add">
          <input
            value={categoryInput}
            onChange={(e) => setCategoryInput(e.target.value)}
            placeholder="e.g. Cameras"
          />
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </form>

        <ul className="signal-list">
          {categories.length === 0 && <li className="muted">No categories yet.</li>}
          {categories.map((c) => (
            <li key={c}>
              <code>{c}</code>
              <button className="btn btn-small btn-danger" onClick={() => removeCategory(c)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default SettingsPage
