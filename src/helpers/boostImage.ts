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
  dark: string
}

// One look per pack: the bigger the pack, the more epic the card
const TIERS: Record<number, Tier> = {
  1: {
    title: 'BOOST',
    bgInner: '#2b2140', bgOuter: '#0d0a18',
    header: '#e7b48a',
    starTop: '#f3c299', starBottom: '#c9783a', starStroke: '#ffe3c8',
    accent: '#e0975a', accent2: '#b86a2d', boxText: '#f3d9c3',
    frame: 0, rays: false, sparkles: 4, crown: false, light: '#f3c299', dark: '#3a2112',
  },
  2: {
    title: 'SUPER BOOST',
    bgInner: '#12435a', bgOuter: '#05121c',
    header: '#9fe6ff',
    starTop: '#f4fdff', starBottom: '#8fc4d8', starStroke: '#ffffff',
    accent: '#7fe0ff', accent2: '#3aa8d0', boxText: '#cdf3ff',
    frame: 2, rays: false, sparkles: 8, crown: false, light: '#e6faff', dark: '#0e3a4d',
  },
  3: {
    title: 'MEGA BOOST',
    bgInner: '#4a2a9a', bgOuter: '#0c0630',
    header: '#ffe08a',
    starTop: '#ffe27a', starBottom: '#f5a30a', starStroke: '#fff3b8',
    accent: '#ffd54a', accent2: '#ff9d1c', boxText: '#fff1c4',
    frame: 3, rays: true, sparkles: 12, crown: false, light: '#fff3b8', dark: '#4a3000',
  },
  4: {
    title: 'ULTRA BOOST',
    bgInner: '#2a1a66', bgOuter: '#0a0620',
    header: '#d8c8ff',
    starTop: '#efe6ff', starBottom: '#9a78f0', starStroke: '#ffffff',
    accent: '#a98bff', accent2: '#6c4bd8', boxText: '#e6dcff',
    frame: 4, rays: true, sparkles: 16, crown: false, light: '#e6dcff', dark: '#241552',
  },
  5: {
    title: 'LEGENDARY BOOST',
    bgInner: '#7a1fa8', bgOuter: '#14031f',
    header: '#ffe9a8',
    starTop: '#fff6c9', starBottom: '#ffb300', starStroke: '#ffffff',
    accent: '#ff5fd2', accent2: '#ffd54a', boxText: '#ffe6fa',
    frame: 5, rays: true, sparkles: 22, crown: true, light: '#ffe6fa', dark: '#4a0f3c',
  },
}

