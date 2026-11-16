import { useEffect, useId, useRef, useState } from 'react'

export interface OverflowItem {
  label: string
  onClick: () => void
  /** red text: destructive. The page's handler must confirm before acting. */
  danger?: boolean
  disabled?: boolean
  title?: string
}

interface Props {
  items: OverflowItem[]
  label?: string
}

/** The ⋯ button in a page header: secondary actions in a small dropdown. */
function OverflowMenu({ items, label = 'More actions' }: Props): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const itemEls = (): HTMLButtonElement[] =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('.overflow-item:not(:disabled)') ?? []
    )

  useEffect(() => {
    if (!open) return
    itemEls()[0]?.focus()
    function onDoc(e: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function close(refocus: boolean): void {
    setOpen(false)
    if (refocus) btnRef.current?.focus()
  }

  function onMenuKey(e: React.KeyboardEvent): void {
    const els = itemEls()
    const i = els.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      els[(i + 1) % els.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      els[(i - 1 + els.length) % els.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      els[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      els[els.length - 1]?.focus()
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  if (items.length === 0) return null

  return (
    <div className="overflow-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="btn overflow-btn"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          } else if (e.key === 'Escape' && open) {
            e.preventDefault()
            close(true)
          }
        }}
      >
        ⋯
      </button>
      {open && (
        <div className="overflow-menu" role="menu" id={menuId} ref={menuRef} onKeyDown={onMenuKey}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`overflow-item${it.danger ? ' danger' : ''}`}
              disabled={it.disabled}
              title={it.title}
              onClick={() => {
                close(true)
                it.onClick()
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default OverflowMenu
