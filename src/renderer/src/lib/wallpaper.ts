import type { WallpaperDisplay } from '../../../shared/types'

export interface WallpaperInput {
  display: WallpaperDisplay
  color: string
  showLogo: string | null
  companyLogo: string | null
  computerName: string
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function loadOrNull(src: string | null): Promise<HTMLImageElement | null> {
  if (!src) return null
  try {
    return await loadImage(src)
  } catch {
    return null
  }
}

/** White or near-black text, whichever reads better on the given hex background. */
function contrastInk(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '')
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#111111' : '#ffffff'
}

interface DrawOpts {
  color: string
  showImg: HTMLImageElement | null
  companyImg: HTMLImageElement | null
  computerName: string
}

/** Draw one display's wallpaper into the region (ox,oy, W,H) of a canvas. */
function drawDisplay(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  display: WallpaperDisplay,
  o: DrawOpts
): void {
  const W = Math.max(1, Math.round(display.width))
  const H = Math.max(1, Math.round(display.height))
  ctx.fillStyle = display.black ? '#000000' : o.color || '#1b1b1f'
  ctx.fillRect(ox, oy, W, H)
  if (display.black) return

  const min = Math.min(W, H)
  const cx = ox + W / 2

  // Show logo, centered (sat slightly above center to leave room for the name).
  if (o.showImg) {
    const target = min * 0.4
    const scale = Math.min(target / o.showImg.width, target / o.showImg.height)
    const w = o.showImg.width * scale
    const h = o.showImg.height * scale
    ctx.drawImage(o.showImg, cx - w / 2, oy + H / 2 - h / 2 - min * 0.06, w, h)
  }

  // Computer name, just under the show logo.
  if (o.computerName.trim()) {
    const fs = Math.round(min * 0.05)
    ctx.fillStyle = contrastInk(o.color)
    ctx.font = `600 ${fs}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(o.computerName.trim(), cx, oy + H / 2 + min * 0.18)
  }

  // Company logo, small, top-right of this display.
  if (o.companyImg) {
    const target = min * 0.12
    const scale = Math.min(target / o.companyImg.width, target / o.companyImg.height)
    const w = o.companyImg.width * scale
    const h = o.companyImg.height * scale
    const margin = min * 0.03
    ctx.drawImage(o.companyImg, ox + W - w - margin, oy + margin, w, h)
  }
}

/** One display's wallpaper → a PNG data URL at its exact pixel resolution. */
export async function renderWallpaper(input: WallpaperInput): Promise<string> {
  const W = Math.max(1, Math.round(input.display.width))
  const H = Math.max(1, Math.round(input.display.height))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas context')
  const [showImg, companyImg] = await Promise.all([
    loadOrNull(input.showLogo),
    loadOrNull(input.companyLogo)
  ])
  drawDisplay(ctx, 0, 0, input.display, {
    color: input.color,
    showImg,
    companyImg,
    computerName: input.computerName
  })
  return canvas.toDataURL('image/png')
}

/** All displays stitched side-by-side into one image (Windows spanned wallpaper):
 *  total width = sum of widths, height = tallest display, each monitor's region
 *  rendered as its own wallpaper. */
export async function renderCombinedWallpaper(
  displays: WallpaperDisplay[],
  color: string,
  showLogo: string | null,
  companyLogo: string | null,
  computerName: string
): Promise<string> {
  const dims = displays.map((d) => ({
    d,
    W: Math.max(1, Math.round(d.width)),
    H: Math.max(1, Math.round(d.height))
  }))
  const totalW = dims.reduce((s, x) => s + x.W, 0) || 1
  const maxH = Math.max(1, ...dims.map((x) => x.H))
  const canvas = document.createElement('canvas')
  canvas.width = totalW
  canvas.height = maxH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas context')
  // Fill the whole span first so any area below a shorter monitor isn't transparent.
  ctx.fillStyle = color || '#1b1b1f'
  ctx.fillRect(0, 0, totalW, maxH)
  const [showImg, companyImg] = await Promise.all([loadOrNull(showLogo), loadOrNull(companyLogo)])
  let x = 0
  for (const { d, W } of dims) {
    drawDisplay(ctx, x, 0, d, { color, showImg, companyImg, computerName })
    x += W
  }
  return canvas.toDataURL('image/png')
}
