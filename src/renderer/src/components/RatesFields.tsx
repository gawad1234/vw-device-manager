import type { CrewRates } from '../../../shared/types'

interface Props {
  value: CrewRates
  onChange: (rates: CrewRates) => void
  /** fires when a number field loses focus (for save-on-blur editors) */
  onBlur?: () => void
}

/** Rate type + day rate, or hourly rate with an overtime threshold and multiplier. */
function RatesFields({ value, onChange, onBlur }: Props): React.JSX.Element {
  const num = (
    key: keyof Omit<CrewRates, 'rateType'>,
    label: string,
    step = '1'
  ): React.JSX.Element => (
    <label>
      {label}
      <input
        type="number"
        min={0}
        step={step}
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: Math.max(0, Number(e.target.value) || 0) })}
        onBlur={onBlur}
      />
    </label>
  )
  return (
    <>
      <label>
        Paid by
        <select
          value={value.rateType}
          onChange={(e) =>
            onChange({ ...value, rateType: e.target.value as CrewRates['rateType'] })
          }
        >
          <option value="day">Day rate</option>
          <option value="hourly">Hourly + overtime</option>
        </select>
      </label>
      {value.rateType === 'day' ? (
        num('dayRate', 'Day rate ($)')
      ) : (
        <>
          {num('hourlyRate', 'Hourly rate ($)', '0.01')}
          {num('otAfterHours', 'Overtime after (hours/day)', '0.5')}
          {num('otMultiplier', 'Overtime multiplier', '0.25')}
        </>
      )}
    </>
  )
}

export default RatesFields
