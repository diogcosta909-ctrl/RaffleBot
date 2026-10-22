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
  crypto?: boolean
  credits?: boolean
  gift?: boolean
  usdt?: string
}): Promise<Buffer> {
  if (info.winner) return renderWinImage(info)
  if (info.credits && info.gift) return renderCryptoImage({ ...info, theme: 'gift' })
  if (info.credits) return renderCryptoImage({ ...info, theme: 'credits' })
  if (info.crypto) return renderCryptoImage(info)
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
  crypto?: boolean
  credits?: boolean
}): Promise<Buffer> {
  const { createCanvas } = loadCanvas()
  const cc = !!info.credits
  const cr = !!info.crypto || cc
  const logo = cr && !cc ? await usdtLogo() : null
  const P = cc
    ? { bg0: '#12245a', bg1: '#050914', ray: 'rgba(169,196,255,0.07)', halo: '#4f7cff', conf: ['#4f7cff', '#ffffff', '#a9c4ff', '#ffd54a', '#3556d8'], rd: '#2c46b0', rb0: '#d6e2ff', rb1: '#4f7cff', rt: '#0a1640', pill: '#4f7cff', label: 'CREDITS BOOST' }
    : { bg0: '#0f4a38', bg1: '#05100c', ray: 'rgba(127,224,191,0.07)', halo: '#26a17b', conf: ['#26a17b', '#ffffff', '#7fe0bf', '#ffd54a', '#1d7f61'], rd: '#1d7f61', rb0: '#b6f5df', rb1: '#26a17b', rt: '#04251b', pill: '#26a17b', label: 'USDT BOOST' }
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
  bg.addColorStop(0, cr ? P.bg0 : '#6b4a0c')
  bg.addColorStop(1, cr ? P.bg1 : '#120a02')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 372, 300)
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(186, 100)
    ctx.lineTo(186 + Math.cos(a - 0.035) * 320, 100 + Math.sin(a - 0.035) * 320)
    ctx.lineTo(186 + Math.cos(a + 0.035) * 320, 100 + Math.sin(a + 0.035) * 320)
    ctx.fillStyle = cr ? P.ray : 'rgba(255,220,120,0.07)'
    ctx.fill()
  }
  const halo = ctx.createRadialGradient(186, 90, 0, 186, 90, 110)
  halo.addColorStop(0, cr ? `${P.halo}66` : '#ffd54a66')
  halo.addColorStop(1, cr ? `${P.halo}00` : '#ffd54a00')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(186, 90, 110, 0, Math.PI * 2)
  ctx.fill()

  // Confetti
  const rnd = seeded(5)
  const colors = cr ? P.conf : ['#ffd54a', '#ffffff', '#ffb300', t.accent, '#ff6ec7']
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
    if (cc) {
      drawCreditCoin(ctx, x, y, 14)
      continue
    }
    if (cr) {
      ctx.drawImage(logo, x - 14, y - 14, 28, 28)
      ctx.lineWidth = 1.2
      ctx.strokeStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(x, y, 14, 0, Math.PI * 2)
      ctx.stroke()
      continue
    }
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
  ctx.fillStyle = cr ? P.rd : '#b8860b'
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
  rb.addColorStop(0, cr ? P.rb0 : '#fff0a8')
  rb.addColorStop(1, cr ? P.rb1 : '#f0a800')
  roundRect(ctx, 56, 148, 260, 34, 6)
  ctx.fillStyle = rb
  ctx.fill()
  text('WINNER', 186, 172, '800 20px InterX', cr ? P.rt : '#4a2c00', '8px')

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
  ctx.fillStyle = cr ? P.pill : t.accent
  ctx.fill()
  text(
    cr ? P.label : `${info.stars} ${info.stars > 1 ? 'STARS' : 'STAR'} BOOST`,
    267,
    255,
    '800 14px InterX',
    cr ? '#04130e' : '#1b0f00',
    '1px'
  )

  return canvas.toBuffer('image/png')
}

/** USDT logo supplied by the owner (embedded in usdtLogo.ts) */
async function usdtLogo() {
  const { loadImage } = loadCanvas()
  return loadImage(Buffer.from(require('./usdtLogo').USDT_LOGO_BASE64, 'base64'))
}

