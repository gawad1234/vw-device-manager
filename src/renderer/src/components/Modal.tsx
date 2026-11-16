import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'

/** What a dialog's owner can tell it about unsaved edits. */
export interface ModalControl {
  /** call after a SUCCESSFUL save: closing no longer asks. With a scope, clears
   *  only that part (a row that saved itself); without, clears everything. */
  markClean: (scope?: string) => void
  /** for edits that don't fire a change event (add/remove buttons, swatches) */
  markDirty: (scope?: string) => void
}

/* Unsaved edits are tracked per source. A change event counts toward the nearest
 * [data-dirty-scope] (or the dialog as a whole), so a row that saves itself can
 * clear just its own edits. Controls inside [data-immediate] save as they change
 * and never count as unsaved. */

interface Props {
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  /** wider dialog (for spreadsheet-style editors) */
  wide?: boolean
  /** large dialog that fills most of the viewport (for the order spreadsheet) */
  tall?: boolean
  /** Explicit save API: the owner calls markClean() after a successful save. When
   *  given, clicking a primary/submit button no longer clears the unsaved flag. */
  controlRef?: React.Ref<ModalControl>
  /** false for dialogs with nothing to save (e.g. Join show): never ask on close */
  trackChanges?: boolean
}

interface Ctx extends ModalControl {
  dirty: boolean
  close: () => void
}

const ModalContext = createContext<Ctx | null>(null)

/** For anything rendered inside a Modal (body or footer). */
// eslint-disable-next-line react-refresh/only-export-components
export function useModal(): Ctx | null {
  return useContext(ModalContext)
}

/** The footer's dismiss button: "Cancel" while there are unsaved edits (closes
 *  without asking — that is what Cancel means), "Close" otherwise. */
export function ModalDismiss(): React.JSX.Element {
  const m = useModal()
  return (
    <button className="btn" type="button" onClick={() => m?.close()}>
      {m?.dirty ? 'Cancel' : 'Close'}
    </button>
  )
}

/** Open dialogs, innermost last: only that one answers Esc and Tab. */
const openModals: string[] = []

/** A centered overlay dialog. Closes on Escape, backdrop click, or the ✕, and asks
 *  first if anything was typed since the last save. */
function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  tall,
  controlRef,
  trackChanges = true
}: Props): React.JSX.Element {
  const id = useId()
  const titleId = `${id}-title`
  const box = useRef<HTMLDivElement>(null)
  const pressedBackdrop = useRef(false)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const sources = useRef(new Set<string>())

  // data-dirty mirrors the state: lib/paperwork.ts looks for `.modal[data-dirty]`.
  const sync = useCallback(() => {
    const next = trackChanges && sources.current.size > 0
    if (next === dirtyRef.current) return
    dirtyRef.current = next
    setDirty(next)
    if (next) box.current?.setAttribute('data-dirty', '')
    else box.current?.removeAttribute('data-dirty')
  }, [trackChanges])

  const control = useMemo<ModalControl>(
    () => ({
      markClean: (scope) => {
        if (scope === undefined) sources.current.clear()
        else sources.current.delete(scope)
        sync()
      },
      markDirty: (scope = '') => {
        sources.current.add(scope)
        sync()
      }
    }),
    [sync]
  )
  useImperativeHandle(controlRef, () => control, [control])

  const tryClose = useCallback(() => {
    if (!dirtyRef.current || window.confirm('Close without saving your changes?')) onClose()
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
    <ModalContext.Provider value={{ ...control, dirty, close: onClose }}>
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
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`modal${wide ? ' modal-wide' : ''}${tall ? ' modal-tall' : ''}`}
          onChange={(e) => {
            const t = e.target as HTMLElement
            if (t.closest('[data-immediate]')) return
            control.markDirty(
              t.closest('[data-dirty-scope]')?.getAttribute('data-dirty-scope') ?? ''
            )
          }}
          // Legacy fallback for dialogs that don't use controlRef: treat a click on
          // the primary/submit button as the save. (It also fires when validation
          // then fails — which is why the dialogs that can, use markClean instead.)
          onClickCapture={
            controlRef
              ? undefined
              : (e) => {
                  if ((e.target as HTMLElement).closest('.btn-primary, button[type="submit"]')) {
                    control.markClean()
                  }
                }
          }
        >
          <div className="modal-header">
            <h2 id={titleId}>{title}</h2>
            <button className="modal-close" onClick={tryClose} aria-label="Close">
              ×
            </button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </div>
      </div>
    </ModalContext.Provider>
  )
}

export default Modal
