import type { ReactNode } from 'react'
import OverflowMenu, { type OverflowItem } from './OverflowMenu'
import '../assets/pages.css'

export interface PrimaryAction {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}

interface Props {
  title: string
  /** shown as a small pill beside the title */
  count?: number
  /** one line under the title, in text-2 */
  description?: ReactNode
  /** at most one secondary control (e.g. an Export menu) */
  secondary?: ReactNode
  /** less-used actions behind the ⋯ button */
  overflow?: OverflowItem[]
  /** the ONE primary button for the page */
  primary?: PrimaryAction
  /** search / selects / view switch, on their own row below the header */
  filters?: ReactNode
}

/** Page title row: title + count, ⋯, one secondary, one primary; optional filter bar below. */
function PageHeader({
  title,
  count,
  description,
  secondary,
  overflow,
  primary,
  filters
}: Props): React.JSX.Element {
  return (
    <header className="page-head">
      <div className="page-head-row">
        <div className="page-head-text">
          <h2 className="page-head-title">
            {title}
            {count != null && (
              <span className="page-count" aria-label={`${count} total`}>
                {count}
              </span>
            )}
          </h2>
          {description && <p className="page-head-desc">{description}</p>}
        </div>
        <div className="page-head-actions">
          {overflow && <OverflowMenu items={overflow} />}
          {secondary}
          {primary && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={primary.onClick}
              disabled={primary.disabled}
              title={primary.title}
            >
              {primary.label}
            </button>
          )}
        </div>
      </div>
      {filters && <div className="filter-bar">{filters}</div>}
    </header>
  )
}

export default PageHeader
