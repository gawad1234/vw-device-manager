import type { Device } from '../../../shared/types'
import { PROJECTOR_MODELS } from '../../../shared/projector-settings'
import DeviceSetupPage from '../components/DeviceSetupPage'
import ProjectorSection from '../components/ProjectorSection'
import ExportMenu, { type ExportSection } from '../components/ExportMenu'

const EXPORT_SECTIONS: ExportSection[] = [
  {
    label: 'Projector setup sheet (one page per projector)',
    items: [
      { label: 'PDF', doc: 'projectorsheet', format: 'pdf' },
      { label: 'Excel', doc: 'projectorsheet', format: 'xlsx' },
      { label: 'CSV', doc: 'projectorsheet', format: 'csv' }
    ]
  }
]

interface Props {
  devices: Device[]
  onChanged: () => void
}

/** Devices › Projectors: Panasonic PT-RZ / PT-RQ setup per projector. */
function ProjectorsPage({ devices, onChanged }: Props): React.JSX.Element {
  return (
    <DeviceSetupPage
      title="Projectors"
      intro="Panasonic PT-RZ / PT-RQ projectors: tick the settings to change, save each projector's command list, and export the setup sheet."
      devices={devices}
      isSetUp={(d) => !!d.projector}
      summary={(d) => {
        const n = Object.keys(d.projector?.values ?? {}).length
        return `${d.projector?.model ?? ''} · ${n} setting${n === 1 ? '' : 's'}`
      }}
      addLabel="+ Add projector…"
      onAdd={async (d) => {
        await window.api.devices.setProjector(d.id, { model: PROJECTOR_MODELS[0], values: {} })
        onChanged()
      }}
      editor={(d) => <ProjectorSection device={d} onChanged={onChanged} />}
      headerActions={<ExportMenu scope="all" sections={EXPORT_SECTIONS} />}
    />
  )
}

export default ProjectorsPage
