/** Open Paperwork on a template (App switches to the page) — the export menus' "Edit layout…". */
export const openPaperwork = (templateId: string): void => {
  window.dispatchEvent(new CustomEvent('open-paperwork', { detail: templateId }))
}
