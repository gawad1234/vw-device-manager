import { useCallback, useEffect, useId, useRef } from 'react'

interface Props {
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  /** wider dialog (for spreadsheet-style editors) */
  wide?: boolean
  /** large dialog that fills most of the viewport (for the order spreadsheet) */
  tall?: boolean
}

/** Open dialogs, innermost last: only that one answers Esc and Tab. */
const openModals: string[] = []

/** A centered overlay dialog. Closes on Escape, backdrop click, or the ✕, and asks
 *  first if anything was typed since the last save. */
function Modal({ title, onClose, children, footer, wide, tall }: Props): React.JSX.Element {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const pressedBackdrop = useRef(false)

  const tryClose = useCallback(() => {
    if (!box.current?.hasAttribute('data-dirty') || window.confirm('Close without saving your changes?')) {
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    openModals.push(id)
    return () => {
      openModals.splice(openModals.indexOf(id), 1)
    }
  }, [id])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (openModals[openModals.length - 1] !== id) return
      if (e.key === 'Escape') tryClose()
      if (e.key !== 'Tab' || !box.current) return
      // Keep Tab inside the dialog, or it reaches the page behind the backdrop.
      const stops = box.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]'
      )
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (!first) return
      const inside = box.current.contains(document.activeElement)
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, tryClose])

  return (
    <div
      className="modal-backdrop"
      // Only a press that began on the backdrop closes: a drag or text selection
      // that starts in the dialog and ends out here must not.
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedBackdrop.current) tryClose()
      }}
    >
      <div
        ref={box}
        className={`modal${wide ? ' modal-wide' : ''}${tall ? ' modal-tall' : ''}`}
        onChange={() => box.current?.setAttribute('data-dirty', '')}
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest('.btn-primary, button[type="submit"]')) {
            box.current?.removeAttribute('data-dirty')
          }
        }}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={tryClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

export default Modal