function tierFor(boosts: number) {
  return Math.min(5, Math.max(1, Math.round(boosts) || 1))
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

/** Star positions: 1 star, then pyramids (1+2, 2+3, 1+2+3+4) so the count is always exact */
function pyramid(n: number, cx: number, cy: number, maxW: number, maxH: number) {
  const known: Record<number, number[]> = { 1: [1], 2: [2], 3: [1, 2], 4: [2, 2], 5: [2, 3], 10: [1, 2, 3, 4] }
  let rows = known[n]
  if (!rows) {
    rows = []
    let left = n
    for (let k = 1; left > 0; k++) {
      rows.push(Math.min(k, left))
      left -= k
    }
  }
  const widest = Math.max(...rows)
  const r = Math.min(n === 1 ? 40 : 30, maxH / (rows.length * 2.15), maxW / (widest * 2.3))
  const gap = r * 2.3
  const vs = r * 2.1
  const out: [number, number, number][] = []
  rows.forEach((k, ri) => {
    const y = cy + (ri - (rows.length - 1) / 2) * vs
    for (let j = 0; j < k; j++) out.push([cx + (j - (k - 1) / 2) * gap, y, r])
  })
  return out
}

/**
 * Renders the boost card as a PNG (pyramid of stars, one star per Star paid).
 * @param name person's name or @username (characters the font cannot draw are dropped)
 * @param stars Stars paid in this boost
 * @param entries total entries the person has now
 * @param mult active multiplier (shows a "x2 today" tag when above 1)
 * @param boosts boosts bought in this purchase (picks the look)
 * @param winner draws the winner version (crown + WINNER) instead of the purchase one
 */
export async function renderBoostImage(info: {
  name: string
  stars: number
  entries: number
  mult?: number
  boosts?: number
  winner?: boolean
}): Promise<Buffer> {
  if (info.winner) return renderWinImage(info)
  const { createCanvas } = loadCanvas()
  const S = 2 // render at 2x for sharpness
  const canvas = createCanvas(372 * S, 300 * S)
  const ctx = canvas.getContext('2d')
  ctx.scale(S, S)

  const t = TIERS[tierFor(info.boosts || info.stars)]
  const text = (s: string, x: number, y: number, font: string, color: string, align = 'left', ls = '0px') => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = align
    ;(ctx as any).letterSpacing = ls
    ctx.fillText(s, x, y)
    ;(ctx as any).letterSpacing = '0px'
  }
  const halo = (x: number, y: number, r: number, color: string, alpha: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color + alpha)
    g.addColorStop(1, color + '00')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Background with light rays
  ctx.fillStyle = '#0a0705'
  ctx.fillRect(0, 0, 372, 300)
  const bg = ctx.createRadialGradient(186, 112, 10, 186, 112, 230)
  bg.addColorStop(0, t.dark)
  bg.addColorStop(1, '#0a0705')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 372, 300)
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(186, 112)
    ctx.lineTo(186 + Math.cos(a - 0.04) * 300, 112 + Math.sin(a - 0.04) * 300)
    ctx.lineTo(186 + Math.cos(a + 0.04) * 300, 112 + Math.sin(a + 0.04) * 300)
    ctx.fillStyle = 'rgba(255,255,255,0.035)'
    ctx.fill()
  }
  halo(186, 112, 120, t.accent, '55')

  // Name and pack (winner version: crown + WINNER, smaller pyramid)
  const win = !!info.winner
  if (win) {
    crownIcon(ctx, t, 186, 26, 40)
    text('WINNER', 186, 60, '800 12px InterX', t.accent, 'center', '6px')
  }
  const name = drawableName(info.name)
  if (name) {
    let size = win ? 26 : 22
    ctx.font = `800 ${size}px InterX`
    while (ctx.measureText(name).width > 300 && size > 14) {
      size -= 2
      ctx.font = `800 ${size}px InterX`
    }
    text(name, 186, win ? 90 : 36, ctx.font, '#ffffff', 'center')
  }
  if (!win) {
    text(`bought a ${t.title.toLowerCase()}`, 186, 54, '700 12px InterB', t.accent, 'center', '1px')
  }

  // One star per Star paid
  const stars = win
    ? pyramid(Math.max(1, info.stars), 186, 141, 220, 76)
    : pyramid(Math.max(1, info.stars), 186, 118, 260, 120)
  for (const [x, y, r] of stars) {
    const g = ctx.createLinearGradient(0, y - r, 0, y + r)
    g.addColorStop(0, t.light)
    g.addColorStop(1, t.accent2)
    starPath(ctx, x, y, r)
    ctx.fillStyle = g
    ctx.fill()
    ctx.lineWidth = Math.max(1, r * 0.07)
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
  }

  // Entries box
  ctx.fillStyle = t.accent
  ctx.globalAlpha = 0.4
  ctx.fillRect(36, 188, 300, 1)
  ctx.globalAlpha = 1
  roundRect(ctx, 36, 200, 300, 76, 16)
  const bx = ctx.createLinearGradient(0, 200, 0, 276)
  bx.addColorStop(0, t.accent + '33')
  bx.addColorStop(1, t.accent + '0d')
  ctx.fillStyle = bx
  ctx.fill()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = t.accent
  ctx.stroke()
  const entText = `${info.entries}`
  text(entText, 70, 254, '800 54px InterX', '#ffffff', 'left')
  ctx.font = '800 54px InterX'
  const ew = ctx.measureText(entText).width
  text(win ? 'ENTRIES' : 'ENTRIES NOW', 80 + ew, 238, '800 13px InterX', t.accent, 'left', '2px')
  text(`${win ? 'won with' : 'for'} ${info.stars} ${info.stars > 1 ? 'stars' : 'star'}`, 80 + ew, 258, '700 12px InterB', 'rgba(255,255,255,0.6)', 'left')

  // Multiplier tag
  if (info.mult && info.mult > 1) {
    const label = `x${+info.mult.toFixed(2)} TODAY`
    ctx.font = '800 12px InterX'
    const w = ctx.measureText(label).width + 20
    roundRect(ctx, 356 - w, 12, w, 24, 12)
    ctx.fillStyle = t.accent
    ctx.fill()
    text(label, 356 - w / 2, 28, '800 12px InterX', '#1b0f00', 'center')
  }

  return canvas.toBuffer('image/png')
}

