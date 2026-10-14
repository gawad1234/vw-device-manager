import { useEffect, useState } from 'react'
import type {
  CableOrderItem,
  OrderExportFormat,
  OrderItem,
  ShopOrder,
  ShopOrderInput
} from '../../../shared/types'
import Modal from './Modal'
import ExportMenu, { type ExportSection } from './ExportMenu'
import OrderFormatModal from './OrderFormatModal'

const ORDER_SECTIONS: ExportSection[] = [
  {
    label: 'Pull order (for the shop)',
    items: [
      { label: 'PDF', doc: 'order', format: 'pdf' },
      { label: 'Excel', doc: 'order', format: 'xlsx' },
      { label: 'CSV', doc: 'order', format: 'csv' }
    ]
  },
  {
    label: 'Receiving checklist (for the team)',
    items: [
      { label: 'PDF', doc: 'receiving', format: 'pdf' },
      { label: 'Excel', doc: 'receiving', format: 'xlsx' },
      { label: 'CSV', doc: 'receiving', format: 'csv' }
    ]
  }
]

const BLANK: OrderItem = {
  name: '',
  manufacturer: null,
  modelNumber: null,
  category: null,
  quantity: 1,
  received: 0,
  notes: null
}
const BLANK_CABLE: CableOrderItem = {
  cableType: '',
  length: '',
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
  const [cables, setCables] = useState<CableOrderItem[]>(order?.cables ?? [])
  const [error, setError] = useState<string | null>(null)
  const [importNote, setImportNote] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [section, setSection] = useState<'equipment' | 'cables'>('equipment')
  const [formats, setFormats] = useState<OrderExportFormat[]>([])
  const [formatId, setFormatId] = useState<number | null>(null)
  const [managingFormats, setManagingFormats] = useState(false)

  const refreshFormats = (): void => {
    window.api.orderFormats.list().then((list) => {
      setFormats(list)
      // drop a selection that was just deleted
      setFormatId((prev) => (prev != null && !list.some((f) => f.id === prev) ? null : prev))
    })
  }

  useEffect(() => {
    window.api.deviceCategories.list().then(setCategories)
    refreshFormats()
  }, [])

  useEffect(() => {
    setName(order?.name ?? '')
    setVendor(order?.vendor ?? '')
    setOrderDate(order?.orderDate ?? '')
    setNotes(order?.notes ?? '')
    setItems(order?.items ?? [])
    setCables(order?.cables ?? [])
    setError(null)
    setImportNote(null)
    setSection('equipment')
  }, [order?.id])

  // ---- equipment items ----
  function patchItem(i: number, patch: Partial<OrderItem>): void {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }
  function removeItem(i: number): void {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }
  function addItem(): void {
    setItems((prev) => [...prev, { ...BLANK }])
  }
  function receiveAllItems(): void {
    setItems((prev) => prev.map((it) => ({ ...it, received: it.quantity })))
  }

  async function importFromDrawing(): Promise<void> {
    const devices = await window.api.devices.list()
    if (devices.length === 0) {
      setImportNote('No devices in this project yet — link them from Vectorworks first.')
      return
    }
    const counts = new Map<string, { count: number; fromModel: boolean; category: string | null }>()
    for (const d of devices) {
      const model = d.deviceType?.trim()
      const key = (model || d.name?.trim() || 'Unknown').trim()
      const cat = d.category?.trim() || null
      const e = counts.get(key)
      if (e) {
        e.count++
        if (e.category !== cat) e.category = null
      } else {
        counts.set(key, { count: 1, fromModel: Boolean(model), category: cat })
      }
    }
    const existing = new Set(items.map((i) => i.name.trim().toLowerCase()))
    const additions: OrderItem[] = [...counts.entries()]
      .filter(([key]) => !existing.has(key.toLowerCase()))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, { count, fromModel, category }]) => ({
        name: key,
        manufacturer: null,
        modelNumber: fromModel ? key : null,
        category,
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

  function onPasteItems(e: React.ClipboardEvent): void {
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
          category: (c[6] ?? '').trim() || null,
          quantity: q ? Math.max(0, Math.trunc(Number(q) || 0)) : 1,
          received: Math.max(0, Math.trunc(Number((c[4] ?? '').trim()) || 0)),
          notes: (c[5] ?? '').trim() || null
        }
      })
    if (parsed.length === 0) return
    setItems((prev) => [...prev, ...parsed])
    setImportNote(
      `Pasted ${parsed.length} row(s). Column order: Item, Manufacturer, Model, Ordered, Received, Notes, Category.`
    )
  }

  // ---- cable lines ----
  function patchCable(i: number, patch: Partial<CableOrderItem>): void {
    setCables((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }
  function removeCable(i: number): void {
    setCables((prev) => prev.filter((_, idx) => idx !== i))
  }
  function addCable(): void {
    setCables((prev) => [...prev, { ...BLANK_CABLE }])
  }
  function receiveAllCables(): void {
    setCables((prev) => prev.map((c) => ({ ...c, received: c.quantity })))
  }

  // Pull cables from the bundles, grouped by type AND length, with counts.
  async function importCables(): Promise<void> {
    const bundles = await window.api.bundles.list()
    const all = bundles.flatMap((b) =>
      b.cables.map((c) => ({
        type: c.cableType?.trim() || 'Cable (untyped)',
        length: b.length?.trim() || ''
      }))
    )
    if (all.length === 0) {
      setImportNote('No cables in this project yet — add some in the Cables tab first.')
      return
    }
    const counts = new Map<string, { type: string; length: string; count: number }>()
    for (const x of all) {
      const key = x.type + '\u0001' + x.length
      const e = counts.get(key)
      if (e) e.count++
      else counts.set(key, { type: x.type, length: x.length, count: 1 })
    }
    const existing = new Set(cables.map((c) => (c.cableType + '\u0001' + c.length).toLowerCase()))
    const additions: CableOrderItem[] = [...counts.values()]
      .filter((v) => !existing.has((v.type + '\u0001' + v.length).toLowerCase()))
      .sort((a, b) => a.type.localeCompare(b.type) || a.length.localeCompare(b.length))
      .map((v) => ({
        cableType: v.type,
        length: v.length,
        quantity: v.count,
        received: 0,
        notes: null
      }))
    if (additions.length === 0) {
      setImportNote('Nothing new — those cable type/length combos are already on this order.')
      return
    }
    setCables((prev) => [...prev, ...additions])
    const skipped = counts.size - additions.length
    setImportNote(
      `Imported ${additions.length} cable line(s) from ${all.length} cable(s) across ${bundles.length} bundle(s)` +
        (skipped > 0 ? ` (${skipped} already on the order)` : '') +
        '. Review quantities, then Save.'
    )
  }

  function onPasteCables(e: React.ClipboardEvent): void {
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const multi = text.includes('\t') || text.replace(/\r/g, '').trim().includes('\n')
    if (!multi) return
    e.preventDefault()
    const parsed: CableOrderItem[] = text
      .replace(/\r/g, '')
      .split('\n')
      .filter((r) => r.trim().length)
      .map((r) => {
        const c = r.split('\t')
        const q = (c[2] ?? '').trim()
        return {
          cableType: (c[0] ?? '').trim(),
          length: (c[1] ?? '').trim(),
          quantity: q ? Math.max(0, Math.trunc(Number(q) || 0)) : 1,
          received: Math.max(0, Math.trunc(Number((c[3] ?? '').trim()) || 0)),
          notes: (c[4] ?? '').trim() || null
        }
      })
    if (parsed.length === 0) return
    setCables((prev) => [...prev, ...parsed])
    setImportNote(
      `Pasted ${parsed.length} cable row(s). Column order: Type, Length, Quantity, Received, Notes.`
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
        category: it.category?.trim() || null,
        quantity: Math.max(0, Math.trunc(Number(it.quantity) || 0)),
        received: Math.max(0, Math.trunc(Number(it.received) || 0)),
        notes: it.notes
      })),
      cables: cables.map((c) => ({
        cableType: c.cableType,
        length: c.length,
        quantity: Math.max(0, Math.trunc(Number(c.quantity) || 0)),
        received: Math.max(0, Math.trunc(Number(c.received) || 0)),
        notes: c.notes
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

  async function saveCurrent(): Promise<void> {
    if (!order) return
    await window.api.orders.update(order.id, currentInput())
    onChanged()
  }

  const itemsRecv = items.reduce((s, i) => s + Math.min(Number(i.received) || 0, Number(i.quantity) || 0), 0)
  const itemsTot = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)
  const cablesRecv = cables.reduce((s, c) => s + Math.min(Number(c.received) || 0, Number(c.quantity) || 0), 0)
  const cablesTot = cables.reduce((s, c) => s + (Number(c.quantity) || 0), 0)

  const footer = (
    <>
      {order && (
        <>
          <button className="btn btn-danger" onClick={handleDelete}>
            Delete
          </button>
          <ExportMenu
            scope="all"
            orderId={order.id}
            sections={ORDER_SECTIONS}
            onBeforeRun={saveCurrent}
            highlightToggle
            formats={formats}
            formatId={formatId}
            onSelectFormat={setFormatId}
            onManageFormats={() => setManagingFormats(true)}
            dropUp
          />
        </>
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
    <>
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
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Rental House" />
        </label>
        <label>
          Order date
          <input value={orderDate} onChange={(e) => setOrderDate(e.target.value)} placeholder="e.g. 2026-10-11" />
        </label>
        <label className="span-2">
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
      </form>

      <div className="modal-section">
        <nav className="subtabs">
          <button
            type="button"
            className={`tab ${section === 'equipment' ? 'active' : ''}`}
            onClick={() => setSection('equipment')}
          >
            Equipment <span className="cat-count">{itemsRecv}/{itemsTot}</span>
          </button>
          <button
            type="button"
            className={`tab ${section === 'cables' ? 'active' : ''}`}
            onClick={() => setSection('cables')}
          >
            Cables <span className="cat-count">{cablesRecv}/{cablesTot}</span>
          </button>
        </nav>

        {section === 'equipment' ? (
          <>
            <p className="muted">
              Edit inline like a spreadsheet. Click a <strong>Wait</strong> cell to mark a line fully
              received. Paste rows from Excel (Item, Manufacturer, Model, Ordered, Received, Notes).
            </p>
            <div className="sheet-wrap" onPaste={onPasteItems}>
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Manufacturer</th>
                    <th>Model #</th>
                    <th>Category</th>
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
                      <td colSpan={9} className="sheet-empty">
                        No items — add a row, import from the drawing, or paste from Excel.
                      </td>
                    </tr>
                  )}
                  {items.map((it, i) => {
                    const qty = Number(it.quantity) || 0
                    const recv = Number(it.received) || 0
                    const out = Math.max(0, qty - recv)
                    const done = qty > 0 && recv >= qty
                    return (
                      <tr key={i} className={done ? 'item-received' : ''}>
                        <td>
                          <input value={it.name} placeholder="Item / description" onChange={(e) => patchItem(i, { name: e.target.value })} />
                        </td>
                        <td>
                          <input value={it.manufacturer ?? ''} onChange={(e) => patchItem(i, { manufacturer: e.target.value || null })} />
                        </td>
                        <td>
                          <input value={it.modelNumber ?? ''} onChange={(e) => patchItem(i, { modelNumber: e.target.value || null })} />
                        </td>
                        <td>
                          <select value={it.category ?? ''} onChange={(e) => patchItem(i, { category: e.target.value || null })}>
                            <option value="">—</option>
                            {it.category && !categories.includes(it.category) && (
                              <option value={it.category}>{it.category}</option>
                            )}
                            {categories.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num">
                          <input type="number" min={0} value={it.quantity} onChange={(e) => patchItem(i, { quantity: Number(e.target.value) })} />
                        </td>
                        <td className="num">
                          <input type="number" min={0} value={it.received} onChange={(e) => patchItem(i, { received: Number(e.target.value) })} />
                        </td>
                        <td className="num waiting-cell" role="button" title="Click to mark fully received" onClick={() => patchItem(i, { received: qty })}>
                          {done ? '✓' : out}
                        </td>
                        <td>
                          <input value={it.notes ?? ''} onChange={(e) => patchItem(i, { notes: e.target.value || null })} />
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
              <button type="button" className="btn btn-small" onClick={importFromDrawing} title="Add a line per equipment Model from the Vectorworks drawing">
                Import from drawing
              </button>
              {itemsRecv < itemsTot && (
                <button type="button" className="btn btn-small" onClick={receiveAllItems}>
                  Receive everything
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              Cable lines are by <strong>type and length</strong> with a quantity. Click a{' '}
              <strong>Wait</strong> cell to mark a line fully received. Paste from Excel (Type, Length,
              Quantity, Received, Notes).
            </p>
            <div className="sheet-wrap" onPaste={onPasteCables}>
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Cable type</th>
                    <th>Length</th>
                    <th className="num">Qty</th>
                    <th className="num">Recv</th>
                    <th className="num">Wait</th>
                    <th>Notes</th>
                    <th aria-label="remove" />
                  </tr>
                </thead>
                <tbody>
                  {cables.length === 0 && (
                    <tr>
                      <td colSpan={7} className="sheet-empty">
                        No cable lines — add a row, import from the bundles, or paste from Excel.
                      </td>
                    </tr>
                  )}
                  {cables.map((c, i) => {
                    const qty = Number(c.quantity) || 0
                    const recv = Number(c.received) || 0
                    const out = Math.max(0, qty - recv)
                    const done = qty > 0 && recv >= qty
                    return (
                      <tr key={i} className={done ? 'item-received' : ''}>
                        <td>
                          <input value={c.cableType} placeholder="e.g. Cat6" onChange={(e) => patchCable(i, { cableType: e.target.value })} />
                        </td>
                        <td>
                          <input value={c.length} placeholder="e.g. 50'" onChange={(e) => patchCable(i, { length: e.target.value })} />
                        </td>
                        <td className="num">
                          <input type="number" min={0} value={c.quantity} onChange={(e) => patchCable(i, { quantity: Number(e.target.value) })} />
                        </td>
                        <td className="num">
                          <input type="number" min={0} value={c.received} onChange={(e) => patchCable(i, { received: Number(e.target.value) })} />
                        </td>
                        <td className="num waiting-cell" role="button" title="Click to mark fully received" onClick={() => patchCable(i, { received: qty })}>
                          {done ? '✓' : out}
                        </td>
                        <td>
                          <input value={c.notes ?? ''} onChange={(e) => patchCable(i, { notes: e.target.value || null })} />
                        </td>
                        <td className="rm">
                          <button type="button" title="Remove row" onClick={() => removeCable(i)}>
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
              <button type="button" className="btn btn-small" onClick={addCable}>
                + Add row
              </button>
              <button type="button" className="btn btn-small" onClick={importCables} title="Add a line per cable type + length from the Cables tab">
                Import cables
              </button>
              {cablesRecv < cablesTot && (
                <button type="button" className="btn btn-small" onClick={receiveAllCables}>
                  Receive everything
                </button>
              )}
            </div>
          </>
        )}

        {importNote && (
          <p className="muted" style={{ marginTop: 8 }}>
            {importNote}
          </p>
        )}
      </div>
    </Modal>
    {managingFormats && (
      <OrderFormatModal onClose={() => setManagingFormats(false)} onChanged={refreshFormats} />
    )}
    </>
  )
}

export default OrderModal