/** Generic credit coin (blue, lightning bolt) used for boosts paid with credits */
function drawCreditCoin(ctx: any, x: number, y: number, r: number, gift?: boolean) {
  const g = ctx.createLinearGradient(0, y - r, 0, y + r)
  g.addColorStop(0, gift ? '#c9a6ff' : '#9db8ff')
  g.addColorStop(1, gift ? '#7a3ae0' : '#3556d8')
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = Math.max(1.2, r * 0.07)
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, r * 0.78, 0, Math.PI * 2)
  ctx.lineWidth = Math.max(1, r * 0.04)
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.stroke()
  const pts = [[0.16, -0.58], [-0.34, 0.08], [-0.02, 0.08], [-0.16, 0.58], [0.34, -0.1], [0.02, -0.1]]
  ctx.beginPath()
  pts.forEach(([px, py], i) => {
    if (i === 0) ctx.moveTo(x + px * r, y + py * r)
    else ctx.lineTo(x + px * r, y + py * r)
  })
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()
}

/** Banner for the crypto payment instructions: logo, amount and network */
export async function renderUsdtImage(info: { amount: string; pct: string; network?: string }): Promise<Buffer> {
  const { createCanvas } = loadCanvas()
  const logo = await usdtLogo()
  const S = 2
  const W = 372
  const H = 190
  const canvas = createCanvas(W * S, H * S)
  const ctx = canvas.getContext('2d')
  ctx.scale(S, S)
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#0f2a24')
  bg.addColorStop(1, '#07120f')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const halo = ctx.createRadialGradient(W / 2, 62, 4, W / 2, 62, 120)
  halo.addColorStop(0, 'rgba(38,161,123,0.55)')
  halo.addColorStop(1, 'rgba(38,161,123,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, W, H)
  ctx.drawImage(logo, W / 2 - 34, 22, 68, 68)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = '28px InterX'
  ctx.fillText(`${info.amount} USDT`, W / 2, 130)
  ctx.fillStyle = '#7fe0bf'
  ctx.font = '12px InterB'
  ctx.fillText(`${info.pct.toUpperCase()}  ·  ${(info.network || 'BNB Smart Chain (BEP20)').toUpperCase()}`, W / 2, 158)
  return canvas.toBuffer('image/png')
}

/** Feed card for purchases paid in USDT: green Tether look, one coin (logo) per pack unit */
async function renderCryptoImage(info: { name: string; entries: number; mult?: number; boosts?: number; stars: number; usdt?: string; theme?: string }) {
  const { createCanvas } = loadCanvas()
  const gift = info.theme === 'gift'
  const credits = info.theme === 'credits' || gift
  const logo = credits ? null : await usdtLogo()
  const S = 2
  const canvas = createCanvas(372 * S, 300 * S)
  const ctx = canvas.getContext('2d')
  ctx.scale(S, S)
  const G = gift ? '#9b5cff' : credits ? '#4f7cff' : '#26a17b'
  const L = gift ? '#d8c0ff' : credits ? '#a9c4ff' : '#7fe0bf'
  const n = Math.max(1, Math.round(info.boosts || info.stars || 1))
  const t = TIERS[tierFor(n)]
  const text = (s: string, x: number, y: number, font: string, color: string, align = 'left', ls = '0px') => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = align
    ;(ctx as any).letterSpacing = ls
    ctx.fillText(s, x, y)
    ;(ctx as any).letterSpacing = '0px'
  }
  const dark = gift ? '#0c0618' : credits ? '#050914' : '#05100c'
  ctx.fillStyle = dark
  ctx.fillRect(0, 0, 372, 300)
  const bg = ctx.createRadialGradient(186, 112, 10, 186, 112, 230)
  bg.addColorStop(0, gift ? '#3a1470' : credits ? '#12245a' : '#0f3a2e')
  bg.addColorStop(1, dark)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 372, 300)
  // Circuit-like diagonal lines instead of rays
  ctx.strokeStyle = gift ? 'rgba(155,92,255,0.12)' : credits ? 'rgba(79,124,255,0.10)' : 'rgba(38,161,123,0.10)'
  ctx.lineWidth = 1
  for (let k = -300; k < 400; k += 22) {
    ctx.beginPath()
    ctx.moveTo(k, 0)
    ctx.lineTo(k + 300, 300)
    ctx.stroke()
  }
  const h = ctx.createRadialGradient(186, 118, 0, 186, 118, 120)
  h.addColorStop(0, gift ? 'rgba(155,92,255,0.38)' : credits ? 'rgba(79,124,255,0.38)' : 'rgba(38,161,123,0.38)')
  h.addColorStop(1, gift ? 'rgba(155,92,255,0)' : credits ? 'rgba(79,124,255,0)' : 'rgba(38,161,123,0)')
  ctx.fillStyle = h
  ctx.fillRect(0, 0, 372, 300)

  const name = drawableName(info.name)
  if (name) {
    let size = 22
    ctx.font = `800 ${size}px InterX`
    while (ctx.measureText(name).width > 300 && size > 14) {
      size -= 2
      ctx.font = `800 ${size}px InterX`
    }
    text(name, 186, 36, ctx.font, '#ffffff', 'center')
  }
  text(`${gift ? `used a gift for a ${t.title.toLowerCase()}` : `bought a ${t.title.toLowerCase()} with ${credits ? 'credits' : 'USDT'}`}`, 186, 54, '700 12px InterB', L, 'center', '1px')

  for (const [x, y, r] of pyramid(n, 186, 126, 260, 108)) {
    if (credits) {
      drawCreditCoin(ctx, x, y, r, gift)
      continue
    }
    ctx.drawImage(logo, x - r, y - r, r * 2, r * 2)
    ctx.lineWidth = Math.max(1.2, r * 0.07)
    ctx.strokeStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.fillStyle = G
  ctx.globalAlpha = 0.4
  ctx.fillRect(36, 188, 300, 1)
  ctx.globalAlpha = 1
  roundRect(ctx, 36, 200, 300, 76, 16)
  const bx = ctx.createLinearGradient(0, 200, 0, 276)
  bx.addColorStop(0, G + '40')
  bx.addColorStop(1, G + '0d')
  ctx.fillStyle = bx
  ctx.fill()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = G
  ctx.stroke()
  const entText = `${info.entries}`
  text(entText, 70, 254, '800 54px InterX', '#ffffff', 'left')
  ctx.font = '800 54px InterX'
  const ew = ctx.measureText(entText).width
  text('ENTRIES NOW', 80 + ew, 238, '800 13px InterX', L, 'left', '2px')
  text(gift ? `${n} gift ${n === 1 ? 'credit' : 'credits'}` : credits ? `paid with ${n} ${n === 1 ? 'credit' : 'credits'}` : info.usdt ? `for ${info.usdt} USDT` : 'paid in USDT', 80 + ew, 258, '700 12px InterB', 'rgba(255,255,255,0.6)', 'left')

  if (info.mult && info.mult > 1) {
    const label = `x${+info.mult.toFixed(2)} TODAY`
    ctx.font = '800 12px InterX'
    const w = ctx.measureText(label).width + 20
    roundRect(ctx, 356 - w, 12, w, 24, 12)
    ctx.fillStyle = G
    ctx.fill()
    text(label, 356 - w / 2, 28, '800 12px InterX', '#04130e', 'center')
  }
  if (gift) {
    // Golden banner: this boost came from free gift credits
    const gr = ctx.createLinearGradient(0, 0, 372, 0)
    gr.addColorStop(0, '#ffb300')
    gr.addColorStop(0.5, '#ffe27a')
    gr.addColorStop(1, '#ffb300')
    ctx.fillStyle = gr
    ctx.fillRect(0, 278, 372, 22)
    text('GIFT CREDITS', 186, 293, '800 12px InterX', '#2a1800', 'center', '3px')
    for (const cx of [75, 297]) {
      ctx.fillStyle = '#7a3ae0'
      ctx.fillRect(cx - 6, 284, 12, 9)
      ctx.fillStyle = '#9b5cff'
      ctx.fillRect(cx - 7, 281, 14, 4)
      ctx.fillStyle = '#ffd54a'
      ctx.fillRect(cx - 1, 281, 2, 12)
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    for (const [px, py, r] of [[30, 75, 2], [345, 85, 2.5], [55, 165, 1.5], [325, 165, 2], [20, 210, 1.5], [350, 225, 1.5]]) {
      ctx.beginPath()
      ctx.arc(px, py, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  return canvas.toBuffer('image/png')
}

/** Image for the public feed when someone recharges credits (blue credits theme) */
export async function renderRechargeImage(info: {
  name: string
  credits: number // pack bought
  bonus?: number // free credits on top
  paid: string // "20 stars" / "0.4 USDT"
}): Promise<Buffer> {
  const { createCanvas } = loadCanvas()
  const S = 2
  const canvas = createCanvas(372 * S, 300 * S)
  const ctx = canvas.getContext('2d')
  ctx.scale(S, S)
  const G = '#4f7cff'
  const L = '#a9c4ff'
  const bonus = info.bonus || 0
  const total = Math.max(1, Math.round(info.credits + bonus))
  const text = (s: string, x: number, y: number, font: string, color: string, align = 'left', ls = '0px') => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = align
    ;(ctx as any).letterSpacing = ls
    ctx.fillText(s, x, y)
    ;(ctx as any).letterSpacing = '0px'
  }
  const dark = '#050914'
  ctx.fillStyle = dark
  ctx.fillRect(0, 0, 372, 300)
  const bg = ctx.createRadialGradient(186, 112, 10, 186, 112, 230)
  bg.addColorStop(0, '#12245a')
  bg.addColorStop(1, dark)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 372, 300)
  ctx.strokeStyle = 'rgba(79,124,255,0.10)'
  ctx.lineWidth = 1
  for (let k = -300; k < 400; k += 22) {
    ctx.beginPath()
    ctx.moveTo(k, 0)
    ctx.lineTo(k + 300, 300)
    ctx.stroke()
  }
  const h = ctx.createRadialGradient(186, 118, 0, 186, 118, 120)
  h.addColorStop(0, 'rgba(79,124,255,0.38)')
  h.addColorStop(1, 'rgba(79,124,255,0)')
  ctx.fillStyle = h
  ctx.fillRect(0, 0, 372, 300)

  const name = drawableName(info.name)
  if (name) {
    let size = 22
    ctx.font = `800 ${size}px InterX`
    while (ctx.measureText(name).width > 300 && size > 14) {
      size -= 2
      ctx.font = `800 ${size}px InterX`
    }
    text(name, 186, 36, ctx.font, '#ffffff', 'center')
  }
  text('recharged credits', 186, 54, '700 12px InterB', L, 'center', '1px')

  // One big coin with glowing rings; a "+N FREE" badge when the pack comes with bonus
  for (const [rad, alpha] of [[84, 0.08], [66, 0.12]]) {
    ctx.beginPath()
    ctx.arc(186, 118, rad, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(169,196,255,${alpha * 2})`
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  drawCreditCoin(ctx, 186, 118, 52)
  if (bonus > 0) {
    const label = `+${bonus} FREE`
    ctx.font = '800 13px InterX'
    const w = ctx.measureText(label).width + 22
    roundRect(ctx, 246, 74, w, 26, 13)
    ctx.fillStyle = '#ffd24a'
    ctx.fill()
    text(label, 246 + w / 2, 92, '800 13px InterX', '#2a1b00', 'center')
  }

  ctx.fillStyle = G
  ctx.globalAlpha = 0.4
  ctx.fillRect(36, 188, 300, 1)
  ctx.globalAlpha = 1
  roundRect(ctx, 36, 200, 300, 76, 16)
  const bx = ctx.createLinearGradient(0, 200, 0, 276)
  bx.addColorStop(0, G + '40')
  bx.addColorStop(1, G + '0d')
  ctx.fillStyle = bx
  ctx.fill()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = G
  ctx.stroke()
  const big = `+${total}`
  text(big, 70, 254, '800 54px InterX', '#ffffff', 'left')
  ctx.font = '800 54px InterX'
  const ew = ctx.measureText(big).width
  text('CREDITS', 80 + ew, 238, '800 13px InterX', L, 'left', '2px')
  text(bonus > 0 ? `${info.credits} + ${bonus} free` : info.paid, 80 + ew, 258, '700 12px InterB', 'rgba(255,255,255,0.6)', 'left')
  return canvas.toBuffer('image/png')
}

/** Feed image when someone redeems a credit code: purple gift box, free credits and codes left */
export async function renderCodeImage(info: { name: string; credits: number; left: number }): Promise<Buffer> {
  const { createCanvas } = loadCanvas()
  const S = 2
  const W = 372
  const H = 300
  const canvas = createCanvas(W * S, H * S)
  const ctx = canvas.getContext('2d')
  ctx.scale(S, S)
  const dark = '#0d0414'
  const mid = '#3b0f4f'
  const acc = '#d946ef'
  const light = '#f0abfc'
  const text = (s: string, x: number, y: number, font: string, color: string, align = 'left', ls = '0px') => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = align
    ;(ctx as any).letterSpacing = ls
    ctx.fillText(s, x, y)
    ;(ctx as any).letterSpacing = '0px'
  }
  ctx.fillStyle = dark
  ctx.fillRect(0, 0, W, H)
  const bg = ctx.createRadialGradient(186, 100, 10, 186, 100, 240)
  bg.addColorStop(0, mid)
  bg.addColorStop(1, dark)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = 'rgba(217,70,239,0.10)'
  ctx.lineWidth = 1
  for (let k = -300; k < 400; k += 22) {
    ctx.beginPath()
    ctx.moveTo(k, 0)
    ctx.lineTo(k + 300, H)
    ctx.stroke()
  }
  // Confetti (fixed pattern)
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const colors = ['#ffd24a', light, '#ffffff', acc]
  for (let i = 0; i < 46; i++) {
    const x = rnd() * W
    const y = rnd() * 170
    const rot = rnd() * 6
    if (Math.hypot(x - 186, y - 110) < 62) continue
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)
    ctx.fillStyle = colors[i % 4]
    ctx.globalAlpha = 0.85
    ctx.fillRect(-3, -1.5, 6, 3)
    ctx.restore()
  }

  const name = drawableName(info.name)
  if (name) {
    let size = 22
    ctx.font = `800 ${size}px InterX`
    while (ctx.measureText(name).width > 300 && size > 14) {
      size -= 2
      ctx.font = `800 ${size}px InterX`
    }
    text(name, 186, 34, ctx.font, '#ffffff', 'center')
  }
  text('CLAIMED A GIFT CODE', 186, 52, '800 11px InterB', light, 'center', '2px')

  // Gift box with bow
  const gx = 186
  const gy = 112
  roundRect(ctx, gx - 40, gy - 8, 80, 52, 6)
  const g1 = ctx.createLinearGradient(0, gy - 8, 0, gy + 44)
  g1.addColorStop(0, light)
  g1.addColorStop(1, acc)
  ctx.fillStyle = g1
  ctx.fill()
  roundRect(ctx, gx - 46, gy - 24, 92, 22, 6)
  ctx.fillStyle = light
  ctx.fill()
  ctx.fillStyle = '#ffd24a'
  ctx.fillRect(gx - 7, gy - 24, 14, 68)
  ctx.strokeStyle = '#ffd24a'
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.ellipse(gx - 15, gy - 36, 14, 10, -0.5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(gx + 15, gy - 36, 14, 10, 0.5, 0, Math.PI * 2)
  ctx.stroke()

  // Coupon-style dashed box
  ctx.setLineDash([6, 4])
  roundRect(ctx, 36, 170, 300, 78, 16)
  const bx = ctx.createLinearGradient(0, 170, 0, 248)
  bx.addColorStop(0, acc + '55')
  bx.addColorStop(1, acc + '12')
  ctx.fillStyle = bx
  ctx.fill()
  ctx.lineWidth = 1.6
  ctx.strokeStyle = light
  ctx.stroke()
  ctx.setLineDash([])
  const big = `+${info.credits}`
  ctx.font = '800 54px InterX'
  const ew = ctx.measureText(big).width
  const x0 = 186 - (ew + 100) / 2
  text(big, x0, 227, '800 54px InterX', '#ffffff')
  text('FREE', x0 + ew + 10, 206, '800 14px InterX', '#ffd24a', 'left', '2px')
  text('CREDITS', x0 + ew + 10, 227, '800 14px InterX', light, 'left', '2px')

  // How many codes are still available
  const label = info.left <= 0 ? 'ALL CLAIMED' : info.left === 1 ? 'LAST ONE LEFT!' : `${info.left} CODES LEFT`
  ctx.font = '800 13px InterX'
  const bw = ctx.measureText(label).width + 28
  roundRect(ctx, 186 - bw / 2, 262, bw, 26, 13)
  ctx.fillStyle = info.left <= 0 ? 'rgba(255,255,255,0.18)' : '#ffd24a'
  ctx.fill()
  text(label, 186, 280, '800 13px InterX', info.left <= 0 ? '#ffffff' : '#2a1b00', 'center')
  return canvas.toBuffer('image/png')
}

/** Feed card for a purchase that boosted several giveaways at once (Boost All) */
export async function renderMultiImage(info: {
  name: string
  giveaways: number
  boosts: number
  per: number
  method: string
}): Promise<Buffer> {
  const { createCanvas } = loadCanvas()
  const themes: any = {
    credits: { bg0: '#12245a', bg1: '#050914', G: '#4f7cff', L: '#a9c4ff', how: 'paid with credits' },
    stars: { bg0: '#6b4a0c', bg1: '#120a02', G: '#f5b301', L: '#ffd77a', how: 'paid with Stars' },
    usdt: { bg0: '#0f4a38', bg1: '#05100c', G: '#26a17b', L: '#7fe0bf', how: 'paid in USDT' },
  }
  const P: any = themes[info.method] || { bg0: '#12245a', bg1: '#050914', G: '#4f7cff', L: '#a9c4ff', how: 'paid' }
  const S = 2
  const canvas = createCanvas(372 * S, 300 * S)
  const ctx = canvas.getContext('2d')
  ctx.scale(S, S)
  const text = (s: string, x: number, y: number, font: string, color: string, align = 'left', ls = '0px') => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = align
    ;(ctx as any).letterSpacing = ls
    ctx.fillText(s, x, y)
    ;(ctx as any).letterSpacing = '0px'
  }
  const bg = ctx.createRadialGradient(186, 110, 10, 186, 110, 240)
  bg.addColorStop(0, P.bg0)
  bg.addColorStop(1, P.bg1)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 372, 300)
  ctx.strokeStyle = P.G + '1a'
  ctx.lineWidth = 1
  for (let k = -300; k < 400; k += 22) {
    ctx.beginPath()
    ctx.moveTo(k, 0)
    ctx.lineTo(k + 300, 300)
    ctx.stroke()
  }
  const name = drawableName(info.name)
  if (name) {
    let size = 22
    ctx.font = `800 ${size}px InterX`
    while (ctx.measureText(name).width > 300 && size > 14) {
      size -= 2
      ctx.font = `800 ${size}px InterX`
    }
    text(name, 186, 36, ctx.font, '#ffffff', 'center')
  }
  text('boosted several giveaways at once', 186, 54, '700 12px InterB', P.L, 'center', '1px')
  // Stack of cards = several giveaways (back cards first, front card on top)
  for (let i = 2; i >= 0; i--) {
    roundRect(ctx, 106 + i * 9, 80 - i * 9, 160, 88, 16)
    ctx.fillStyle = P.bg1
    ctx.fill()
    ctx.fillStyle = P.G + (i === 0 ? '33' : '18')
    ctx.fill()
    ctx.lineWidth = 1.2
    ctx.strokeStyle = P.G + (i === 0 ? 'cc' : '66')
    ctx.stroke()
  }
  text(`${info.giveaways}`, 186, 138, '800 58px InterX', '#ffffff', 'center')
  text('GIVEAWAYS', 186, 158, '800 13px InterX', P.L, 'center', '4px')
  ctx.fillStyle = P.G
  ctx.globalAlpha = 0.4
  ctx.fillRect(36, 188, 300, 1)
  ctx.globalAlpha = 1
  roundRect(ctx, 36, 200, 300, 76, 16)
  const bx = ctx.createLinearGradient(0, 200, 0, 276)
  bx.addColorStop(0, P.G + '40')
  bx.addColorStop(1, P.G + '0d')
  ctx.fillStyle = bx
  ctx.fill()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = P.G
  ctx.stroke()
  const total = `${info.boosts}`
  text(total, 70, 254, '800 54px InterX', '#ffffff', 'left')
  ctx.font = '800 54px InterX'
  const ew = ctx.measureText(total).width
  text(info.boosts === 1 ? 'BOOST' : 'BOOSTS', 80 + ew, 238, '800 13px InterX', P.L, 'left', '2px')
  text(`${info.per} in each · ${P.how}`, 80 + ew, 258, '700 12px InterB', 'rgba(255,255,255,0.6)', 'left')
  return canvas.toBuffer('image/png')
}