/** Small deterministic random generator so the confetti looks the same every time */
function seeded(seed: number) {
  let v = seed
  return () => {
    v = (v * 16807) % 2147483647
    return v / 2147483647
  }
}

function drawTrophy(ctx: any, cx: number, top: number, h: number) {
  const w = h * 0.72
  const gg = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0)
  gg.addColorStop(0, '#c98a10')
  gg.addColorStop(0.35, '#ffe27a')
  gg.addColorStop(0.6, '#ffc933')
  gg.addColorStop(1, '#b87a0c')
  const bw = w * 0.62
  const bh = h * 0.5
  // handles
  ctx.lineWidth = h * 0.06
  ctx.strokeStyle = '#e0a21c'
  ctx.beginPath()
  ctx.arc(cx - bw / 2, top + bh * 0.38, bh * 0.3, Math.PI * 0.5, Math.PI * 1.5)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx + bw / 2, top + bh * 0.38, bh * 0.3, -Math.PI * 0.5, Math.PI * 0.5)
  ctx.stroke()
  // bowl
  ctx.beginPath()
  ctx.moveTo(cx - bw / 2, top)
  ctx.lineTo(cx + bw / 2, top)
  ctx.quadraticCurveTo(cx + bw / 2, top + bh * 0.95, cx, top + bh)
  ctx.quadraticCurveTo(cx - bw / 2, top + bh * 0.95, cx - bw / 2, top)
  ctx.closePath()
  ctx.fillStyle = gg
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#fff3b8'
  ctx.stroke()
  // star on the bowl
  const sg = ctx.createLinearGradient(0, top + bh * 0.2, 0, top + bh * 0.6)
  sg.addColorStop(0, '#fff8d6')
  sg.addColorStop(1, '#e6a100')
  starPath(ctx, cx, top + bh * 0.4, bh * 0.2)
  ctx.fillStyle = sg
  ctx.fill()
  // stem and base
  ctx.fillStyle = gg
  ctx.fillRect(cx - h * 0.05, top + bh, h * 0.1, h * 0.2)
  roundRect(ctx, cx - w * 0.3, top + bh + h * 0.2, w * 0.6, h * 0.1, h * 0.03)
  ctx.fill()
  roundRect(ctx, cx - w * 0.4, top + bh + h * 0.3, w * 0.8, h * 0.12, h * 0.03)
  ctx.fillStyle = '#8a5a08'
  ctx.fill()
  ctx.strokeStyle = '#ffe27a'
  ctx.lineWidth = 1
  ctx.stroke()
}

