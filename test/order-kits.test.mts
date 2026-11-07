import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyKitToLines, kitIsOnOrder, matchingKits } from '../src/shared/order-kits.ts'

const addon = (name: string, perUnit: number): never =>
  ({ kind: 'equipment', name, manufacturer: null, modelNumber: null, category: null, cableType: '', length: '', perUnit }) as never
const cable = (cableType: string, length: string, perUnit: number): never =>
  ({ kind: 'cable', name: '', manufacturer: null, modelNumber: null, category: null, cableType, length, perUnit }) as never
const kit = { id: 1, trigger: 'MD-LX', addons: [addon('Power', 2), cable('Cat6', '25ft', 1)], createdAt: '', updatedAt: '' } as never
const line = (name: string, quantity: number): never =>
  ({ name, manufacturer: null, modelNumber: null, category: null, quantity, received: 0, notes: null }) as never

test('adding quantity adds companions for the difference', () => {
  const a = applyKitToLines([line('MD-LX', 1)], [], kit, 3)
  assert.equal(a.items[1].quantity, 6)
  assert.equal(a.cables[0].quantity, 3)
  const b = applyKitToLines(a.items, a.cables, kit, 2)
  assert.equal(b.items[1].quantity, 10)
  assert.equal(b.cables[0].quantity, 5)
})

test('taking quantity back stops at zero and never makes a new line', () => {
  const a = applyKitToLines([line('Power', 1)], [], kit, -3)
  assert.equal(a.items[0].quantity, 0)
  assert.equal(a.cables.length, 0)
})

test('a kit made after the order is not on it', () => {
  assert.equal(kitIsOnOrder(kit, [line('MD-LX', 1)], []), false)
  assert.equal(kitIsOnOrder(kit, [line('MD-LX', 1), line('Power', 2)], []), true)
})

test('triggers match name, with wildcards', () => {
  const wild = { ...(kit as object), trigger: '*LX' } as never
  assert.deepEqual(matchingKits([wild], line('MD-LX', 1)), [wild])
  assert.deepEqual(matchingKits([kit], line('Other', 1)), [])
})
