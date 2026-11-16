import { useEffect, useState } from 'react'
import type { Subnet, SubnetInput } from '../../../shared/types'
import PageHeader from '../components/PageHeader'

const EMPTY_FORM: SubnetInput = { name: '', cidr: '', vlan: null, gateway: null, notes: null }

interface Props {
  subnets: Subnet[]
  onChanged: () => void
}

function SubnetsPage({ subnets, onChanged }: Props): React.JSX.Element {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<SubnetInput>(EMPTY_FORM)
  // what the form held when it opened, so leaving it can ask before dropping edits
  const [initial, setInitial] = useState<SubnetInput>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!showForm) {
      setEditingId(null)
      setForm(EMPTY_FORM)
      setError(null)
    }
  }, [showForm])

  /** True if the open form has no edits, or the user agrees to drop them. */
  function canDiscard(): boolean {
    if (!showForm || JSON.stringify(form) === JSON.stringify(initial)) return true
    return window.confirm('Close without saving your changes?')
  }

  function closeForm(): void {
    if (canDiscard()) setShowForm(false)
  }

  function startAdd(): void {
    if (!canDiscard()) return
    setEditingId(null)
    setForm(EMPTY_FORM)
    setInitial(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  function startEdit(subnet: Subnet): void {
    if (subnet.id === editingId && showForm) return
    if (!canDiscard()) return
    const next: SubnetInput = {
      name: subnet.name,
      cidr: subnet.cidr,
      vlan: subnet.vlan,
      gateway: subnet.gateway,
      notes: subnet.notes
    }
    setEditingId(subnet.id)
    setForm(next)
    setInitial(next)
    setError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!form.name.trim() || !form.cidr.trim()) {
      setError('Name and CIDR range are required.')
      return
    }
    try {
      if (editingId != null) {
        await window.api.subnets.update(editingId, form)
      } else {
        await window.api.subnets.create(form)
      }
      setShowForm(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save subnet.')
    }
  }

  async function handleDelete(subnet: Subnet): Promise<void> {
    if (!window.confirm(`Delete subnet "${subnet.name}"? Devices assigned to it keep their IPs.`)) {
      return
    }
    await window.api.subnets.remove(subnet.id)
    setShowForm(false)
    onChanged()
  }

  return (
    <div className="page">
      <PageHeader
        title="Subnets"
        count={subnets.length}
        primary={{ label: '+ Add subnet', onClick: startAdd }}
      />

      {showForm && (
        <form
          className="panel form-grid"
          key={editingId ?? 'new'}
          onSubmit={handleSubmit}
          onKeyDown={(e) => e.key === 'Escape' && closeForm()}
        >
          {error && <div className="banner banner-error">{error}</div>}
          <label>
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Stage Network"
              autoFocus
            />
          </label>
          <label>
            CIDR range
            <input
              value={form.cidr}
              onChange={(e) => setForm({ ...form, cidr: e.target.value })}
              placeholder="10.0.10.0/24"
            />
          </label>
          <label>
            VLAN
            <input
              value={form.vlan ?? ''}
              onChange={(e) => setForm({ ...form, vlan: e.target.value || null })}
              placeholder="10"
            />
          </label>
          <label>
            Gateway
            <input
              value={form.gateway ?? ''}
              onChange={(e) => setForm({ ...form, gateway: e.target.value || null })}
              placeholder="10.0.10.1"
            />
          </label>
          <label className="span-2">
            Notes
            <textarea
              value={form.notes ?? ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
              rows={2}
            />
          </label>
          <div className="form-actions span-2">
            {editingId != null && (
              <button
                type="button"
                className="btn btn-danger push-left"
                onClick={() => {
                  const s = subnets.find((x) => x.id === editingId)
                  if (s) handleDelete(s)
                }}
              >
                Delete subnet
              </button>
            )}
            <button type="button" className="btn" onClick={closeForm}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {editingId != null ? 'Save changes' : 'Create subnet'}
            </button>
          </div>
        </form>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>CIDR</th>
            <th className="num">VLAN</th>
            <th>Gateway</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {subnets.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-cell">
                No subnets yet. Add one to start assigning device IPs.
              </td>
            </tr>
          )}
          {subnets.map((s) => (
            <tr
              key={s.id}
              className={`clickable${editingId === s.id ? ' selected' : ''}`}
              tabIndex={0}
              title="Edit"
              onClick={() => startEdit(s)}
              onKeyDown={(e) => e.key === 'Enter' && startEdit(s)}
            >
              <td>{s.name}</td>
              <td className="mono">{s.cidr}</td>
              <td className="num">{s.vlan ?? '—'}</td>
              <td className="mono">{s.gateway ?? '—'}</td>
              <td className="muted">{s.notes ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default SubnetsPage
