import { defaultOrderColumns, type OrderExportFormatInput } from '../../../shared/types'

/** Leaving the page drops typed changes in an open dialog, so ask first. */
function confirmLeaveUnsaved(): boolean {
  return (
    !document.querySelector('.modal[data-dirty]') ||
    window.confirm('Close without saving your changes?')
  )
}

/** Open Paperwork on a template (App switches to the page) — the export menus' "Edit layout…". */
export const openPaperwork = (templateId: string): void => {
  if (!confirmLeaveUnsaved()) return
  window.dispatchEvent(new CustomEvent('open-paperwork', { detail: templateId }))
}

const ORDER_FORMAT = 'order-format:'

/** Open Paperwork's Orders list: on `formatId`, previewing `orderId`'s items. */
export const openOrderFormats = (formatId: number | null, orderId: number): void =>
  openPaperwork(`${ORDER_FORMAT}${formatId ?? ''}:${orderId}`)

/** The format and order named by a Paperwork selection, or null for any other template. */
export function parseOrderFormat(id: string): { formatId: number | null; orderId: number | null } | null {
  if (!id.startsWith(ORDER_FORMAT)) return null
  const [formatId, orderId] = id.slice(ORDER_FORMAT.length).split(':')
  return { formatId: Number(formatId) || null, orderId: Number(orderId) || null }
}

export const orderFormatSelection = (formatId: number): string => `${ORDER_FORMAT}${formatId}`

/** A blank format, ready to edit. */
export const NEW_FORMAT: OrderExportFormatInput = {
  name: 'New order format',
  columns: defaultOrderColumns(),
  groupByCategory: true,
  sort: 'category',
  orientation: 'portrait',
  fontSize: 12,
  layout: 'standard'
}

/** A ready-made format in the equipment-list look (shop paperwork style). */
export const EQUIPMENT_LIST: OrderExportFormatInput = {
  name: 'Equipment list',
  columns: (
    [
      ['requested', 'New Qty', 8],
      ['previous', 'Old Qty', 8],
      ['item', 'Item', 40],
      ['model', 'Mfr. P/N', 15],
      ['manufacturer', 'Manufacturer', 14],
      ['received', 'Filled', 7],
      ['outstanding', 'Balance', 8],
      ['category', '', 16],
      ['notes', '', 24]
    ] as const
  ).map(([key, label, width]) => ({ key, label, width, show: label !== '' })),
  groupByCategory: true,
  sort: 'category',
  orientation: 'portrait',
  fontSize: 11,
  layout: 'equipmentList'
}
