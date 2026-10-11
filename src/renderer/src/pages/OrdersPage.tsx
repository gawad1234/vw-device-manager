import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ShopOrder } from '../../../shared/types'
import OrderModal from '../components/OrderModal'

type Filter = 'all' | 'open' | 'complete'

interface Stats {
  totalQty: number
  recvQty: number
  outstanding: number
  status: 'empty' | 'open' | 'partial' | 'complete'
}

export function orderStats(o: ShopOrder): Stats {
  const lines = [
    ...o.items.map((i) => ({ q: i.quantity, r: i.received })),
    ...(o.cables ?? []).map((c) => ({ q: c.quantity, r: c.received }))
  ]
  const totalQty = lines.reduce((s, x) => s + (Number(x.q) || 0), 0)
  const recvQty = lines.reduce((s, x) => s + Math.min(Number(x.r) || 0, Number(x.q) || 0), 0)
  const outstanding = Math.max(0, totalQty - recvQty)
  const status =
    lines.length === 0
      ? 'empty'
      : outstanding === 0
        ? 'complete'
        : recvQty > 0
          ? 'partial'
          : 'open'
  return { totalQty, recvQty, outstanding, status }
}

const STATUS_LABEL: Record<Stats['status'], string> = {
  empty: 'No items',
  open: 'Not received',
  partial: 'Partial',
  complete: 'Complete'
}
const STATUS_CLASS: Record<Stats['status'], string> = {
  empty: 'badge',
  open: 'badge badge-open',
  partial: 'badge badge-warn',
  complete: 'badge badge-ok'
}

function OrdersPage(): React.JSX.Element {
  const [orders, setOrders] = useState<ShopOrder[]>([])
  const [openId, setOpenId] = useState<number | 'new' | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')

  const refresh = useCallback(async () => {
    setOrders(await window.api.orders.list())
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    if (typeof openId === 'number' && !orders.some((o) => o.id === openId)) setOpenId(null)
  }, [orders, openId])

  const openOrder =
    openId === 'new'
      ? null
      : typeof openId === 'number'
        ? (orders.find((o) => o.id === openId) ?? null)
        : null

  // Everything still outstanding, across all orders (equipment + cables).
  const waiting = useMemo(
    () =>
      orders.flatMap((o) => [
        ...o.items
          .map((i) => ({
            order: o.name,
            label: i.name,
            waiting: Math.max(0, (Number(i.quantity) || 0) - (Number(i.received) || 0))
          }))
          .filter((w) => w.waiting > 0 && w.label.trim()),
        ...(o.cables ?? [])
          .map((c) => ({
            order: o.name,
            label: `${c.cableType} ${c.length}`.trim(),
            waiting: Math.max(0, (Number(c.quantity) || 0) - (Number(c.received) || 0))
          }))
          .filter((w) => w.waiting > 0 && w.label.trim())
      ]),
    [orders]
  )

  const visible = orders.filter((o) => {
    if (filter === 'all') return true
    const st = orderStats(o).status
    return filter === 'complete' ? st === 'complete' : st === 'open' || st === 'partial'
  })

  return (
    <div className="page">
      <div className="page-header">
        <h2>Shop orders</h2>
        <div className="page-header-actions">
          <select
            className="cat-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="all">All orders</option>
            <option value="open">Open (waiting)</option>
            <option value="complete">Complete</option>
          </select>
          <button className="btn btn-primary" onClick={() => setOpenId('new')}>
            + New order
          </button>
        </div>
      </div>

      {waiting.length > 0 && (
        <div className="panel">
          <h3>
            Still waiting on{' '}
            <span className="cat-count">
              {waiting.reduce((s, w) => s + w.waiting, 0)} item(s)
            </span>
          </h3>
          <ul className="signal-list" style={{ maxWidth: 620 }}>
            {waiting.map((w, i) => (
              <li key={i}>
                <span>
                  <strong>{w.waiting}×</strong> {w.label}
                  <span className="muted"> — {w.order}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Vendor</th>
            <th>Date</th>
            <th>Received</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {!loading && visible.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-cell">
                {orders.length === 0 ? 'No orders yet.' : 'No orders match this filter.'}
              </td>
            </tr>
          )}
          {visible.map((o) => {
            const s = orderStats(o)
            return (
              <tr key={o.id} className="clickable" onClick={() => setOpenId(o.id)}>
                <td>{o.name}</td>
                <td className="muted">{o.vendor ?? '—'}</td>
                <td className="muted">{o.orderDate ?? '—'}</td>
                <td className="muted">
                  {s.recvQty}/{s.totalQty}
                </td>
                <td>
                  <span className={STATUS_CLASS[s.status]}>{STATUS_LABEL[s.status]}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {openId != null && (
        <OrderModal
          order={openOrder}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
          onCreated={(id) => setOpenId(id)}
        />
      )}
    </div>
  )
}

export default OrdersPage
