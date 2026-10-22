import type { TripKind } from '../../../shared/types'

export const TRIP_KINDS: { value: TripKind; label: string }[] = [
  { value: 'delivery', label: 'Delivery' },
  { value: 'load-in', label: 'Load-in' },
  { value: 'load-out', label: 'Load-out' },
  { value: 'return', label: 'Return' },
  { value: 'other', label: 'Other' }
]
