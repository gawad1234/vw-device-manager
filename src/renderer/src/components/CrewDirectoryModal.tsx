import { useEffect, useState } from 'react'
import type { CrewMember, CrewMemberInput } from '../../../shared/types'
import Modal from './Modal'
import RatesFields from './RatesFields'

const BLANK: CrewMemberInput = {
  name: '',
  role: '',
  phone: '',
  email: '',
  notes: '',
  rateType: 'day',
  dayRate: 0,
  hourlyRate: 0,
  otAfterHours: 10,
  otMultiplier: 1.5
}

interface Props {
  onClose: () => void
  onChanged: () => void
}

/** Shared crew directory (names, contacts, default rates) — kept in the gitignored library. */
function CrewDirectoryModal({ onClose, onChanged }: Props): React.JSX.Element {
  const [list, setList] = useState<CrewMember[]>([])
  const [activeId, setActiveId] = useState<number | 'new'>('new')
  const [draft, setDraft] = useState<CrewMemberInput>(BLANK)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.crew.directory().then(setList)
  }, [])

  function select(m: CrewMember | null): void {
    setActiveId(m ? m.id : 'new')
    setDraft(m ? { ...m } : BLANK)
    setError('')
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!draft.name.trim()) {
      setError('A name is required.')
      return
    }
    const input = { ...draft, name: draft.name.trim() }
    const saved =
      activeId === 'new'
        ? await window.api.crew.createMember(input)
        : await window.api.crew.updateMember(activeId, input)
    setList(await window.api.crew.directory())
    select(saved)
    onChanged()
  }

  async function remove(): Promise<void> {
    if (activeId === 'new' || !window.confirm(`Delete ${draft.name} from the crew directory?`))
      return
    await window.api.crew.removeMember(activeId)
    setList(await window.api.crew.directory())
    select(null)
    onChanged()
  }

  const text = (key: 'name' | 'role' | 'phone' | 'email', label: string): React.JSX.Element => (
    <label>
      {label}
      <input value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </label>
  )

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
      <button className="btn btn-primary" type="submit" form="crew-form">
        {activeId === 'new' ? 'Add person' : 'Save changes'}
      </button>
    </>
  )

  return (
    <Modal title="Crew directory" onClose={onClose} footer={footer} wide>
      <p className="muted" style={{ marginTop: 0 }}>
        Shared by every show. Stored only in your Dropbox library file — never in the GitHub repo.
      </p>
      <div className="kit-layout">
        <div className="kit-list">
          {list.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`kit-list-row${activeId === m.id ? ' active' : ''}`}
              onClick={() => select(m)}
            >
              <span className="kit-trigger">{m.name}</span>
              <span className="muted kit-summary">{m.role}</span>
            </button>
          ))}
          <button
            type="button"
            className={`kit-list-row kit-new${activeId === 'new' ? ' active' : ''}`}
            onClick={() => select(null)}
          >
            + New person
          </button>
        </div>
        <form id="crew-form" className="form-grid kit-form" onSubmit={save}>
          {error && <div className="banner banner-error span-2">{error}</div>}
          {text('name', 'Name')}
          {text('role', 'Role')}
          {text('phone', 'Phone')}
          {text('email', 'Email')}
          <RatesFields value={draft} onChange={(r) => setDraft({ ...draft, ...r })} />
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

export default CrewDirectoryModal
