import { useCallback, useEffect, useRef, useState } from 'react'
import type { Bundle, CableType, Device, ProjectInfo, Subnet } from '../../shared/types'
import { HOST_UNREACHABLE } from '../../shared/remote-scope'
import SubnetsPage from './pages/SubnetsPage'
import DevicesPage from './pages/DevicesPage'
import CablesPage from './pages/CablesPage'
import ConfigsPage from './pages/ConfigsPage'
import OrdersPage from './pages/OrdersPage'
import LabelsPage from './pages/LabelsPage'
import CasesPage from './pages/CasesPage'
import PatchingPage from './pages/PatchingPage'
import ProjectorsPage from './pages/ProjectorsPage'
import WallpapersPage from './pages/WallpapersPage'
import SoftwarePage from './pages/SoftwarePage'
import CrewPage from './pages/CrewPage'
import LoomLabelsPage from './pages/LoomLabelsPage'
import TruckingPage from './pages/TruckingPage'
import FixturesPage from './pages/FixturesPage'
import UniversesPage from './pages/UniversesPage'
import FixtureTypesPage from './pages/FixtureTypesPage'
import PaperworkPage from './pages/PaperworkPage'
import SettingsPage from './pages/SettingsPage'
import TimecodePage from './pages/TimecodePage'
import ShowStatusPage from './pages/ShowStatusPage'
import Sidebar from './components/Sidebar'
import './assets/shell.css'

type Tab =
  | 'devices'
  | 'projectors'
  | 'wallpapers'
  | 'software'
  | 'crew'
  | 'trucking'
  | 'subnets'
  | 'cables'
  | 'loomlabels'
  | 'configs'
  | 'orders'
  | 'labels'
  | 'cases'
  | 'patching'
  | 'fixtures'
  | 'universes'
  | 'fixtureTypes'
  | 'paperwork'
  | 'timecode'
  | 'showstatus'
  | 'settings'

type NavGroup = { key: string; label: string; items: [Tab, string][] }

// Sidebar, grouped by job. Groups are always open, under small labels.
const NAV: NavGroup[] = [
  {
    key: 'network',
    label: 'Network',
    items: [
      ['devices', 'Devices'],
      ['subnets', 'Subnets'],
      ['configs', 'Configs'],
      ['projectors', 'Projectors'],
      ['wallpapers', 'Wallpapers'],
      ['software', 'Software']
    ]
  },
  {
    key: 'cables',
    label: 'Cables',
    items: [
      ['cables', 'Cables'],
      ['patching', 'Patching'],
      ['loomlabels', 'Loom labels']
    ]
  },
  {
    key: 'lighting',
    label: 'Lighting',
    items: [
      ['fixtures', 'Fixtures'],
      ['universes', 'Universes'],
      ['fixtureTypes', 'Fixture types']
    ]
  },
  {
    key: 'paperwork',
    label: 'Paperwork',
    items: [
      ['orders', 'Orders'],
      ['paperwork', 'Paperwork']
    ]
  },
  {
    key: 'schedule',
    label: 'Schedule',
    items: [
      ['crew', 'Crew'],
      ['trucking', 'Trucking']
    ]
  },
  {
    key: 'packing',
    label: 'Packing',
    items: [
      ['labels', 'Case labels'],
      ['cases', 'Cases']
    ]
  }
]

// Prep = building the show (the whole app); Program = at the desks; Show = running live.
type Mode = 'prep' | 'program' | 'show'
const MODES: [Mode, string][] = [
  ['prep', 'Prep'],
  ['program', 'Program'],
  ['show', 'Show']
]
const MODE_NAV: Record<Mode, NavGroup[]> = {
  prep: NAV,
  program: [
    {
      key: 'lighting',
      label: 'Lighting',
      items: [
        ['timecode', 'Timecode'],
        ['fixtures', 'Fixtures'],
        ['universes', 'Universes']
      ]
    }
  ],
  show: [
    { key: 'show', label: 'Show', items: [['showstatus', 'Status']] },
    {
      key: 'network',
      label: 'Network',
      items: [
        ['devices', 'Devices'],
        ['configs', 'Configs']
      ]
    },
    { key: 'cables', label: 'Cables', items: [['patching', 'Patching']] }
  ]
}
const MODE_KEY = 'app.mode'

function loadMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY)
    if (m === 'prep' || m === 'program' || m === 'show') return m
  } catch {
    /* falls back to Prep */
  }
  return 'prep'
}

