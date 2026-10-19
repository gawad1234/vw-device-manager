import { useId, useState } from 'react'

interface Props {
  value: string | null
  /** known categories (shared library) to suggest */
  categories: string[]
  onChange: (value: string | null) => void
  placeholder?: string
}

/** A type-ahead category field: free-type, the dropdown filters to what you type,
 *  and a value that isn't a known category is saved to the shared library on blur
 *  (so it becomes a group you can reuse everywhere). */
function CategoryInput({ value, categories, onChange, placeholder }: Props): React.JSX.Element {
  const id = useId()
  // Categories created here this session, so this field's dropdown shows them live.
  const [created, setCreated] = useState<string[]>([])
  const options = [...new Set([...categories, ...created])]

  async function commit(raw: string): Promise<void> {
    const v = raw.trim()
    onChange(v || null)
    if (v && !options.some((c) => c.toLowerCase() === v.toLowerCase())) {
      await window.api.deviceCategories.add(v)
      setCreated((prev) => [...prev, v])
    }
  }

  return (
    <>
      <input
        list={id}
        value={value ?? ''}
        placeholder={placeholder ?? '— category —'}
        onChange={(e) => onChange(e.target.value || null)}
        onBlur={(e) => commit(e.target.value)}
      />
      <datalist id={id}>
        {options.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  )
}

export default CategoryInput
