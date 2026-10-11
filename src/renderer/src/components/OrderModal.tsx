import { useEffect, useState } from 'react'
import type { OrderItem, ShopOrder, ShopOrderInput } from '../../../shared/types'
import Modal from './Modal'

const BLANK: OrderItem = { name: '', quantity: 1, received: 0, notes: null }

interface Props {
  order: ShopOrder | null
  onClose: () => void
  onChanged: () => void
  onCreated: (id: number) => void
}

function OrderModal({ order, onClose, onChanged, onCreated }: Props): React.JSX.Element {
  const [name, setName] = useState(order?.name ?? '')
  const [vendor, setVendor] = useState(order?.vendor ?? '')
  const [orderDate, setOrderDate] = useState(order?.orderDate ?? '')
  const [notes, setNotes] = useState(order?.notes ?? '')
  const [items, setItems] = useState<OrderItem[]>(order?.items ?? [])
  const [error, setError] = useState<string | null>(null)
  const [importNote, setImportNote] = useState<string | null>(null)

  useEffect(() => {
    setName(order?.name ?? '')
    setVendor(order?.vendor ?? '')
    setOrderDate(order?.orderDate ?? '')
    setNotes(order?.notes ?? '')
    setItems(order?.items ?? [])
    setError(null)
    setImportNote(null)
  }, [order?.id])

  // Pull equipment from the Vectorworks drawing (the project's synced devices),
  // grouped into a bill of materials: one line per Model/type with its count
  // (falling back to the device name when a device has no Model). Lines already
  // on the order (by name) are left alone so re-importing doesn't duplicate.
  async function importFromDrawing(): Promise<void> {
    const devices = await window.api.devices.list()
    if (devices.length === 0) {
      setImportNote('No devices in this project yet — link them from Vectorworks first.')
      return
    }
    const counts = new Map<string, number>()
    for (const d of devices) {
      const key = (d.deviceType?.trim() || d.name?.trim() || 'Unknown').trim()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const existing = new Set(items.map((i) => i.name.trim().toLowerCase()))
    const additions: OrderItem[] = [...counts.entries()]
      .filter(([name]) => !existing.has(name.toLowerCase()))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, quantity]) => ({ name, quantity, received: 0, notes: null }))
    if (additions.length === 0) {
      setImportNote('Nothing new to import — every drawing item is already on this order.')
      return
    }
    setItems((prev) => [...prev, ...additions])
    const skipped = counts.size - additions.length
    setImportNote(
      `Imported ${additions.length} item type(s) from ${devices.length} device(s)` +
        (skipped > 0 ? ` (${skipped} already on the order)` : '') +
        '. Review quantities, then Save.'
    )
  }

  function patchItem(i: number, patch: Partial<OrderItem>): void {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }
  function removeItem(i: number): void {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }
  function addItem(): void {
    setItems((prev) => [...prev, { ...BLANK }])
  }
  function receiveAll(): void {
    setItems((prev) => prev.map((it) => ({ ...it, received: it.quantity })))
  }

  function currentInput(): ShopOrderInput {
    return {
      name: name.trim(),
      vendor: vendor.trim() || null,
      orderDate: orderDate.trim() || null,
      notes: notes.trim() || null,
      items: items.map((it) => ({
        name: it.name,
        quantity: Math.max(0, Math.trunc(Number(it.quantity) || 0)),
        received: Math.max(0, Math.trunc(Number(it.received) || 0)),
        notes: it.notes
      }))
    }
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!name.trim()) {
      setError('Order name is required.')
      return
    }
    setError(null)
    const saved = order
      ? await window.api.orders.update(order.id, currentInput())
      : await window.api.orders.create(currentInput())
    onChanged()
    if (!order) onCreated(saved.id)
    else onClose()
  }

  async function handleDelete(): Promise<void> {
    if (!order) return
    if (!window.confirm(`Delete order "${order.name}"?`)) return
    await window.api.orders.remove(order.id)
    onChanged()
    onClose()
  }

  const totalQty = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)
  const recvQty = items.reduce(
    (s, i) => s + Math.min(Number(i.received) || 0, Number(i.quantity) || 0),
    0
  )

  const footer = (
    <>
      {order && (
        <button className="btn btn-danger" onClick={handleDelete}>
          Delete
        </button>
      )}
      <span className="footer-spacer" />
      <button className="btn" type="button" onClick={onClose}>
        Close
      </button>
      <button className="btn btn-primary" type="submit" form="order-form">
        {order ? 'Save changes' : 'Create order'}
      </button>
    </>
  )

  return (
    <Modal title={order ? order.name : 'New order'} onClose={onClose} footer={footer}>
      <form id="order-form" className="form-grid" onSubmit={save}>
        {error && <div className="banner banner-error">{error}</div>}
        <label>
          Order name / number
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. PO-1042 / Sub-rental A"
            autoFocus
          />
        </label>
        <label>
          Vendor / source
          <input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="e.g. Rental House"
          />
        </label>
        <label>
          Order date
          <input
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            placeholder="e.g. 2026-10-11"
          />
        </label>
        <label className="span-2">
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
      </form>

      <div className="modal-section">
        <h3>
          Equipment{' '}
          <span className="cat-count">
            {recvQty}/{totalQty} received
          </span>
        </h3>
        <p className="muted">
          Set the quantity ordered and how many have arrived. Anything still outstanding shows up
          in the &ldquo;still waiting&rdquo; list on the Orders tab.
        </p>

        {items.length === 0 && <p className="muted">No items yet — add one below.</p>}

        {items.map((it, i) => {
          const qty = Number(it.quantity) || 0
          const recv = Number(it.received) || 0
          const outstanding = Math.max(0, qty - recv)
          const done = qty > 0 && recv >= qty
          return (
            <div className={`port-row${done ? ' item-received' : ''}`} key={i}>
              <div className="port-fields">
                <label style={{ flex: '2 1 220px' }}>
                  Item
                  <input
                    value={it.name}
                    onChange={(e) => patchItem(i, { name: e.target.value })}
                    placeholder="e.g. Netgear M4250-10G2F"
                  />
                </label>
                <label style={{ flex: '0 1 90px' }}>
                  Ordered
                  <input
                    type="number"
                    min={0}
                    value={it.quantity}
                    onChange={(e) => patchItem(i, { quantity: Number(e.target.value) })}
                  />
                </label>
                <label style={{ flex: '0 1 90px' }}>
                  Received
                  <input
                    type="number"
                    min={0}
                    value={it.received}
                    onChange={(e) => patchItem(i, { received: Number(e.target.value) })}
                  />
                </label>
                <span className="item-outstanding muted" title="Still waiting">
                  {outstanding > 0 ? `${outstanding} waiting` : '✓ all in'}
                </span>
                <div className="port-actions">
                  <button
                    type="button"
                    className="btn btn-small"
                    title="Mark this line fully received"
                    onClick={() => patchItem(i, { received: qty })}
                    disabled={done}
                  >
                    Receive all
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    onClick={() => removeItem(i)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className="endpoint-row">
                <label className="endpoint-field" style={{ flex: '1 1 100%' }}>
                  Notes
                  <input
                    value={it.notes ?? ''}
                    onChange={(e) => patchItem(i, { notes: e.target.value || null })}
                    placeholder="(optional — serials, condition, etc.)"
                  />
                </label>
              </div>
            </div>
          )
        })}

        <div className="signal-add" style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-small" onClick={addItem}>
            + Add item
          </button>
          <button
            type="button"
            className="btn btn-small"
            title="Add a line per equipment Model from the Vectorworks drawing, with quantities"
            onClick={importFromDrawing}
          >
            Import from drawing
          </button>
          {items.length > 0 && recvQty < totalQty && (
            <button type="button" className="btn btn-small" onClick={receiveAll}>
              Receive everything
            </button>
          )}
        </div>
        {importNote && (
          <p className="muted" style={{ marginTop: 8 }}>
            {importNote}
          </p>
        )}
      </div>
    </Modal>
  )
}

export default OrderModal