const inMode = (mode: Mode, tab: Tab): boolean =>
  tab === 'settings' || MODE_NAV[mode].some((g) => g.items.some(([t]) => t === tab))

const COLLAPSED_KEY = 'sidebar.collapsed'

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

// The mode a page lives in when the current one doesn't hold it (Prep holds every page).
function modeFor(tab: Tab): Mode {
  return MODES.map(([m]) => m).find((m) => inMode(m, tab)) ?? 'prep'
}

function tabLabel(tab: Tab): string {
  for (const m of Object.values(MODE_NAV))
    for (const g of m) for (const [t, label] of g.items) if (t === tab) return label
  return tab
}

function App(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>(loadMode)
  const [tab, setTab] = useState<Tab>(() => MODE_NAV[mode][0].items[0][0])
  const pickMode = useCallback((m: Mode, keepTab?: Tab): void => {
    setMode(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* remembered per session only */
    }
    setTab((t) => {
      const want = keepTab ?? t
      return inMode(m, want) ? want : MODE_NAV[m][0].items[0][0]
    })
  }, [])
  // Set when something opened a page the current mode doesn't hold, so the mode switch is explained.
  const [modeNote, setModeNote] = useState<string | null>(null)
  // Open a page from elsewhere in the app, switching mode (visibly) if this one doesn't hold it.
  const goTo = useCallback(
    (t: Tab): void => {
      if (inMode(mode, t)) {
        setTab(t)
        return
      }
      const m = modeFor(t)
      pickMode(m, t)
      setModeNote(`Switched to ${MODES.find(([k]) => k === m)?.[1]} to show ${tabLabel(t)}.`)
    },
    [mode, pickMode]
  )
  // an export menu's "Edit layout…" opens Paperwork on that export's template
  const [paperworkFocus, setPaperworkFocus] = useState<string | null>(null)
  useEffect(() => {
    const open = (e: Event): void => {
      setPaperworkFocus((e as CustomEvent<string>).detail)
      goTo('paperwork') // Paperwork only lives in Prep
    }
    window.addEventListener('open-paperwork', open)
    return () => window.removeEventListener('open-paperwork', open)
  }, [goTo])
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const toggleCollapsed = (): void =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1')
      } catch {
        /* remembered per session only */
      }
      return !c
    })
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [subnets, setSubnets] = useState<Subnet[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [cableTypes, setCableTypes] = useState<CableType[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  // A save or action that failed where the page doesn't show its own error
  // (e.g. a change refused while viewing a shared show).
  const [notice, setNotice] = useState<string | null>(null)
  const [tcPlaying, setTcPlaying] = useState(false)

  // Only the newest load may land: a slow read of a host you just left mustn't
  // put its rows on screen for the local project.
  const loadSeq = useRef(0)
  const refresh = useCallback(async () => {
    const seq = ++loadSeq.current
    const [subnetList, deviceList, bundleList, cableTypeList, categoryList] = await Promise.all([
      window.api.subnets.list(),
      window.api.devices.list(),
      window.api.bundles.list(),
      window.api.cableTypes.list(),
      window.api.deviceCategories.list()
    ])
    if (seq !== loadSeq.current) return
    setSubnets(subnetList)
    setDevices(deviceList)
    setBundles(bundleList)
    setCableTypes(cableTypeList)
    setCategories(categoryList)
  }, [])

  useEffect(() => {
    window.api.projects.current().then(setProject)
    refresh().finally(() => setLoading(false))
  }, [refresh])

  // Clickable table rows open with Enter, like the click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const row = e.target as HTMLElement
      if (e.key === 'Enter' && row.matches?.('tr.clickable')) row.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent): void => {
      const msg = e.reason instanceof Error ? e.reason.message : String(e.reason)
      if (msg !== HOST_UNREACHABLE) setNotice(msg) // the shared-show banner covers that one
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [])

  // Auto-refresh when a Vectorworks script writes to the open project file, or
  // the host of a shared show changes something (or goes offline / comes back).
  useEffect(
    () =>
      window.api.onDataChanged(() => {
        void refresh()
        window.api.projects.current().then((info) =>
          setProject((prev) => {
            // Leave goes through handleSwitch, so a shared show vanishing here means the host ended it.
            if (prev?.remote && !info?.remote)
              setNotice(
                `${prev.remote.host} ended the shared session (it restarted, changed its PIN or opened another show). Join again to keep viewing.`
              )
            return info
          })
        )
      }),
    [refresh]
  )

  // Switching projects swaps the whole database — reload everything.
  const handleSwitch = useCallback(
    (info: ProjectInfo) => {
      setProject(info)
      setLoading(true)
      refresh().finally(() => setLoading(false))
    },
    [refresh]
  )

  return (
    <div className="app">
      {notice && (
        <div className="banner banner-error remote-banner app-notice">
          {notice}
          <button className="btn btn-small" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {project?.remote && (
        <div
          className={`banner ${project.remote.offline ? 'banner-warning' : 'banner-info'} remote-banner`}
        >
          {project.remote.offline
            ? `Can’t reach ${project.remote.host} — retrying. What you see may be out of date.`
            : `Viewing a shared show on ${project.remote.host} (view-only).`}
          <button
            className="btn btn-small"
            onClick={() => window.api.projects.leave().then((info) => info && handleSwitch(info))}
          >
            Leave
          </button>
        </div>
      )}

      <div className="app-body">
        <Sidebar
          appName="Device Manager"
          modes={MODES}
          mode={mode}
          onPickMode={(m) => {
            setModeNote(null)
            pickMode(m as Mode)
          }}
          modeBadges={{
            program: tcPlaying ? { text: '▶', label: 'Timecode playing' } : undefined
          }}
          groups={MODE_NAV[mode]}
          tab={tab}
          onTab={(t) => {
            setModeNote(null)
            setTab(t as Tab)
          }}
          counts={loading ? {} : { devices: devices.length, subnets: subnets.length }}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          project={project}
          onSwitched={handleSwitch}
        />

        <main className="app-main">
          {modeNote && (
            <div className="mode-note" role="status">
              <span>{modeNote}</span>
              <button className="btn btn-small" onClick={() => setModeNote(null)}>
                Dismiss
              </button>
            </div>
          )}
          {loading ? (
            <p className="muted">Loading…</p>
          ) : tab === 'devices' ? (
            <DevicesPage
              devices={devices}
              subnets={subnets}
              categories={categories}
              onChanged={refresh}
            />
          ) : tab === 'projectors' ? (
            <ProjectorsPage devices={devices} onChanged={refresh} />
          ) : tab === 'wallpapers' ? (
            <WallpapersPage devices={devices} onChanged={refresh} />
          ) : tab === 'software' ? (
            <SoftwarePage devices={devices} onChanged={refresh} />
          ) : tab === 'crew' ? (
            <CrewPage key={project?.path} />
          ) : tab === 'trucking' ? (
            <TruckingPage key={project?.path} />
          ) : tab === 'subnets' ? (
            <SubnetsPage subnets={subnets} onChanged={refresh} />
          ) : tab === 'cables' ? (
            <CablesPage
              bundles={bundles}
              devices={devices}
              cableTypes={cableTypes}
              onChanged={refresh}
            />
          ) : tab === 'loomlabels' ? (
            <LoomLabelsPage bundles={bundles} onChanged={refresh} />
          ) : tab === 'configs' ? (
            <ConfigsPage subnets={subnets} />
          ) : tab === 'orders' ? (
            <OrdersPage />
          ) : tab === 'labels' ? (
            <LabelsPage />
          ) : tab === 'cases' ? (
            <CasesPage />
          ) : tab === 'patching' ? (
            <PatchingPage />
          ) : tab === 'fixtures' ? (
            <FixturesPage key={project?.path} />
          ) : tab === 'universes' ? (
            <UniversesPage key={project?.path} devices={devices} />
          ) : tab === 'fixtureTypes' ? (
            <FixtureTypesPage key={project?.path} />
          ) : tab === 'timecode' ? null : tab === 'showstatus' ? (
            <ShowStatusPage
              key={project?.path}
              devices={devices}
              subnets={subnets}
              categories={categories}
              onChanged={refresh}
            />
          ) : tab === 'paperwork' ? (
            <PaperworkPage key={`${project?.path}|${paperworkFocus}`} focusId={paperworkFocus} />
          ) : (
            <SettingsPage
              key={project?.path}
              cableTypes={cableTypes}
              categories={categories}
              onChanged={refresh}
            />
          )}
          {/* stays mounted (hidden) while playing so leaving the tab doesn't stop the show */}
          {!loading && (tab === 'timecode' || tcPlaying) && (
            <div style={{ display: tab === 'timecode' ? 'contents' : 'none' }}>
              <TimecodePage key={project?.path} onPlayingChange={setTcPlaying} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