/** Winner card: trophy, WINNER ribbon, one star per Star paid, entries and pack */
async function renderWinImage(info: {
  name: string
  stars: number
  entries: number
  boosts?: number
}): Promise<Buffer> {
  const { createCanvas } = loadCanvas()
  const S = 2
  const canvas = createCanvas(372 * S, 300 * S)
  const ctx = canvas.getContext('2d')
  ctx.scale(S, S)
  const t = TIERS[tierFor(info.boosts || info.stars)]
  const text = (s: string, x: number, y: number, font: string, color: string, ls = '0px') => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ;(ctx as any).letterSpacing = ls
    ctx.fillText(s, x, y)
    ;(ctx as any).letterSpacing = '0px'
  }

  // Background: golden rays and glow
  const bg = ctx.createRadialGradient(186, 100, 10, 186, 100, 250)
  bg.addColorStop(0, '#6b4a0c')
  bg.addColorStop(1, '#120a02')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 372, 300)
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(186, 100)
    ctx.lineTo(186 + Math.cos(a - 0.035) * 320, 100 + Math.sin(a - 0.035) * 320)
    ctx.lineTo(186 + Math.cos(a + 0.035) * 320, 100 + Math.sin(a + 0.035) * 320)
    ctx.fillStyle = 'rgba(255,220,120,0.07)'
    ctx.fill()
  }
  const halo = ctx.createRadialGradient(186, 90, 0, 186, 90, 110)
  halo.addColorStop(0, '#ffd54a66')
  halo.addColorStop(1, '#ffd54a00')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(186, 90, 110, 0, Math.PI * 2)
  ctx.fill()

  // Confetti
  const rnd = seeded(5)
  const colors = ['#ffd54a', '#ffffff', '#ffb300', t.accent, '#ff6ec7']
  for (let k = 0; k < 60; k++) {
    ctx.save()
    ctx.translate(rnd() * 372, rnd() * 250)
    ctx.rotate(rnd() * 6)
    ctx.globalAlpha = 0.8
    ctx.fillStyle = colors[k % 5]
    ctx.fillRect(-4, -2, 8, 4)
    ctx.restore()
  }
  ctx.globalAlpha = 1

  drawTrophy(ctx, 186, 10, 98)

  // One star per Star paid (colour of the pack)
  const n = Math.max(1, Math.min(5, info.stars))
  for (let k = 0; k < n; k++) {
    const x = 186 + (k - (n - 1) / 2) * 34
    const y = 128
    const g = ctx.createLinearGradient(0, y - 13, 0, y + 13)
    g.addColorStop(0, t.light)
    g.addColorStop(1, t.accent2)
    starPath(ctx, x, y, 13)
    ctx.fillStyle = g
    ctx.fill()
    ctx.lineWidth = 1.2
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
  }

  // Ribbon
  ctx.fillStyle = '#b8860b'
  ctx.beginPath()
  ctx.moveTo(34, 156)
  ctx.lineTo(70, 156)
  ctx.lineTo(70, 188)
  ctx.lineTo(34, 188)
  ctx.lineTo(46, 172)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(338, 156)
  ctx.lineTo(302, 156)
  ctx.lineTo(302, 188)
  ctx.lineTo(338, 188)
  ctx.lineTo(326, 172)
  ctx.closePath()
  ctx.fill()
  const rb = ctx.createLinearGradient(0, 148, 0, 182)
  rb.addColorStop(0, '#fff0a8')
  rb.addColorStop(1, '#f0a800')
  roundRect(ctx, 56, 148, 260, 34, 6)
  ctx.fillStyle = rb
  ctx.fill()
  text('WINNER', 186, 172, '800 20px InterX', '#4a2c00', '8px')

  // Name
  const name = drawableName(info.name)
  if (name) {
    let size = 28
    ctx.font = `800 ${size}px InterX`
    while (ctx.measureText(name).width > 320 && size > 14) {
      size -= 2
      ctx.font = `800 ${size}px InterX`
    }
    text(name, 186, 214, ctx.font, '#ffffff')
  }

  // Entries and pack
  roundRect(ctx, 36, 230, 150, 40, 20)
  ctx.fillStyle = 'rgba(255,255,255,0.1)'
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'
  ctx.stroke()
  text(`${info.entries} ENTRIES`, 111, 255, '800 15px InterX', '#ffffff', '1px')
  roundRect(ctx, 198, 230, 138, 40, 20)
  ctx.fillStyle = t.accent
  ctx.fill()
  text(
    `${info.stars} ${info.stars > 1 ? 'STARS' : 'STAR'} BOOST`,
    267,
    255,
    '800 14px InterX',
    '#1b0f00',
    '1px'
  )

  return canvas.toBuffer('image/png')
}
