import { cloneElement, useId } from 'react'
import '../assets/forms.css'

type ControlProps = {
  id?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-describedby'?: string
}

interface Props {
  label: React.ReactNode
  /** quiet help under the control */
  hint?: React.ReactNode
  /** what's wrong and how to fix it — turns the control red */
  error?: React.ReactNode
  /** the error is rendered elsewhere (e.g. full row width): mark the control
   *  invalid and point aria-describedby at that element's id */
  externalErrorId?: string
  /** extra classes on the .field wrapper (e.g. span-2) */
  className?: string
  /** the one input / select / textarea this label belongs to */
  children: React.ReactElement<ControlProps>
}

/** Add the fix to an IP-conflict message from the main process, which names
 *  only the conflict ("IP 10.20.1.51 is already on "PJ-L" (LAN).").
 *  Lives here so every form shows the same wording. */
// eslint-disable-next-line react-refresh/only-export-components
export function withFix(error: string): string {
  if (/Pick another|Change one/.test(error)) return error
  if (/is already (on|used by) /.test(error)) return `${error} Pick another address.`
  if (/can't both be/.test(error)) return `${error} Change one of them.`
  return error
}

/** A labelled form control with an optional hint and an inline error. Wires up
 *  id / htmlFor, aria-invalid and aria-describedby on the control. */
function Field({
  label,
  hint,
  error,
  externalErrorId,
  className,
  children
}: Props): React.JSX.Element {
  const auto = useId()
  const id = children.props.id ?? auto
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const inline = error != null && error !== false && error !== ''
  const invalid = inline || !!externalErrorId
  const describedBy =
    [
      children.props['aria-describedby'],
      hint ? hintId : null,
      inline ? errorId : null,
      externalErrorId ?? null
    ]
      .filter(Boolean)
      .join(' ') || undefined

  const control = cloneElement(children, {
    id,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy
  })

  return (
    <div
      className={`field${className ? ` ${className}` : ''}`}
      data-invalid={invalid ? '' : undefined}
    >
      <label htmlFor={id}>{label}</label>
      {control}
      {hint && (
        <div className="field-hint" id={hintId}>
          {hint}
        </div>
      )}
      {inline && (
        <div className="field-error" id={errorId} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

export default Field
