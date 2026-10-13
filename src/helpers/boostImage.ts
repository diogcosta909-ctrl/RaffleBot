// Dependencies
import * as path from 'path'

// Image shown in the public boost feed: stars paid and entries the person has now.
// The canvas library is loaded only when an image is needed, to keep memory low.
let canvasLib: any
let fontsLoaded = false

function loadCanvas() {
  if (!canvasLib) {
    canvasLib = require('@napi-rs/canvas')
  }
  if (!fontsLoaded) {
    const dir = path.join(__dirname, '..', '..', 'assets', 'fonts')
    canvasLib.GlobalFonts.registerFromPath(path.join(dir, 'Inter-ExtraBold.otf'), 'InterX')
    canvasLib.GlobalFonts.registerFromPath(path.join(dir, 'Inter-Bold.otf'), 'InterB')
    fontsLoaded = true
  }
  return canvasLib
}

/** Keeps only characters the bundled font can draw (Latin, Cyrillic, Greek) */
function drawableName(name: string) {
  const clean = Array.from(name)
    .filter((c) => /[A-Za-z0-9@_.\-À-ɏͰ-ϿЀ-ӿ ]/.test(c))
    .join('')
    .trim()
  return clean.length > 22 ? `${clean.slice(0, 21)}…` : clean
}

