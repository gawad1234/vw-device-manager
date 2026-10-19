import { useEffect, useState } from 'react'
import type { KitAddon, OrderKit, OrderKitInput } from '../../../shared/types'
import Modal from './Modal'
import CategoryInput from './CategoryInput'

interface Props {
  categories: string[]
  onClose: () => void
  /** called after any create/update/delete so order editors pick up new kits */
  onChanged: () => void
}

type Draft = { trigger: string; addons: KitAddon[] }

const BLANK_ADDON: KitAddon = {
  kind: 'equipment',
  name: '',
  manufacturer: null,
  modelNumber: null,
  category: null,
  cableType: '',
  length: '',
  perUnit: 1
}

function draftFrom(k: OrderKit | null): Draft {
  if (!k) return { trigger: '', addons: [{ ...BLANK_ADDON }] }
  return { trigger: k.trigger, addons: k.addons.length ? k.addons : [{ ...BLANK_ADDON }] }
}

function KitModal({ categories, onClose, onChanged }: Props): React.JSX.Element {
  const [kits, setKits] = useState<OrderKit[]>([])
  const [activeId, setActiveId] = useState<number | 'new'>('new')
  const [draft, setDraft] = useState<Draft>(() => draftFrom(null))
  const [error, setError] = useState('')

  async function refresh(select?: number | 'new'): Promise<void> {
    const list = await window.api.orderKits.list()
    setKits(list)
    if (select !== undefined) setActiveId(select)
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (activeId === 'new') setDraft(draftFrom(null))
    else {
      const k = kits.find((x) => x.id === activeId)
      if (k) setDraft(draftFrom(k))
    }
    setError('')
  }, [activeId, kits])

  function setAddon(i: number, patch: Partial<KitAddon>): void {
    setDraft((d) => ({ ...d, addons: d.addons.map((a, idx) => (idx === i ? { ...a, ...patch } : a)) }))
  }
  function addAddon(): void {
    setDraft((d) => ({ ...d, addons: [...d.addons, { ...BLANK_ADDON }] }))
  }
  function removeAddon(i: number): void {
    setDraft((d) => ({ ...d, addons: d.addons.filter((_, idx) => idx !== i) }))
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!draft.trigger.trim()) {
      setError('Give the kit a trigger (the item name or model that pulls the companions).')
      return
    }
    // Keep only add-ons that name something, cleaned to the right fields per kind.
    const addons: KitAddon[] = draft.addons
      .filter((a) => (a.kind === 'equipment' ? a.name.trim() : a.cableType.trim()))
      .map((a) => ({
        kind: a.kind,
        name: a.kind === 'equipment' ? a.name.trim() : '',
        manufacturer: a.kind === 'equipment' ? a.manufacturer?.trim() || null : null,
        modelNumber: a.kind === 'equipment' ? a.modelNumber?.trim() || null : null,
        category: a.kind === 'equipment' ? a.category?.trim() || null : null,
        cableType: a.kind === 'cable' ? a.cableType.trim() : '',
        length: a.kind === 'cable' ? a.length.trim() : '',
        perUnit: Math.max(1, Math.trunc(Number(a.perUnit) || 1))
      }))
    if (addons.length === 0) {
      setError('Add at least one companion (an equipment item or a cable line).')
      return
    }
    const input: OrderKitInput = { trigger: draft.trigger.trim(), addons }
    const saved =
      activeId === 'new'
        ? await window.api.orderKits.create(input)
        : await window.api.orderKits.update(activeId, input)
    await refresh(saved.id)
    onChanged()
  }

  async function handleDelete(): Promise<void> {
    if (activeId === 'new') return
    const k = kits.find((x) => x.id === activeId)
    if (!k || !window.confirm(`Delete kit "${k.trigger}"?`)) return
    await window.api.orderKits.remove(activeId)
    await refresh('new')
    onChanged()
  }

  const footer = (
    <>
      {activeId !== 'new' && (
        <button className="btn btn-danger" onClick={handleDelete}>
          Delete
        </button>
      )}
      <span className="footer-spacer" />
      <button className="btn" type="button" onClick={onClose}>
        Close
      </button>
      <button
        className="btn btn-primary"
        type="submit"
        form="kit-form"
        disabled={!draft.trigger.trim()}
      >
        {activeId === 'new' ? 'Create kit' : 'Save changes'}
      </button>
    </>
  )

  return (
    <Modal title="Auto-add kits" onClose={onClose} footer={footer} wide>
      <div className="fmt-tabs">
        {kits.map((k) => (
          <button
            key={k.id}
            type="button"
            className={`fmt-tab${activeId === k.id ? ' active' : ''}`}
            onClick={() => setActiveId(k.id)}
          >
            {k.trigger}
          </button>
        ))}
        <button
          type="button"
          className={`fmt-tab fmt-new${activeId === 'new' ? ' active' : ''}`}
          onClick={() => setActiveId('new')}
        >
          + New
        </button>
      </div>

      <form id="kit-form" className="form-grid" onSubmit={save}>
        {error && <div className="banner banner-error span-2">{error}</div>}
        <label className="span-2">
          When an item named (or modelled) …
          <input
            value={draft.trigger}
            onChange={(e) => setDraft((d) => ({ ...d, trigger: e.target.value }))}
            placeholder="e.g. MDLX"
            autoFocus
          />
        </label>

        <div className="span-2">
          <div className="field-row-head">
            <span>Also add these</span>
            <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>
              per unit of the matched item
            </span>
          </div>
          {draft.addons.map((a, i) => (
            <div key={i} className="kit-addon">
              <select
                value={a.kind}
                onChange={(e) => setAddon(i, { kind: e.target.value as KitAddon['kind'] })}
                aria-label="Add-on kind"
              >
                <option value="equipment">Equipment</option>
                <option value="cable">Cable</option>
              </select>
              {a.kind === 'equipment' ? (
                <>
                  <input
                    value={a.name}
                    placeholder="Item name"
                    onChange={(e) => setAddon(i, { name: e.target.value })}
                  />
                  <input
                    value={a.modelNumber ?? ''}
                    placeholder="Model #"
                    onChange={(e) => setAddon(i, { modelNumber: e.target.value || null })}
                  />
                  <CategoryInput
                    value={a.category}
                    categories={categories}
                    onChange={(v) => setAddon(i, { category: v })}
                  />
                </>
              ) : (
                <>
                  <input
                    value={a.cableType}
                    placeholder="Cable type (e.g. USB-C to USB-A)"
                    onChange={(e) => setAddon(i, { cableType: e.target.value })}
                  />
                  <input
                    value={a.length}
                    placeholder="Length"
                    onChange={(e) => setAddon(i, { length: e.target.value })}
                  />
                </>
              )}
              <input
                type="number"
                min={1}
                className="kit-per"
                value={a.perUnit}
                title="How many per matched unit"
                onChange={(e) => setAddon(i, { perUnit: Math.max(1, Number(e.target.value) || 1) })}
              />
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={() => removeAddon(i)}
                aria-label="Remove add-on"
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-small" onClick={addAddon} style={{ marginTop: 8 }}>
            + Add companion
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default KitModal
