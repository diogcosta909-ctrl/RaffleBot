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
function ticket(ctx: any, t: Tier, cx: number, cy: number, w: number, notch = '#1b2038') {
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
  ctx.fillStyle = notch
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
  light: string
}

// One look per pack: the bigger the pack, the more epic the card
const TIERS: Record<number, Tier> = {
  1: {
    title: 'BOOST',
    bgInner: '#2b2140', bgOuter: '#0d0a18',
    header: '#e7b48a',
    starTop: '#f3c299', starBottom: '#c9783a', starStroke: '#ffe3c8',
    accent: '#e0975a', accent2: '#b86a2d', boxText: '#f3d9c3',
    frame: 0, rays: false, sparkles: 4, crown: false, light: '#f3c299',
  },
  2: {
    title: 'SUPER BOOST',
    bgInner: '#12435a', bgOuter: '#05121c',
    header: '#9fe6ff',
    starTop: '#f4fdff', starBottom: '#8fc4d8', starStroke: '#ffffff',
    accent: '#7fe0ff', accent2: '#3aa8d0', boxText: '#cdf3ff',
    frame: 2, rays: false, sparkles: 8, crown: false, light: '#e6faff',
  },
  3: {
    title: 'MEGA BOOST',
    bgInner: '#4a2a9a', bgOuter: '#0c0630',
    header: '#ffe08a',
    starTop: '#ffe27a', starBottom: '#f5a30a', starStroke: '#fff3b8',
    accent: '#ffd54a', accent2: '#ff9d1c', boxText: '#fff1c4',
    frame: 3, rays: true, sparkles: 12, crown: false, light: '#fff3b8',
  },
  4: {
    title: 'LEGENDARY BOOST',
    bgInner: '#7a1fa8', bgOuter: '#14031f',
    header: '#ffe9a8',
    starTop: '#fff6c9', starBottom: '#ffb300', starStroke: '#ffffff',
    accent: '#ff5fd2', accent2: '#ffd54a', boxText: '#ffe6fa',
    frame: 5, rays: true, sparkles: 22, crown: true, light: '#ffe6fa',
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
 * Renders the boost card as a PNG (medal style).
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
  const canvas = createCanvas(372 * S, 300 * S)
  const ctx = canvas.getContext('2d')
  ctx.scale(S, S)

  const lv = tierFor(info.boosts || info.stars)
  const t = TIERS[lv]
  const text = (s: string, x: number, y: number, font: string, color: string, align = 'left', ls = '0px') => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = align
    ;(ctx as any).letterSpacing = ls
    ctx.fillText(s, x, y)
    ;(ctx as any).letterSpacing = '0px'
  }
  const medalStar = (cx: number, cy: number, r: number) => {
    const g = ctx.createLinearGradient(0, cy - r, 0, cy + r)
    g.addColorStop(0, t.light)
    g.addColorStop(1, t.accent2)
    starPath(ctx, cx, cy, r)
    ctx.fillStyle = g
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
  }

  // Background
  ctx.fillStyle = '#0f1320'
  ctx.fillRect(0, 0, 372, 300)
  const glow = ctx.createRadialGradient(100, 110, 5, 100, 110, 200)
  glow.addColorStop(0, 'rgba(255,255,255,0.12)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 372, 300)

  // Medal
  const cx = 92
  const cy = 120
  if (lv >= 3) {
    ctx.save()
    ctx.translate(cx, cy)
    for (let k = 0; k < 16; k++) {
      ctx.rotate(Math.PI / 8)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(-9, -84)
      ctx.lineTo(9, -84)
      ctx.fillStyle = 'rgba(255,255,255,0.07)'
      ctx.fill()
    }
    ctx.restore()
  }
  if (lv >= 2) {
    // soft halo (drawn as a gradient: canvas shadows are unreliable here)
    const halo = ctx.createRadialGradient(cx, cy, 52, cx, cy, 82)
    halo.addColorStop(0, t.accent + '88')
    halo.addColorStop(1, t.accent + '00')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(cx, cy, 82, 0, Math.PI * 2)
    ctx.fill()
  }
  const rg = ctx.createLinearGradient(0, cy - 62, 0, cy + 62)
  rg.addColorStop(0, t.light)
  rg.addColorStop(1, t.accent2)
  ctx.beginPath()
  ctx.arc(cx, cy, 60, 0, Math.PI * 2)
  ctx.fillStyle = rg
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy, 50, 0, Math.PI * 2)
  ctx.fillStyle = '#161b30'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = t.accent
  ctx.stroke()
  for (let k = 0; k < lv; k++) medalStar(cx - (lv - 1) * 9 + k * 18, cy - 26, 7)
  const starsText = `${info.stars}`
  ctx.font = '800 44px InterX'
  const stw = ctx.measureText(starsText).width
  text(starsText, cx - 8, cy + 22, '800 44px InterX', '#ffffff', 'center')
  medalStar(cx - 8 + stw / 2 + 12, cy + 8, 9)

  // Title, name, tag
  text(t.title, 196, 64, '800 12px InterX', t.accent, 'left', '2px')
  const name = drawableName(info.name)
  if (name) {
    let size = 24
    ctx.font = `800 ${size}px InterX`
    while (ctx.measureText(name).width > 160 && size > 14) {
      size -= 2
      ctx.font = `800 ${size}px InterX`
    }
    text(name, 196, 92, ctx.font, '#ffffff', 'left')
  }
  text('bought a boost', 196, 112, '700 12px InterB', '#8a90a8', 'left')
  if (info.mult && info.mult > 1) {
    const label = `x${+info.mult.toFixed(2)} TODAY`
    ctx.font = '800 12px InterX'
    const w = ctx.measureText(label).width + 18
    roundRect(ctx, 196, 124, w, 22, 11)
    ctx.fillStyle = t.accent
    ctx.fill()
    text(label, 196 + w / 2, 140, '800 12px InterX', '#1b0f00', 'center')
  }

  // Entries bar
  roundRect(ctx, 24, 196, 324, 78, 18)
  ctx.fillStyle = 'rgba(255,255,255,0.07)'
  ctx.fill()
  ctx.lineWidth = 1.3
  ctx.strokeStyle = t.accent
  ctx.stroke()
  ticket(ctx, t, 64, 235, 44)
  const entText = `${info.entries}`
  text(entText, 100, 252, '800 46px InterX', '#ffffff', 'left')
  ctx.font = '800 46px InterX'
  const ew = ctx.measureText(entText).width
  text('ENTRIES NOW', 108 + ew, 244, '800 14px InterX', t.accent, 'left', '2px')
  text('in this giveaway', 108 + ew, 262, '700 12px InterB', '#8a90a8', 'left')

  return canvas.toBuffer('image/png')
}