function starPath(ctx: any, cx: number, cy: number, r: number) {
  const inner = r * 0.4
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    const radius = i % 2 === 0 ? r : inner
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function goldStar(ctx: any, cx: number, cy: number, r: number) {
  const g = ctx.createLinearGradient(0, cy - r, 0, cy + r)
  g.addColorStop(0, '#ffe27a')
  g.addColorStop(1, '#f5a30a')
  starPath(ctx, cx, cy, r)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = Math.max(1.5, r * 0.04)
  ctx.strokeStyle = '#fff3b8'
  ctx.stroke()
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Small ticket icon drawn with paths (no emoji font needed) */
function ticket(ctx: any, cx: number, cy: number, w: number) {
  const h = w * 0.62
  const x = cx - w / 2
  const y = cy - h / 2
  const g = ctx.createLinearGradient(x, y, x + w, y + h)
  g.addColorStop(0, '#ffe27a')
  g.addColorStop(1, '#f5a30a')
  ctx.save()
  roundRect(ctx, x, y, w, h, h * 0.18)
  ctx.fillStyle = g
  ctx.fill()
  // notches
  ctx.fillStyle = '#1c2a55'
  ctx.beginPath()
  ctx.arc(x, cy, h * 0.16, 0, Math.PI * 2)
  ctx.arc(x + w, cy, h * 0.16, 0, Math.PI * 2)
  ctx.fill()
  // dotted line
  ctx.strokeStyle = 'rgba(120,70,0,0.55)'
  ctx.lineWidth = Math.max(2, h * 0.05)
  ctx.setLineDash([h * 0.1, h * 0.1])
  ctx.beginPath()
  ctx.moveTo(x + w * 0.68, y + h * 0.14)
  ctx.lineTo(x + w * 0.68, y + h * 0.86)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
  goldStarDark(ctx, x + w * 0.34, cy, h * 0.26)
}

function goldStarDark(ctx: any, cx: number, cy: number, r: number) {
  starPath(ctx, cx, cy, r)
  ctx.fillStyle = '#6a3a00'
  ctx.fill()
}

/**
 * Renders the boost card as a PNG.
 * @param name person's name or @username (characters the font cannot draw are dropped)
 * @param stars Stars paid in this boost
 * @param entries total entries the person has now
 * @param mult active multiplier (shows a "x2 today" tag when above 1)
 */
export async function renderBoostImage(info: {
  name: string
  stars: number
  entries: number
  mult?: number
}): Promise<Buffer> {
  const { createCanvas } = loadCanvas()
  const S = 2 // render at 2x for sharpness
  const W = 372 * S
  const H = 300 * S
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.scale(S, S)

  // Background
  const bg = ctx.createRadialGradient(186, 90, 10, 186, 120, 330)
  bg.addColorStop(0, '#1d2a55')
  bg.addColorStop(1, '#070b1f')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 372, 300)

  // A few fixed sparkles at the edges
  const sparkles: [number, number, number, number][] = [
    [18, 28, 7, 0.5], [350, 40, 9, 0.7], [338, 120, 5, 0.4], [14, 130, 6, 0.45],
    [356, 248, 6, 0.4], [12, 270, 8, 0.6], [330, 18, 5, 0.5], [40, 82, 4, 0.4],
  ]
  for (const [x, y, r, o] of sparkles) {
    ctx.globalAlpha = o
    starPath(ctx, x, y, r)
    ctx.fillStyle = '#ffd54a'
    ctx.fill()
  }
  ctx.globalAlpha = 1

  ctx.textAlign = 'center'
  // Header
  ctx.font = '700 14px InterB'
  ctx.fillStyle = '#9fb0ff'
  ;(ctx as any).letterSpacing = '4px'
  ctx.fillText('NEW BOOST', 186, 40)
  ;(ctx as any).letterSpacing = '0px'

  // Name (shrinks to fit)
  const name = drawableName(info.name)
  if (name) {
    let size = 30
    ctx.font = `800 ${size}px InterX`
    while (ctx.measureText(name).width > 320 && size > 16) {
      size -= 2
      ctx.font = `800 ${size}px InterX`
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillText(name, 186, 80)
  }

  // Row of stars (one per Star paid, up to 5)
  const count = Math.max(1, Math.min(5, info.stars))
  const gap = 60
  const startX = 186 - ((count - 1) * gap) / 2
  for (let i = 0; i < count; i++) {
    goldStar(ctx, startX + i * gap, 140, 30)
  }

  // Two boxes
  const boxes: { x: number; stroke: string }[] = [
    { x: 24, stroke: 'rgba(255,213,74,0.55)' },
    { x: 194, stroke: 'rgba(142,162,255,0.65)' },
  ]
  for (const b of boxes) {
    roundRect(ctx, b.x, 182, 154, 94, 16)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fill()
    ctx.lineWidth = 1.2
    ctx.strokeStyle = b.stroke
    ctx.stroke()
  }
  // Left: stars paid
  ctx.font = '800 46px InterX'
  ctx.fillStyle = '#ffd54a'
  const starsText = `${info.stars}`
  const sw = ctx.measureText(starsText).width
  ctx.textAlign = 'left'
  const leftStart = 101 - (sw + 14 + 38) / 2
  ctx.fillText(starsText, leftStart, 230)
  goldStar(ctx, leftStart + sw + 14 + 19, 216, 19)
  // Right: entries now
  const entText = `${info.entries}`
  const ew = ctx.measureText(entText).width
  const rightStart = 271 - (ew + 14 + 44) / 2
  ctx.fillStyle = '#ffffff'
  ctx.fillText(entText, rightStart, 230)
  ticket(ctx, rightStart + ew + 14 + 22, 216, 44)

  // Labels
  ctx.textAlign = 'center'
  ctx.font = '700 13px InterB'
  ctx.fillStyle = '#c9d3ff'
  ;(ctx as any).letterSpacing = '2px'
  ctx.fillText('STARS PAID', 101, 259)
  ctx.fillText('ENTRIES NOW', 271, 259)
  ;(ctx as any).letterSpacing = '0px'

  // Multiplier tag
  if (info.mult && info.mult > 1) {
    const label = `x${+info.mult.toFixed(2)} TODAY`
    ctx.font = '800 13px InterX'
    const tw = ctx.measureText(label).width + 22
    roundRect(ctx, 372 - tw - 14, 12, tw, 26, 13)
    ctx.fillStyle = '#ffd54a'
    ctx.fill()
    ctx.fillStyle = '#3b2300'
    ctx.fillText(label, 372 - tw / 2 - 14, 30)
  }

  return canvas.toBuffer('image/png')
}
