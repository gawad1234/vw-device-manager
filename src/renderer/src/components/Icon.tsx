/** 16px stroke icons for the sidebar, keyed by page id (or a few shell names).
 *  Inline SVG in currentColor so they follow the item's text colour. */
function paths(name: string): React.JSX.Element {
  switch (name) {
    case 'devices':
      return (
        <>
          <rect x="2" y="4" width="20" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </>
      )
    case 'subnets':
      return (
        <>
          <rect x="9" y="2" width="6" height="6" rx="1" />
          <rect x="2" y="16" width="6" height="6" rx="1" />
          <rect x="16" y="16" width="6" height="6" rx="1" />
          <path d="M12 8v4M5 16v-4h14v4" />
        </>
      )
    case 'configs':
      return <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M16 16v4" />
    case 'projectors':
      return (
        <>
          <rect x="2" y="7" width="20" height="10" rx="2" />
          <circle cx="15" cy="12" r="3" />
          <path d="M6 11h3" />
        </>
      )
    case 'wallpapers':
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="M21 15l-5-5L5 21" />
        </>
      )
    case 'software':
      return <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />
    case 'cables':
      return <path d="M4 4v6a4 4 0 0 0 4 4h8a4 4 0 0 1 4 4v2M2 4h4M18 20h4" />
    case 'patching':
      return (
        <>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="18" r="2" />
          <circle cx="18" cy="6" r="2" />
          <path d="M8 6h8M6 8v4a6 6 0 0 0 6 6h4" />
        </>
      )
    case 'loomlabels':
    case 'labels':
      return (
        <>
          <path d="M20 12l-8 8-9-9V3h8z" />
          <circle cx="7.5" cy="7.5" r="1.5" />
        </>
      )
    case 'fixtures':
      return (
        <>
          <path d="M9 2h6l2 8H7z" />
          <path d="M12 10v4M8 22l4-8 4 8" />
        </>
      )
    case 'universes':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </>
      )
    case 'fixtureTypes':
      return (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      )
    case 'orders':
      return (
        <>
          <path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" />
          <path d="M9 7h6M9 11h6M9 15h4" />
        </>
      )
    case 'paperwork':
      return (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M8 13h8M8 17h8" />
        </>
      )
    case 'crew':
      return (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6" />
        </>
      )
    case 'trucking':
      return (
        <>
          <path d="M2 5h12v11H2zM14 9h4l4 4v3h-8" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="18" r="2" />
        </>
      )
    case 'cases':
      return (
        <>
          <rect x="2" y="7" width="20" height="13" rx="2" />
          <path d="M8 7V4h8v3M2 13h20" />
        </>
      )
    case 'timecode':
      return (
        <>
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2 2M10 2h4" />
        </>
      )
    case 'showstatus':
      return <path d="M2 12h4l3-8 6 16 3-8h4" />
    case 'settings':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
        </>
      )
    case 'server':
      return (
        <>
          <rect x="3" y="3" width="18" height="7" rx="1" />
          <rect x="3" y="14" width="18" height="7" rx="1" />
          <path d="M7 6.5h.01M7 17.5h.01" />
        </>
      )
    case 'update':
      return <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
    case 'project':
      return <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    case 'collapse':
      return <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
    case 'expand':
      return <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
    default:
      return <circle cx="12" cy="12" r="4" />
  }
}

function Icon({ name, size = 16 }: { name: string; size?: number }): React.JSX.Element {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths(name)}
    </svg>
  )
}

export default Icon
