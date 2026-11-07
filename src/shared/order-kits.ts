import type { CableOrderItem, OrderItem, OrderKit } from './types'

/** Case-insensitive match of a kit trigger against one field value. A trigger with
 *  no "*" matches exactly; "*" is a wildcard (e.g. *M4350* = contains, M4350* = starts with). */
function kitMatches(trigger: string, value: string): boolean {
  const p = trigger.trim().toLowerCase()
  const v = value.trim().toLowerCase()
  if (!p || !v) return false
  if (!p.includes('*')) return p === v
  const rx = new RegExp(
    '^' + p.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '.*' : '\\' + c)) + '$'
  )
  return rx.test(v)
}

export const qtyOf = (it: OrderItem): number => Math.max(0, Math.trunc(Number(it.quantity) || 0))

/** Is this kit's first companion on the order? Tells a kit already applied from
 *  one created after the order was made. */
export function kitIsOnOrder(kit: OrderKit, items: OrderItem[], cables: CableOrderItem[]): boolean {
  const a = kit.addons[0]
  if (!a) return false
  const same = (x: string | null | undefined, y: string | null | undefined): boolean =>
    (x ?? '').trim().toLowerCase() === (y ?? '').trim().toLowerCase()
  return a.kind === 'equipment'
    ? items.some((it) => same(it.name, a.name) && same(it.modelNumber, a.modelNumber))
    : cables.some((c) => same(c.cableType, a.cableType) && same(c.length, a.length))
}

/** All kits whose trigger matches the item's name, model, or manufacturer. */
export function matchingKits(kits: OrderKit[], item: OrderItem): OrderKit[] {
  const fields = [item.name, item.modelNumber ?? '', item.manufacturer ?? '']
  return kits.filter((k) => k.trigger.trim() !== '' && fields.some((f) => kitMatches(k.trigger, f)))
}

/** Fold a kit's companions into the item/cable lists, scaled by `qty`, merging
 *  into an existing matching line rather than duplicating. A negative `qty` takes
 *  companions back off (never below 0). */
export function applyKitToLines(
  items: OrderItem[],
  cables: CableOrderItem[],
  kit: OrderKit,
  qty: number
): { items: OrderItem[]; cables: CableOrderItem[] } {
  let outItems = items
  let outCables = cables
  for (const a of kit.addons) {
    const addQty = Math.max(0, Math.trunc(Number(a.perUnit) || 0)) * qty
    if (addQty === 0) continue
    if (a.kind === 'equipment') {
      const key = a.name.trim().toLowerCase()
      if (!key) continue
      const idx = outItems.findIndex((it) => it.name.trim().toLowerCase() === key)
      outItems =
        idx >= 0
          ? outItems.map((it, j) =>
              j === idx ? { ...it, quantity: Math.max(0, (Number(it.quantity) || 0) + addQty) } : it
            )
          : addQty < 0
            ? outItems
            : [
              ...outItems,
              {
                name: a.name,
                manufacturer: a.manufacturer,
                modelNumber: a.modelNumber,
                category: a.category,
                quantity: addQty,
                received: 0,
                notes: null
              }
            ]
    } else {
      const kt = a.cableType.trim().toLowerCase()
      if (!kt) continue
      const kl = a.length.trim().toLowerCase()
      const idx = outCables.findIndex(
        (c) => c.cableType.trim().toLowerCase() === kt && c.length.trim().toLowerCase() === kl
      )
      outCables =
        idx >= 0
          ? outCables.map((c, j) =>
              j === idx ? { ...c, quantity: Math.max(0, (Number(c.quantity) || 0) + addQty) } : c
            )
          : addQty < 0
            ? outCables
            : [...outCables, { cableType: a.cableType, length: a.length, quantity: addQty, received: 0, notes: null }]
    }
  }
  return { items: outItems, cables: outCables }
}
