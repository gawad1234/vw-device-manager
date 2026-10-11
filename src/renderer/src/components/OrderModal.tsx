import { useEffect, useState } from 'react'
import type { OrderItem, ShopOrder, ShopOrderInput } from '../../../shared/types'
import Modal from './Modal'

const BLANK: OrderItem = {
  name: '',
  manufacturer: null,
  modelNumber: null,
  quantity: 1,
  received: 0,
  notes: null
}

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
    const counts = new Map<string, { count: number; fromModel: boolean }>()
    for (const d of devices) {
      const model = d.deviceType?.trim()
      const key = (model || d.name?.trim() || 'Unknown').trim()
      const e = counts.get(key)
      if (e) e.count++
      else counts.set(key, { count: 1, fromModel: Boolean(model) })
    }
    const existing = new Set(items.map((i) => i.name.trim().toLowerCase()))
    const additions: OrderItem[] = [...counts.entries()]
      .filter(([key]) => !existing.has(key.toLowerCase()))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, { count, fromModel }]) => ({
        name: key,
        manufacturer: null,
        modelNumber: fromModel ? key : null,
        quantity: count,
        received: 0,
        notes: null
      }))
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

  // Paste a block copied from Excel/Sheets: tab-separated columns, one row per
  // line → Item, Manufacturer, Model, Ordered, Received, Notes. A single value
  // (no tabs/newlines) pastes normally into the focused cell.
  function onPaste(e: React.ClipboardEvent): void {
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const multi = text.includes('\t') || text.replace(/\r/g, '').trim().includes('\n')
    if (!multi) return
    e.preventDefault()
    const parsed: OrderItem[] = text
      .replace(/\r/g, '')
      .split('\n')
      .filter((r) => r.trim().length)
      .map((r) => {
        const c = r.split('\t')
        const q = (c[3] ?? '').trim()
        return {
          name: (c[0] ?? '').trim(),
          manufacturer: (c[1] ?? '').trim() || null,
          modelNumber: (c[2] ?? '').trim() || null,
          quantity: q ? Math.max(0, Math.trunc(Number(q) || 0)) : 1,
          received: Math.max(0, Math.trunc(Number((c[4] ?? '').trim()) || 0)),
          notes: (c[5] ?? '').trim() || null
        }
      })
    if (parsed.length === 0) return
    setItems((prev) => [...prev, ...parsed])
    setImportNote(
      `Pasted ${parsed.length} row(s). Column order: Item, Manufacturer, Model, Ordered, Received, Notes.`
    )
  }

  function currentInput(): ShopOrderInput {
    return {
      name: name.trim(),
      vendor: vendor.trim() || null,
      orderDate: orderDate.trim() || null,
      notes: notes.trim() || null,
      items: items.map((it) => ({
        name: it.name,
        manufacturer: it.manufacturer?.trim() || null,
        modelNumber: it.modelNumber?.trim() || null,
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
    <Modal title={order ? order.name : 'New order'} onClose={onClose} footer={footer} wide>
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
          Edit inline like a spreadsheet. Click a cell in the <strong>Wait</strong> column to mark
          that line fully received. You can also <strong>paste rows straight from Excel</strong>
          (columns: Item, Manufacturer, Model, Ordered, Received, Notes).
        </p>

        <div className="sheet-wrap" onPaste={onPaste}>
          <table className="sheet">
            <thead>
              <tr>
                <th>Item</th>
                <th>Manufacturer</th>
                <th>Model #</th>
                <th className="num">Ord</th>
                <th className="num">Recv</th>
                <th className="num">Wait</th>
                <th>Notes</th>
                <th aria-label="remove" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="sheet-empty">
                    No items — add a row, import from the drawing, or paste from Excel.
                  </td>
                </tr>
              )}
              {items.map((it, i) => {
                const qty = Number(it.quantity) || 0
                const recv = Number(it.received) || 0
                const outstanding = Math.max(0, qty - recv)
                const done = qty > 0 && recv >= qty
                return (
                  <tr key={i} className={done ? 'item-received' : ''}>
                    <td>
                      <input
                        value={it.name}
                        placeholder="Item / description"
                        onChange={(e) => patchItem(i, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={it.manufacturer ?? ''}
                        onChange={(e) => patchItem(i, { manufacturer: e.target.value || null })}
                      />
                    </td>
                    <td>
                      <input
                        value={it.modelNumber ?? ''}
                        onChange={(e) => patchItem(i, { modelNumber: e.target.value || null })}
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        value={it.quantity}
                        onChange={(e) => patchItem(i, { quantity: Number(e.target.value) })}
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        value={it.received}
                        onChange={(e) => patchItem(i, { received: Number(e.target.value) })}
                      />
                    </td>
                    <td
                      className="num waiting-cell"
                      role="button"
                      title="Click to mark this line fully received"
                      onClick={() => patchItem(i, { received: qty })}
                    >
                      {done ? '✓' : outstanding}
                    </td>
                    <td>
                      <input
                        value={it.notes ?? ''}
                        onChange={(e) => patchItem(i, { notes: e.target.value || null })}
                      />
                    </td>
                    <td className="rm">
                      <button type="button" title="Remove row" onClick={() => removeItem(i)}>
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="signal-add" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-small" onClick={addItem}>
            + Add row
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
