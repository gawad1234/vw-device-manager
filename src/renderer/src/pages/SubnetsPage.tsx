import { useEffect, useState } from 'react'
import type { Subnet, SubnetInput } from '../../../shared/types'

const EMPTY_FORM: SubnetInput = { name: '', cidr: '', vlan: null, gateway: null, notes: null }

interface Props {
  subnets: Subnet[]
  onChanged: () => void
}

function SubnetsPage({ subnets, onChanged }: Props): React.JSX.Element {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<SubnetInput>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!showForm) {
      setEditingId(null)
      setForm(EMPTY_FORM)
      setError(null)
    }
  }, [showForm])

  function startEdit(subnet: Subnet): void {
    setEditingId(subnet.id)
    setForm({
      name: subnet.name,
      cidr: subnet.cidr,
      vlan: subnet.vlan,
      gateway: subnet.gateway,
      notes: subnet.notes
    })
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
    onChanged()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Subnets</h2>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Add subnet'}
        </button>
      </div>

      {showForm && (
        <form className="panel form-grid" onSubmit={handleSubmit}>
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
            <th>VLAN</th>
            <th>Gateway</th>
            <th>Notes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {subnets.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-cell">
                No subnets yet. Add one to start assigning device IPs.
              </td>
            </tr>
          )}
          {subnets.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>
                <code>{s.cidr}</code>
              </td>
              <td>{s.vlan ?? '—'}</td>
              <td>{s.gateway ?? '—'}</td>
              <td className="muted">{s.notes ?? '—'}</td>
              <td className="row-actions">
                <button className="btn btn-small" onClick={() => startEdit(s)}>
                  Edit
                </button>
                <button className="btn btn-small btn-danger" onClick={() => handleDelete(s)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default SubnetsPage
