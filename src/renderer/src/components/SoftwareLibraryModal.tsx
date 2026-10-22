import { useEffect, useState } from 'react'
import type { SoftwarePackage, SoftwarePackageInput } from '../../../shared/types'
import { SILENT_PRESETS, defaultSilentArgs } from '../../../shared/software'
import Modal from './Modal'

const BLANK: SoftwarePackageInput = { name: '', path: '', args: '', notes: '' }

interface Props {
  onClose: () => void
  /** the library changed (so the page can reload its checklist) */
  onChanged: () => void
}

/** Shared software library: one entry per Windows installer + its silent switches. */
function SoftwareLibraryModal({ onClose, onChanged }: Props): React.JSX.Element {
  const [list, setList] = useState<SoftwarePackage[]>([])
  const [activeId, setActiveId] = useState<number | 'new'>('new')
  const [draft, setDraft] = useState<SoftwarePackageInput>(BLANK)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.software.list().then(setList)
  }, [])

  function select(p: SoftwarePackage | null): void {
    setActiveId(p ? p.id : 'new')
    setDraft(p ? { name: p.name, path: p.path, args: p.args, notes: p.notes } : BLANK)
    setError('')
  }

  async function browse(): Promise<void> {
    const path = await window.api.software.pickInstaller()
    if (!path) return
    const file = path.split(/[\\/]/).pop() ?? ''
    setDraft((d) => ({
      ...d,
      path,
      name: d.name || file.replace(/\.(exe|msi)$/i, ''),
      args: d.args || defaultSilentArgs(path)
    }))
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!draft.name.trim() || !draft.path.trim()) {
      setError('A name and an installer file are required.')
      return
    }
    const input = { ...draft, name: draft.name.trim() }
    const saved =
      activeId === 'new'
        ? await window.api.software.create(input)
        : await window.api.software.update(activeId, input)
    setList(await window.api.software.list())
    select(saved)
    onChanged()
  }

  async function remove(): Promise<void> {
    if (activeId === 'new' || !window.confirm(`Delete "${draft.name}" from the library?`)) return
    await window.api.software.remove(activeId)
    setList(await window.api.software.list())
    select(null)
    onChanged()
  }

  const footer = (
    <>
      {activeId !== 'new' && (
        <button className="btn btn-danger" onClick={remove}>
          Delete
        </button>
      )}
      <span className="footer-spacer" />
      <button className="btn" onClick={onClose}>
        Close
      </button>
      <button className="btn btn-primary" type="submit" form="software-form">
        {activeId === 'new' ? 'Add to library' : 'Save changes'}
      </button>
    </>
  )

  return (
    <Modal title="Software library" onClose={onClose} footer={footer} wide>
      <div className="kit-layout">
        <div className="kit-list">
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`kit-list-row${activeId === p.id ? ' active' : ''}`}
              onClick={() => select(p)}
            >
              <span className="kit-trigger">{p.name}</span>
              <span className="muted kit-summary">{p.path.split(/[\\/]/).pop()}</span>
            </button>
          ))}
          <button
            type="button"
            className={`kit-list-row kit-new${activeId === 'new' ? ' active' : ''}`}
            onClick={() => select(null)}
          >
            + New installer
          </button>
        </div>

        <form id="software-form" className="form-grid kit-form" onSubmit={save}>
          {error && <div className="banner banner-error span-2">{error}</div>}
          <label className="span-2">
            Installer file (.exe or .msi)
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={draft.path} readOnly placeholder="Choose the installer…" />
              <button type="button" className="btn" onClick={browse}>
                Browse…
              </button>
            </div>
            <small className="muted">
              The kit copies it from here, so keep installers somewhere this computer can reach.
            </small>
          </label>
          <label className="span-2">
            Name
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Chrome"
            />
          </label>
          <label className="span-2">
            Silent install switches
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={draft.args}
                onChange={(e) => setDraft({ ...draft, args: e.target.value })}
                placeholder="/S"
                className="mono"
              />
              <select value="" onChange={(e) => setDraft({ ...draft, args: e.target.value })}>
                <option value="">Presets…</option>
                {SILENT_PRESETS.map((p) => (
                  <option key={p.label} value={p.args}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <small className="muted">
              For an .msi these go after <code>msiexec /i</code>. Check the vendor&rsquo;s docs if
              unsure — some installers need their own switches or a license key.
            </small>
          </label>
          <label className="span-2">
            Notes
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              rows={2}
            />
          </label>
        </form>
      </div>
    </Modal>
  )
}

export default SoftwareLibraryModal
