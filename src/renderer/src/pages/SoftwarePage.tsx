import { useEffect, useState } from 'react'
import type { Device, SoftwarePackage } from '../../../shared/types'
import DeviceSetupPage from '../components/DeviceSetupPage'
import SoftwareLibraryModal from '../components/SoftwareLibraryModal'

interface Props {
  devices: Device[]
  onChanged: () => void
}

/** Devices › Software: tick installers per computer, then build its USB install kit. */
function SoftwarePage({ devices, onChanged }: Props): React.JSX.Element {
  const [library, setLibrary] = useState<SoftwarePackage[]>([])
  const [showLibrary, setShowLibrary] = useState(false)
  const [note, setNote] = useState<{ id: number; text: string; error?: boolean } | null>(null)

  const reload = (): void => void window.api.software.list().then(setLibrary)
  useEffect(reload, [])

  async function toggle(d: Device, pkgId: number, on: boolean): Promise<void> {
    const ids = d.software ?? []
    await window.api.devices.setSoftware(
      d.id,
      on ? [...ids, pkgId] : ids.filter((x) => x !== pkgId)
    )
    onChanged()
  }

  async function build(d: Device): Promise<void> {
    setNote({ id: d.id, text: 'Copying installers…' })
    const res = await window.api.software.buildKit(d.id)
    if (!res) setNote(null)
    else if (res.error) setNote({ id: d.id, text: res.error, error: true })
    else setNote({ id: d.id, text: `Wrote ${res.count} installer(s) to ${res.path}` })
  }

  async function remove(d: Device): Promise<void> {
    if (!window.confirm(`Remove the software setup for "${d.name}"?`)) return
    await window.api.devices.setSoftware(d.id, null)
    onChanged()
  }

  return (
    <>
      <DeviceSetupPage
        title="Software"
        intro="Tick the Windows installers each computer needs, then build its install kit: a folder (e.g. on a USB stick) with the installers and an Install.bat that installs everything silently."
        devices={devices}
        isSetUp={(d) => d.software !== null}
        summary={(d) => {
          const n = d.software?.length ?? 0
          return `${n} installer${n === 1 ? '' : 's'}`
        }}
        addLabel="+ Add computer…"
        onAdd={async (d) => {
          await window.api.devices.setSoftware(d.id, [])
          onChanged()
        }}
        editor={(d) => {
          const ticked = new Set(d.software ?? [])
          return (
            <>
              {library.length ? (
                <table className="table">
                  <tbody>
                    {library.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <label className="chk">
                            <input
                              type="checkbox"
                              checked={ticked.has(p.id)}
                              onChange={(e) => toggle(d, p.id, e.target.checked)}
                            />
                            {p.name}
                          </label>
                        </td>
                        <td className="muted">{p.path.split(/[\\/]/).pop()}</td>
                        <td>
                          <code>{p.args || '(no switches)'}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">
                  The software library is empty — add installers with{' '}
                  <strong>Software library…</strong> above.
                </p>
              )}
              <div className="signal-add" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-small btn-primary"
                  disabled={!ticked.size}
                  onClick={() => build(d)}
                >
                  Build install kit…
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  onClick={() => remove(d)}
                >
                  Remove software setup
                </button>
              </div>
              {note?.id === d.id && (
                <p
                  className={note.error ? 'banner banner-error' : 'muted'}
                  style={{ marginTop: 8 }}
                >
                  {note.text}
                </p>
              )}
            </>
          )
        }}
        headerActions={
          <button className="btn" onClick={() => setShowLibrary(true)}>
            Software library…
          </button>
        }
      />
      {showLibrary && (
        <SoftwareLibraryModal onClose={() => setShowLibrary(false)} onChanged={reload} />
      )}
    </>
  )
}

export default SoftwarePage
