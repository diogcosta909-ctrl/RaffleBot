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
function ticket(ctx: any, t: Tier, cx: number, cy: number, w: number) {
  const h = w * 0.62
  const x = cx - w / 2
  const y = cy - h / 2
  const g = ctx.createLinearGradient(x, y, x + w, y + h)
  g.addColorStop(0, t.starTop)
  g.addColorStop(1, t.starBottom)
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

type Tier = {
  title: string
  bgInner: string
  bgOuter: string
  header: string
  starTop: string
  starBottom: string
  starStroke: string
  accent: string
  accent2: string
  boxText: string
  frame: number
  rays: boolean
  sparkles: number
  crown: boolean
}

// One look per pack: the bigger the pack, the more epic the card
const TIERS: Record<number, Tier> = {
  1: {
    title: 'BOOST',
    bgInner: '#2b2140', bgOuter: '#0d0a18',
    header: '#e7b48a',
    starTop: '#f3c299', starBottom: '#c9783a', starStroke: '#ffe3c8',
    accent: '#e0975a', accent2: '#b86a2d', boxText: '#f3d9c3',
    frame: 0, rays: false, sparkles: 4, crown: false,
  },
  2: {
    title: 'SUPER BOOST',
    bgInner: '#12435a', bgOuter: '#05121c',
    header: '#9fe6ff',
    starTop: '#f4fdff', starBottom: '#8fc4d8', starStroke: '#ffffff',
    accent: '#7fe0ff', accent2: '#3aa8d0', boxText: '#cdf3ff',
    frame: 2, rays: false, sparkles: 8, crown: false,
  },
  3: {
    title: 'MEGA BOOST',
    bgInner: '#4a2a9a', bgOuter: '#0c0630',
    header: '#ffe08a',
    starTop: '#ffe27a', starBottom: '#f5a30a', starStroke: '#fff3b8',
    accent: '#ffd54a', accent2: '#ff9d1c', boxText: '#fff1c4',
    frame: 3, rays: true, sparkles: 12, crown: false,
  },
  4: {
    title: 'LEGENDARY BOOST',
    bgInner: '#7a1fa8', bgOuter: '#14031f',
    header: '#ffe9a8',
    starTop: '#fff6c9', starBottom: '#ffb300', starStroke: '#ffffff',
    accent: '#ff5fd2', accent2: '#ffd54a', boxText: '#ffe6fa',
    frame: 5, rays: true, sparkles: 22, crown: true,
  },
}

function tierFor(boosts: number) {
  return boosts >= 10 ? 4 : boosts >= 5 ? 3 : boosts >= 3 ? 2 : 1
}

function themedStar(ctx: any, t: Tier, cx: number, cy: number, r: number) {
  const g = ctx.createLinearGradient(0, cy - r, 0, cy + r)
  g.addColorStop(0, t.starTop)
  g.addColorStop(1, t.starBottom)
  starPath(ctx, cx, cy, r)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = Math.max(1.5, r * 0.05)
  ctx.strokeStyle = t.starStroke
  ctx.stroke()
}

function crownIcon(ctx: any, t: Tier, cx: number, cy: number, w: number) {
  const h = w * 0.7
  const x = cx - w / 2
  const y = cy - h / 2
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, '#fff6c9')
  g.addColorStop(1, '#ffb300')
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  ctx.lineTo(x, y + h * 0.25)
  ctx.lineTo(x + w * 0.25, y + h * 0.55)
  ctx.lineTo(cx, y)
  ctx.lineTo(x + w * 0.75, y + h * 0.55)
  ctx.lineTo(x + w, y + h * 0.25)
  ctx.lineTo(x + w, y + h)
  ctx.closePath()
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.fillStyle = t.accent
  for (const px of [x + w * 0.2, cx, x + w * 0.8]) {
    ctx.beginPath()
    ctx.arc(px, y + h * 0.82, w * 0.05, 0, Math.PI * 2)
    ctx.fill()
  }
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
  boosts?: number
}): Promise<Buffer> {
  const { createCanvas } = loadCanvas()
  const S = 2 // render at 2x for sharpness
  const W = 372 * S
  const H = 300 * S
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.scale(S, S)

  const t = TIERS[tierFor(info.boosts || info.stars)]

  // Background
  const bg = ctx.createRadialGradient(186, 100, 10, 186, 130, 340)
  bg.addColorStop(0, t.bgInner)
  bg.addColorStop(1, t.bgOuter)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 372, 300)

  // Light rays behind the stars on the top tiers
  if (t.rays) {
    ctx.save()
    ctx.translate(186, 140)
    const rayCount = 18
    for (let i = 0; i < rayCount; i++) {
      ctx.rotate((Math.PI * 2) / rayCount)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(-16, -320)
      ctx.lineTo(16, -320)
      ctx.closePath()
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)'
      ctx.fill()
    }
    ctx.restore()
  }

  // Sparkles (more of them on higher tiers)
  const sparkles: [number, number, number, number][] = [
    [18, 28, 7, 0.55], [350, 40, 9, 0.75], [338, 120, 5, 0.45], [14, 130, 6, 0.5],
    [356, 248, 6, 0.45], [12, 270, 8, 0.65], [330, 18, 5, 0.55], [40, 82, 4, 0.45],
    [300, 76, 5, 0.5], [60, 16, 5, 0.5], [352, 190, 4, 0.5], [20, 200, 5, 0.45],
    [100, 292, 4, 0.4], [270, 292, 5, 0.45], [8, 80, 4, 0.4], [364, 90, 4, 0.45],
    [150, 12, 3, 0.4], [225, 10, 3, 0.4], [28, 168, 3, 0.4], [346, 160, 3, 0.4],
    [74, 120, 3, 0.35], [300, 150, 3, 0.35],
  ]
  for (const [x, y, r, o] of sparkles.slice(0, t.sparkles)) {
    ctx.globalAlpha = o
    starPath(ctx, x, y, r)
    ctx.fillStyle = t.accent
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // Frame: thicker and glowing on higher tiers
  if (t.frame > 0) {
    const fg = ctx.createLinearGradient(0, 0, 372, 300)
    fg.addColorStop(0, t.accent)
    fg.addColorStop(0.5, t.accent2)
    fg.addColorStop(1, t.accent)
    ctx.save()
    if (t.frame >= 5) {
      ctx.shadowColor = t.accent
      ctx.shadowBlur = 14
    }
    roundRect(ctx, t.frame / 2 + 1, t.frame / 2 + 1, 372 - t.frame - 2, 300 - t.frame - 2, 14)
    ctx.lineWidth = t.frame
    ctx.strokeStyle = fg
    ctx.stroke()
    ctx.restore()
  }

  ctx.textAlign = 'center'
  // Crown on the top tier
  const headerY = t.crown ? 56 : 40
  const nameY = t.crown ? 90 : 80
  if (t.crown) crownIcon(ctx, t, 186, 24, 40)

  // Header
  ctx.font = '700 14px InterB'
  ctx.fillStyle = t.header
  ;(ctx as any).letterSpacing = '4px'
  ctx.fillText(t.title, 186, headerY)
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
    ctx.fillText(name, 186, nameY)
  }

  // Row of stars (one per Star paid, up to 5), bigger on the top tiers
  const count = Math.max(1, Math.min(5, info.stars))
  const starR = t.crown ? 31 : 30
  const gap = 60
  const startX = 186 - ((count - 1) * gap) / 2
  const starY = t.crown ? 146 : 140
  for (let i = 0; i < count; i++) {
    themedStar(ctx, t, startX + i * gap, starY, starR)
  }

  // Two boxes
  const boxes: { x: number; stroke: string }[] = [
    { x: 24, stroke: t.accent },
    { x: 194, stroke: t.accent2 },
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
  ctx.fillStyle = t.accent
  const starsText = `${info.stars}`
  const sw = ctx.measureText(starsText).width
  ctx.textAlign = 'left'
  const leftStart = 101 - (sw + 14 + 38) / 2
  ctx.fillText(starsText, leftStart, 230)
  themedStar(ctx, t, leftStart + sw + 14 + 19, 216, 19)
  // Right: entries now
  const entText = `${info.entries}`
  const ew = ctx.measureText(entText).width
  const rightStart = 271 - (ew + 14 + 44) / 2
  ctx.fillStyle = '#ffffff'
  ctx.fillText(entText, rightStart, 230)
  ticket(ctx, t, rightStart + ew + 14 + 22, 216, 44)

  // Labels
  ctx.textAlign = 'center'
  ctx.font = '700 13px InterB'
  ctx.fillStyle = t.boxText
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
    ctx.fillStyle = t.accent
    ctx.fill()
    ctx.fillStyle = '#1b0f00'
    ctx.fillText(label, 372 - tw / 2 - 14, 30)
  }

  return canvas.toBuffer('image/png')
}
