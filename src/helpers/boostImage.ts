// Dependencies
import * as path from 'path'

// Images for the public boost feed, winners, packs, codes and USDT payments.
// One shared card layout (type tag, name, big icon, big number) with a colour and an icon per type.
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

/** Text the font can draw: emoji out, the star emoji becomes the word Stars */
function plain(text: string) {
  return `${text || ''}`
    .replace(/⭐️?/g, ' Stars')
    .replace(/[^\x20-\x7EÀ-ɏͰ-ϿЀ-ӿ·+]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

type Theme = { chip: string; a: string; l: string; b0: string; b1: string }
const THEMES: Record<string, Theme> = {
  stars: { chip: 'STARS', a: '#ffc94a', l: '#ffe7a3', b0: '#15203a', b1: '#3a2a08' },
  usdt: { chip: 'USDT', a: '#26c28f', l: '#9af0cf', b0: '#0d2a24', b1: '#06130f' },
  credits: { chip: 'BOOSTS', a: '#5b8cff', l: '#b5ccff', b0: '#101a44', b1: '#060a1c' },
  gift: { chip: 'GIFT BOOST', a: '#ff7ad9', l: '#ffc2ee', b0: '#2a1046', b1: '#12061f' },
  auto: { chip: 'AUTO-BOOST', a: '#5ee7ff', l: '#b6f3ff', b0: '#160c3a', b1: '#07302f' },
  multi: { chip: 'BOOST ALL', a: '#ff9f43', l: '#ffd2a1', b0: '#2a1a0a', b1: '#120a02' },
  pack: { chip: 'PACK', a: '#3ddc84', l: '#a6f2c4', b0: '#0b2a1c', b1: '#3a2a06' },
  code: { chip: 'GIFT CODE', a: '#d36bff', l: '#efc4ff', b0: '#2a0f4a', b1: '#12061f' },
  wheel: { chip: 'DAILY SPIN', a: '#ffb347', l: '#ffe0b0', b0: '#2a1046', b1: '#0e0620' },
  win: { chip: 'WINNER', a: '#ffd34a', l: '#fff0b3', b0: '#3a2a06', b1: '#140d02' },
  pay: { chip: 'PAY', a: '#26c28f', l: '#9af0cf', b0: '#0d2a24', b1: '#06130f' },
}

type Hero = 'stars' | 'usdt' | 'bolts' | 'bolt1' | 'loop' | 'cards' | 'coins' | 'gift' | 'trophy' | 'wheel'

function starPath(x: any, cx: number, cy: number, r: number) {
  x.beginPath()
  for (let i = 0; i < 10; i++) {
    const an = -Math.PI / 2 + (i * Math.PI) / 5
    const rad = i % 2 ? r * 0.42 : r
    const px = cx + Math.cos(an) * rad
    const py = cy + Math.sin(an) * rad
    if (i) x.lineTo(px, py)
    else x.moveTo(px, py)
  }
  x.closePath()
}

function bolt(x: any, cx: number, cy: number, r: number, col: string) {
  x.beginPath()
  x.moveTo(cx + r * 0.2, cy - r * 0.7)
  x.lineTo(cx - r * 0.35, cy + r * 0.08)
  x.lineTo(cx - r * 0.02, cy + r * 0.08)
  x.lineTo(cx - r * 0.2, cy + r * 0.7)
  x.lineTo(cx + r * 0.38, cy - r * 0.1)
  x.lineTo(cx + r * 0.04, cy - r * 0.1)
  x.closePath()
  x.fillStyle = col
  x.fill()
}

function coin(x: any, cx: number, cy: number, r: number, c1: string, c2: string, glyph: (cx: number, cy: number, r: number) => void) {
  const g = x.createLinearGradient(cx, cy - r, cx, cy + r)
  g.addColorStop(0, c1)
  g.addColorStop(1, c2)
  x.beginPath()
  x.arc(cx, cy, r, 0, Math.PI * 2)
  x.fillStyle = g
  x.fill()
  x.lineWidth = r * 0.1
  x.strokeStyle = 'rgba(255,255,255,0.85)'
  x.stroke()
  glyph(cx, cy, r)
}

function tetherGlyph(x: any) {
  return (cx: number, cy: number, r: number) => {
    x.fillStyle = '#fff'
    x.fillRect(cx - r * 0.5, cy - r * 0.5, r, r * 0.22)
    x.fillRect(cx - r * 0.11, cy - r * 0.5, r * 0.22, r * 1.05)
    x.beginPath()
    x.ellipse(cx, cy + r * 0.02, r * 0.62, r * 0.18, 0, 0, Math.PI * 2)
    x.lineWidth = r * 0.08
    x.strokeStyle = '#fff'
    x.stroke()
  }
}

function drawHero(x: any, kind: Hero, cx: number, cy: number, count?: number) {
  if (kind === 'stars') {
    // one Boost = one star
    const single = count === 1
    ;(single ? [0] : [-60, 60]).forEach((dx) => {
      const g = x.createLinearGradient(0, cy - 50, 0, cy + 50)
      g.addColorStop(0, '#ffe27a')
      g.addColorStop(1, '#f5a30a')
      starPath(x, cx + dx, cy, single ? 68 : 56)
      x.fillStyle = g
      x.fill()
      x.lineWidth = 3
      x.strokeStyle = '#fff3b8'
      x.stroke()
    })
  } else if (kind === 'usdt') {
    coin(x, cx, cy, 58, '#3ad6a2', '#1c9a72', tetherGlyph(x))
  } else if (kind === 'bolts') {
    // one Boost = one coin
    const dxs = count === 1 ? [0] : [-60, 60]
    dxs.forEach((dx) => coin(x, cx + dx, cy, count === 1 ? 62 : 50, '#6d98ff', '#3a5fe0', (a, b, r) => bolt(x, a, b, r, '#fff')))
  } else if (kind === 'bolt1') {
    coin(x, cx, cy, 62, '#ff9be3', '#b13fd1', (a, b, r) => bolt(x, a, b, r, '#fff'))
  } else if (kind === 'loop') {
    x.lineWidth = 14
    x.lineCap = 'round'
    x.strokeStyle = '#5ee7ff'
    x.beginPath()
    x.arc(cx, cy, 56, Math.PI * 0.15, Math.PI * 0.95)
    x.stroke()
    x.beginPath()
    x.arc(cx, cy, 56, Math.PI * 1.15, Math.PI * 1.95)
    x.stroke()
    x.lineCap = 'butt'
    x.fillStyle = '#5ee7ff'
    // arrow heads at the end of each arc, pointing along the circle (clockwise)
    ;[Math.PI * 0.95, Math.PI * 1.95].forEach((th) => {
      const px = cx + 56 * Math.cos(th)
      const py = cy + 56 * Math.sin(th)
      const tx = -Math.sin(th)
      const ty = Math.cos(th)
      const nx = Math.cos(th)
      const ny = Math.sin(th)
      x.beginPath()
      x.moveTo(px + tx * 26, py + ty * 26)
      x.lineTo(px + nx * 23, py + ny * 23)
      x.lineTo(px - nx * 23, py - ny * 23)
      x.closePath()
      x.fill()
    })
    bolt(x, cx, cy, 44, '#ffd34a')
  } else if (kind === 'cards') {
    ;[[14, 0.18], [7, 0.18], [0, 0.35]].forEach(([o, al]) => {
      x.beginPath()
      x.roundRect(cx - 74 + o, cy - 44 - o * 0.6, 148, 92, 16)
      x.fillStyle = `rgba(255,159,67,${al})`
      x.fill()
      x.lineWidth = 3
      x.strokeStyle = '#ff9f43'
      x.stroke()
    })
    x.font = '800 56px InterX'
    x.fillStyle = '#fff'
    x.textAlign = 'center'
    x.fillText(`${count || ''}`, cx, cy + 20)
  } else if (kind === 'coins') {
    const stack = (px: number, base: number, n: number) => {
      for (let k = 0; k < n; k++) {
        const y = base - k * 14
        x.beginPath()
        x.ellipse(px, y, 40, 14, 0, 0, Math.PI * 2)
        const g = x.createLinearGradient(px - 40, 0, px + 40, 0)
        g.addColorStop(0, '#c98a0a')
        g.addColorStop(0.5, '#ffe27a')
        g.addColorStop(1, '#c98a0a')
        x.fillStyle = g
        x.fill()
        x.lineWidth = 2
        x.strokeStyle = '#7a4f00'
        x.stroke()
      }
    }
    stack(cx - 76, cy + 40, 3)
    stack(cx + 76, cy + 46, 4)
    stack(cx, cy + 56, 6)
  } else if (kind === 'wheel') {
    const cols = ['#2a3550', '#3f6df0', '#222c46', '#9b5cf6', '#2a3550', '#3f6df0', '#222c46', '#f5b301']
    x.beginPath()
    x.arc(cx, cy + 16, 76, 0, Math.PI * 2)
    x.fillStyle = '#ffd34a'
    x.fill()
    cols.forEach((c, i) => {
      x.beginPath()
      x.moveTo(cx, cy + 16)
      x.arc(cx, cy + 16, 68, (-90 + i * 45) * (Math.PI / 180), (-90 + (i + 1) * 45) * (Math.PI / 180))
      x.closePath()
      x.fillStyle = c
      x.fill()
      x.lineWidth = 2
      x.strokeStyle = '#0a1030'
      x.stroke()
    })
    x.beginPath()
    x.arc(cx, cy + 16, 14, 0, Math.PI * 2)
    x.fillStyle = '#ffd34a'
    x.fill()
    x.beginPath()
    x.moveTo(cx, cy - 44)
    x.lineTo(cx - 12, cy - 76)
    x.lineTo(cx + 12, cy - 76)
    x.closePath()
    x.fillStyle = '#ff5a6e'
    x.fill()
    x.lineWidth = 3
    x.strokeStyle = '#fff'
    x.stroke()
  } else if (kind === 'gift') {
    x.fillStyle = '#e48bff'
    x.beginPath()
    x.roundRect(cx - 56, cy - 14, 112, 72, 10)
    x.fill()
    x.fillStyle = '#c460f0'
    x.beginPath()
    x.roundRect(cx - 62, cy - 34, 124, 28, 10)
    x.fill()
    x.fillStyle = '#ffd34a'
    x.fillRect(cx - 9, cy - 34, 18, 92)
    x.lineWidth = 8
    x.strokeStyle = '#ffd34a'
    x.beginPath()
    x.ellipse(cx - 22, cy - 46, 22, 14, -0.4, 0, Math.PI * 2)
    x.stroke()
    x.beginPath()
    x.ellipse(cx + 22, cy - 46, 22, 14, 0.4, 0, Math.PI * 2)
    x.stroke()
  } else if (kind === 'trophy') {
    const g = x.createLinearGradient(0, cy - 50, 0, cy + 50)
    g.addColorStop(0, '#ffe27a')
    g.addColorStop(1, '#d99a0a')
    x.fillStyle = g
    x.beginPath()
    x.moveTo(cx - 44, cy - 52)
    x.lineTo(cx + 44, cy - 52)
    x.quadraticCurveTo(cx + 44, cy + 18, cx, cy + 22)
    x.quadraticCurveTo(cx - 44, cy + 18, cx - 44, cy - 52)
    x.fill()
    x.lineWidth = 8
    x.strokeStyle = '#ffd34a'
    x.beginPath()
    x.arc(cx - 48, cy - 28, 20, Math.PI * 0.5, Math.PI * 1.5)
    x.stroke()
    x.beginPath()
    x.arc(cx + 48, cy - 28, 20, Math.PI * 1.5, Math.PI * 2.5)
    x.stroke()
    x.fillStyle = g
    x.fillRect(cx - 9, cy + 20, 18, 22)
    x.fillRect(cx - 34, cy + 40, 68, 14)
    x.fillStyle = '#fff6c9'
    starPath(x, cx, cy - 18, 18)
    x.fill()
  }
}

type Card = {
  theme: string
  hero: Hero
  heroCount?: number
  title: string // name of the person (or a fixed title)
  sub: string // what happened
  big: string
  label: string
  foot: string
  chip?: string
}

const CW = 620
const CH = 500

/** The shared card: type tag on top, name, what happened, big icon and the number panel */
function renderCard(card: Card): Buffer {
  const { createCanvas } = loadCanvas()
  const S = 1.2 // 744 x 600 px, like the old images
  const canvas = createCanvas(Math.round(CW * S), Math.round(CH * S))
  const x = canvas.getContext('2d')
  x.scale(S, S)
  const t = THEMES[card.theme]
  const bg = x.createLinearGradient(0, 0, CW, CH)
  bg.addColorStop(0, t.b0)
  bg.addColorStop(1, t.b1)
  x.fillStyle = bg
  x.fillRect(0, 0, CW, CH)
  const glow = x.createRadialGradient(CW / 2, 250, 0, CW / 2, 250, 330)
  glow.addColorStop(0, `${t.a}55`)
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  x.fillStyle = glow
  x.fillRect(0, 0, CW, CH)
  // type tag
  const chip = card.chip || t.chip
  x.font = '800 18px InterX'
  x.letterSpacing = '3px'
  const cw = x.measureText(chip).width + 44
  x.beginPath()
  x.roundRect(CW / 2 - cw / 2, 26, cw, 40, 20)
  x.fillStyle = t.a
  x.fill()
  x.fillStyle = '#10131f'
  x.textAlign = 'center'
  x.fillText(chip, CW / 2 + 1, 52)
  x.letterSpacing = '0px'
  // name + what happened
  x.fillStyle = '#fff'
  x.font = '800 42px InterX'
  x.fillText(card.title, CW / 2, 128)
  x.fillStyle = t.l
  x.font = '700 22px InterB'
  x.fillText(card.sub, CW / 2, 162)
  drawHero(x, card.hero, CW / 2, 252, card.heroCount)
  // number panel
  x.beginPath()
  x.roundRect(28, 350, CW - 56, 124, 26)
  x.fillStyle = 'rgba(0,0,0,0.38)'
  x.fill()
  x.lineWidth = 3
  x.strokeStyle = t.a
  x.stroke()
  let size = 74
  x.font = `800 ${size}px InterX`
  while (x.measureText(card.big).width > 215 && size > 40) {
    size -= 4
    x.font = `800 ${size}px InterX`
  }
  x.fillStyle = '#fff'
  x.textAlign = 'left'
  x.fillText(card.big, 56, 433)
  const bw = x.measureText(card.big).width
  x.fillStyle = t.a
  x.font = '800 24px InterX'
  x.letterSpacing = '3px'
  x.fillText(card.label, 56 + bw + 18, 410)
  x.letterSpacing = '0px'
  x.fillStyle = 'rgba(255,255,255,0.85)'
  x.font = '700 21px InterB'
  let foot = card.foot
  while (x.measureText(foot).width > CW - 56 - (56 + bw + 18) - 20 && foot.length > 8) foot = `${foot.slice(0, -2)}…`
  x.fillText(foot, 56 + bw + 18, 444)
  return canvas.toBuffer('image/png')
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

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
  auto?: boolean
  usdt?: string
  added?: number // entries this boost added
}): Promise<Buffer> {
  const name = drawableName(info.name) || 'Someone'
  const boosts = info.boosts || 1
  if (info.winner) return renderWinnerCard({ name, entries: info.entries })
  const mult = info.mult && info.mult > 1 ? info.mult : 1
  const sub = info.auto ? 'was boosted automatically' : info.gift ? 'used a free gift Boost' : 'boosted a giveaway'
  return renderLaunchCard({
    name,
    boosts,
    sub,
    added: info.added && info.added > 0 ? Math.round(info.added) : 0,
    total: info.entries,
    auto: !!info.auto,
    mult,
  })
}

function wGold(x: any, x0: number, y0: number, x1: number, y1: number) {
  const gr = x.createLinearGradient(x0, y0, x1, y1)
  const stops: Array<[number, string]> = [[0, '#8a5a05'], [0.18, '#e9b53a'], [0.38, '#fff2b0'], [0.55, '#f3c24a'], [0.8, '#b8800f'], [1, '#e2a82e']]
  stops.forEach(st => gr.addColorStop(st[0], st[1]))
  return gr
}
function spaced(x: any, t: string, px: number, py: number, font: string, col: any, sp: number) {
  x.font = font
  x.fillStyle = col
  x.textAlign = 'left'
  let cx = px
  for (const ch of t.split('')) {
    x.fillText(ch, cx, py)
    cx += x.measureText(ch).width + sp
  }
}
function star5(x: any, cx: number, cy: number, R: number, r: number, col: string) {
  x.fillStyle = col
  x.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rad = i % 2 ? r : R
    x.lineTo(cx + rad * Math.cos(a), cy + rad * Math.sin(a))
  }
  x.closePath()
  x.fill()
}
function drawTrophy(x: any, cx: number, cy: number, s: number) {
  x.save()
  x.translate(cx, cy)
  x.scale(s, s)
  x.lineWidth = 20
  x.lineCap = 'round'
  x.strokeStyle = wGold(x, -200, -100, 200, 100)
  x.beginPath()
  x.moveTo(-108, -118)
  x.bezierCurveTo(-200, -130, -190, -10, -96, -6)
  x.stroke()
  x.beginPath()
  x.moveTo(108, -118)
  x.bezierCurveTo(200, -130, 190, -10, 96, -6)
  x.stroke()
  x.fillStyle = wGold(x, -120, -160, 120, 40)
  x.beginPath()
  x.moveTo(-122, -165)
  x.lineTo(122, -165)
  x.bezierCurveTo(126, -40, 80, 18, 18, 38)
  x.lineTo(-18, 38)
  x.bezierCurveTo(-80, 18, -126, -40, -122, -165)
  x.closePath()
  x.fill()
  x.fillStyle = wGold(x, -130, -180, 130, -150)
  rrect(x, -132, -182, 264, 26, 13)
  x.fill()
  const hg = x.createLinearGradient(-100, 0, -40, 0)
  hg.addColorStop(0, 'rgba(255,255,255,0)')
  hg.addColorStop(0.5, 'rgba(255,255,255,0.55)')
  hg.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = hg
  x.beginPath()
  x.moveTo(-96, -150)
  x.lineTo(-62, -150)
  x.bezierCurveTo(-64, -70, -46, -10, -10, 24)
  x.bezierCurveTo(-74, -6, -100, -70, -96, -150)
  x.closePath()
  x.fill()
  star5(x, 0, -85, 46, 19, 'rgba(120,70,0,0.55)')
  star5(x, 0, -87, 46, 19, 'rgba(255,248,210,0.8)')
  x.fillStyle = wGold(x, -30, 0, 30, 0)
  x.fillRect(-16, 36, 32, 52)
  x.beginPath()
  x.ellipse(0, 64, 30, 12, 0, 0, 7)
  x.fill()
  x.fillStyle = wGold(x, -80, 88, 80, 120)
  rrect(x, -72, 86, 144, 26, 8)
  x.fill()
  x.fillStyle = wGold(x, -100, 110, 100, 150)
  rrect(x, -96, 110, 192, 40, 10)
  x.fill()
  x.fillStyle = 'rgba(60,30,0,0.35)'
  x.fillRect(-96, 140, 192, 10)
  x.restore()
}

/** Feed image of a giveaway winner: award card with a gold trophy */
async function renderWinnerCard(info: { name: string; entries: number }): Promise<Buffer> {
  const { createCanvas } = loadCanvas()
  const H = 720
  const canvas = createCanvas(1280, H)
  const x = canvas.getContext('2d')
  x.textBaseline = 'alphabetic'
  x.fillStyle = '#070914'
  x.fillRect(0, 0, 1280, H)
  const glow = (cx: number, cy: number, r: number, col: string) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, col)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = g
    x.fillRect(0, 0, 1280, H)
  }
  glow(640, 60, 900, 'rgba(255,190,70,0.20)')
  glow(1180, 700, 600, 'rgba(70,90,255,0.25)')
  glow(100, 700, 500, 'rgba(120,70,255,0.18)')
  const rnd = rand(5)
  for (let i = 0; i < 70; i++) {
    const px = rnd() * 1280
    const py = rnd() * H
    const z = rnd()
    x.fillStyle = `rgba(255,215,120,${0.15 + z * 0.7})`
    x.beginPath()
    x.arc(px, py, 0.8 + z * 2.4, 0, 7)
    x.fill()
  }
  x.fillStyle = '#0e1226'
  rrect(x, 100, 90, 1080, 540, 40)
  x.fill()
  const ig = x.createLinearGradient(0, 90, 0, 630)
  ig.addColorStop(0, 'rgba(255,255,255,0.06)')
  ig.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = ig
  rrect(x, 100, 90, 1080, 540, 40)
  x.fill()
  x.lineWidth = 3
  x.strokeStyle = wGold(x, 100, 90, 1180, 630)
  rrect(x, 100, 90, 1080, 540, 40)
  x.stroke()
  x.save()
  rrect(x, 100, 90, 1080, 540, 40)
  x.clip()
  const tg = x.createRadialGradient(320, 370, 10, 320, 370, 260)
  tg.addColorStop(0, 'rgba(255,200,80,0.3)')
  tg.addColorStop(1, 'rgba(255,200,80,0)')
  x.fillStyle = tg
  x.fillRect(60, 100, 520, 520)
  x.restore()
  drawTrophy(x, 320, 365, 1.02)
  spaced(x, 'WINNER', 560, 205, '26px InterX', '#e9b53a', 10)
  x.fillStyle = wGold(x, 560, 0, 760, 0)
  x.fillRect(560, 225, 70, 4)
  let size = 78
  x.font = `${size}px InterX`
  while (size > 40 && x.measureText(info.name).width > 580) {
    size -= 4
    x.font = `${size}px InterX`
  }
  txt(x, info.name, 560, 320, `${size}px InterX`, '#ffffff', 'left')
  txt(x, 'won a giveaway', 560, 372, '32px InterB', '#9aa6cf', 'left')
  x.fillStyle = 'rgba(255,255,255,0.1)'
  x.fillRect(560, 420, 560, 2)
  const num = `${Math.round(info.entries)}`
  x.font = '110px InterX'
  const nw = x.measureText(num).width
  txt(x, num, 560, 540, '110px InterX', wGold(x, 560, 440, 760, 540) as any, 'left')
  spaced(x, info.entries === 1 ? 'ENTRY' : 'ENTRIES', 560 + nw + 28, 540, '26px InterX', '#9aa6cf', 5)
  return canvas.toBuffer('image/png')
}

type Tier = { label: string; glow: string; col: string; rk: number[][]; fx: number; gold: boolean }
function tierOf(n: number): Tier {
  if (n >= 25) return { label: 'ULTRA BOOST x25', glow: 'rgba(255,200,80,0.7)', col: '#ffd23c', rk: [[1010, 320, 1.2]], fx: 2, gold: true }
  if (n >= 10)
    return { label: 'MEGA BOOST x10', glow: 'rgba(255,190,60,0.6)', col: '#ffc83c', rk: [[850, 360, 0.5], [1020, 270, 1.0], [1200, 360, 0.5]], fx: 1, gold: true }
  if (n >= 5)
    return {
      label: 'POWER BOOST x5',
      glow: 'rgba(255,70,140,0.55)',
      col: '#ff6ab0',
      rk: [[800, 370, 0.5], [890, 330, 0.65], [1000, 280, 0.8], [1110, 330, 0.65], [1200, 370, 0.5]],
      fx: 0,
      gold: false,
    }
  if (n >= 3)
    return { label: 'TRIPLE BOOST', glow: 'rgba(255,100,70,0.55)', col: '#ff8a60', rk: [[800, 330, 0.7], [960, 290, 0.8], [1120, 330, 0.7]], fx: 0, gold: false }
  if (n === 2) return { label: 'DOUBLE BOOST', glow: 'rgba(255,120,40,0.55)', col: '#ff9a50', rk: [[900, 300, 0.85], [1070, 330, 0.85]], fx: 0, gold: false }
  return { label: 'BOOSTED', glow: 'rgba(255,120,40,0.5)', col: '#ff9a50', rk: [[980, 300, 1.0]], fx: 0, gold: false }
}

function rand(seed: number) {
  let r = seed
  return () => {
    r = (r * 9301 + 49297) % 233280
    return r / 233280
  }
}

function drawRocket(x: any, cx: number, cy: number, s: number, body: string, accent: string, flame: string) {
  x.save()
  x.translate(cx, cy)
  x.scale(s, s)
  const fg = x.createLinearGradient(0, 130, 0, 330)
  fg.addColorStop(0, flame)
  fg.addColorStop(0.5, '#ff8a1f')
  fg.addColorStop(1, 'rgba(255,80,40,0)')
  x.fillStyle = fg
  x.beginPath()
  x.moveTo(-42, 130)
  x.quadraticCurveTo(0, 380, 42, 130)
  x.fill()
  x.fillStyle = 'rgba(255,245,200,0.95)'
  x.beginPath()
  x.moveTo(-20, 130)
  x.quadraticCurveTo(0, 250, 20, 130)
  x.fill()
  x.fillStyle = accent
  x.beginPath()
  x.moveTo(-70, 40)
  x.lineTo(-125, 160)
  x.lineTo(-70, 130)
  x.fill()
  x.beginPath()
  x.moveTo(70, 40)
  x.lineTo(125, 160)
  x.lineTo(70, 130)
  x.fill()
  const bg = x.createLinearGradient(-80, 0, 80, 0)
  bg.addColorStop(0, '#c9d2ea')
  bg.addColorStop(0.45, body)
  bg.addColorStop(1, '#aab6d6')
  x.fillStyle = bg
  x.beginPath()
  x.moveTo(0, -200)
  x.quadraticCurveTo(95, -70, 72, 135)
  x.lineTo(-72, 135)
  x.quadraticCurveTo(-95, -70, 0, -200)
  x.fill()
  x.fillStyle = accent
  x.beginPath()
  x.moveTo(0, -200)
  x.quadraticCurveTo(45, -160, 58, -105)
  x.lineTo(-58, -105)
  x.quadraticCurveTo(-45, -160, 0, -200)
  x.fill()
  x.fillStyle = '#1d2b55'
  x.beginPath()
  x.arc(0, -25, 36, 0, 7)
  x.fill()
  x.fillStyle = '#6fb6ff'
  x.beginPath()
  x.arc(0, -25, 28, 0, 7)
  x.fill()
  x.fillStyle = 'rgba(255,255,255,0.5)'
  x.beginPath()
  x.arc(-9, -35, 9, 0, 7)
  x.fill()
  x.fillStyle = accent
  x.fillRect(-72, 95, 144, 16)
  x.restore()
}

/** Feed image of a boost: rocket formation that grows with the number of Boosts used */
async function renderLaunchCard(info: {
  name: string
  boosts: number
  sub: string
  added: number
  total: number
  auto: boolean
  mult: number
}): Promise<Buffer> {
  const { createCanvas } = loadCanvas()
  const H = 720
  const canvas = createCanvas(1280, H)
  const x = canvas.getContext('2d')
  x.textBaseline = 'alphabetic'
  const t = tierOf(info.boosts)
  x.fillStyle = '#0a0e22'
  x.fillRect(0, 0, 1280, H)
  const glow = (cx: number, cy: number, r: number, col: string) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, col)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = g
    x.fillRect(0, 0, 1280, H)
  }
  glow(960, 720, 800, t.glow)
  glow(200, 100, 500, 'rgba(60,90,255,0.25)')
  const rnd = rand(3)
  for (let i = 0; i < 60; i++) {
    const px = rnd() * 1280
    const py = rnd() * H
    const sz = 1 + rnd() * 3
    x.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.6})`
    x.beginPath()
    x.arc(px, py, sz, 0, 7)
    x.fill()
  }
  if (t.fx === 2) {
    const n = 28
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * Math.PI) / n
      const b = a + (Math.PI / n) * 0.5
      x.fillStyle = 'rgba(255,210,90,0.09)'
      x.beginPath()
      x.moveTo(1010, 330)
      x.lineTo(1010 + 900 * Math.cos(a), 330 + 900 * Math.sin(a))
      x.lineTo(1010 + 900 * Math.cos(b), 330 + 900 * Math.sin(b))
      x.closePath()
      x.fill()
    }
  }
  if (t.fx > 0) {
    const sr = rand(info.boosts * 7)
    const n = t.fx === 2 ? 26 : 14
    for (let i = 0; i < n; i++) {
      const px = 620 + sr() * 660
      const py = sr() * H
      x.fillStyle = 'rgba(255,225,140,0.85)'
      x.beginPath()
      x.moveTo(px, py - 12)
      x.lineTo(px + 4, py - 4)
      x.lineTo(px + 12, py)
      x.lineTo(px + 4, py + 4)
      x.lineTo(px, py + 12)
      x.lineTo(px - 4, py + 4)
      x.lineTo(px - 12, py)
      x.lineTo(px - 4, py - 4)
      x.closePath()
      x.fill()
    }
  }
  txt(x, `${t.label}${info.auto ? '  -  AUTO' : ''}`, 90, 120, '28px InterX', t.col, 'left')
  txt(x, info.name, 90, 215, '70px InterX', '#ffffff', 'left')
  txt(x, info.sub, 90, 265, '32px InterB', '#a9b4e6', 'left')
  const gold = x.createLinearGradient(90, 0, 520, 0)
  gold.addColorStop(0, '#fff1b0')
  gold.addColorStop(0.5, '#ffc83c')
  gold.addColorStop(1, '#ff9a1f')
  const big = info.added > 0 ? `+${info.added}` : `${info.total}`
  txt(x, big, 90, 500, `${big.length > 3 ? 180 : 220}px InterX`, gold as any, 'left')
  const foot =
    info.added > 0
      ? `entries  ·  ${info.total} now${info.mult > 1 ? `  ·  x${+info.mult.toFixed(2)} today` : ''}`
      : `entries now${info.mult > 1 ? `  ·  x${+info.mult.toFixed(2)} today` : ''}`
  txt(x, foot, 90, 580, '38px InterB', '#a9b4e6', 'left')
  t.rk.forEach(r => drawRocket(x, r[0], r[1], r[2], '#eef1fb', t.gold ? '#d9a53a' : '#ff4a3d', t.gold ? '#ffe27a' : '#ffd23c'))
  return canvas.toBuffer('image/png')
}

/** Payment details image of the USDT order (amount to send) */
export async function renderUsdtImage(info: { amount: string; pct: string; network?: string }): Promise<Buffer> {
  return renderCard({
    theme: 'pay',
    hero: 'usdt',
    title: 'Payment details',
    sub: 'Send exactly',
    big: plain(info.amount),
    label: 'USDT',
    foot: `${plain(info.pct)}${info.network ? ` · ${plain(info.network)}` : ''}`,
  })
}

/** Pack of Boosts bought (credits + optional free bonus) */
export async function renderRechargeImage(info: {
  name: string
  credits: number // pack bought
  bonus?: number // free credits on top
  paid?: string // unused (kept for callers)
}): Promise<Buffer> {
  const bonus = info.bonus || 0
  const total = Math.max(1, Math.round(info.credits + bonus))
  const name = drawableName(info.name) || 'Someone'
  const { createCanvas } = loadCanvas()
  const H = 720
  const canvas = createCanvas(1280, H)
  const x = canvas.getContext('2d')
  x.textBaseline = 'alphabetic'
  x.fillStyle = '#12082e'
  x.fillRect(0, 0, 1280, H)
  const glow = (cx: number, cy: number, r: number, col: string) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, col)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = g
    x.fillRect(0, 0, 1280, H)
  }
  glow(200, 100, 700, 'rgba(255,90,170,0.35)')
  glow(1100, 650, 800, 'rgba(70,90,255,0.45)')
  x.globalAlpha = 0.08
  bolt(x, 990, 360, 540, '#ffffff')
  x.globalAlpha = 1
  pillBox(x, 90, 80, 300, 52, 'rgba(255,255,255,0.12)', 'BOOSTS PURCHASE', '#ffffff', '22px InterX')
  const letter = (name.replace(/[^A-Za-z0-9]/g, '')[0] || '?').toUpperCase()
  const av = x.createLinearGradient(100, 190, 200, 290)
  av.addColorStop(0, '#ff5aa8')
  av.addColorStop(1, '#6a5cff')
  x.fillStyle = av
  x.beginPath()
  x.arc(150, 240, 50, 0, Math.PI * 2)
  x.fill()
  txt(x, letter, 150, 258, '50px InterX', '#ffffff')
  txt(x, name, 230, 235, '60px InterX', '#ffffff', 'left')
  txt(x, 'bought Boosts', 230, 282, '32px InterB', '#d9c8ff', 'left')
  const gold = x.createLinearGradient(90, 0, 500, 0)
  gold.addColorStop(0, '#fff1b0')
  gold.addColorStop(0.5, '#ffc83c')
  gold.addColorStop(1, '#ff9a1f')
  const big = `+${total}`
  x.font = '230px InterX'
  const bw = x.measureText(big).width
  txt(x, big, 90, 540, '230px InterX', gold as any, 'left')
  const rx = 90 + bw + 40
  txt(x, total === 1 ? 'BOOST' : 'BOOSTS', rx, 540, '60px InterX', '#ffffff', 'left')
  if (bonus > 0) pillBox(x, rx, 400, 250, 60, 'rgba(255,210,60,0.2)', `+${bonus} FREE`, '#ffd23c', '28px InterX')
  return canvas.toBuffer('image/png')
}

/** Daily spin prize (public feed) */
export async function renderWheelImage(info: { name: string; prize: number; streak: number }): Promise<Buffer> {
  return renderCard({
    theme: 'wheel',
    hero: 'wheel',
    title: drawableName(info.name) || 'Someone',
    sub: 'won on the daily spin',
    big: `+${info.prize}`,
    label: info.prize === 1 ? 'FREE BOOST' : 'FREE BOOSTS',
    foot: `${plural(info.streak, 'day', 'days')} streak`,
  })
}

/** Gift code claimed */
export async function renderCodeImage(info: { name: string; credits: number; left: number }): Promise<Buffer> {
  return renderCard({
    theme: 'code',
    hero: 'gift',
    title: drawableName(info.name) || 'Someone',
    sub: 'claimed a gift code',
    big: `+${info.credits}`,
    label: info.credits === 1 ? 'FREE BOOST' : 'FREE BOOSTS',
    foot: info.left >= 0 ? `${plural(info.left, 'code', 'codes')} left` : 'Gift code',
  })
}

/** Boost All: the same boosts in several giveaways at once */
export async function renderMultiImage(info: {
  name: string
  giveaways: number
  boosts: number
  per: number
  method: string
}): Promise<Buffer> {
  const how = info.method === 'credits' ? 'Boosts' : info.method === 'usdt' ? 'USDT' : 'Stars'
  return renderCard({
    theme: 'multi',
    hero: 'cards',
    heroCount: info.giveaways,
    title: drawableName(info.name) || 'Someone',
    sub: `boosted ${plural(info.giveaways, 'giveaway', 'giveaways')}`,
    big: `${info.boosts}`,
    label: info.boosts === 1 ? 'BOOST USED' : 'BOOSTS USED',
    foot: `${info.per} in each · paid with ${how}`,
  })
}

/** Buy Boosts screen: one card per pack, with the free bonus and the promo banner only when a bonus is active */
export async function renderBuyImage(info: {
  packs: { n: number; bonus: number; stars: number; usdt?: string; popular?: boolean }[]
  perBoost: string // "+20 entries"
  promo?: string // banner text, empty = no banner
}): Promise<Buffer> {
  const { createCanvas } = loadCanvas()
  const W = 1280
  const hasUsdt = info.packs.some((p) => !!p.usdt)
  const cardW = 380
  const cardH = hasUsdt || info.packs.some((p) => p.stars > 0) ? 330 : 290
  const gap = 25
  const rows = Math.ceil(info.packs.length / 3)
  const top = info.promo ? 320 : 240
  const H = top + rows * (cardH + gap) + 40
  const canvas = createCanvas(W, H)
  const x = canvas.getContext('2d')
  const bg = x.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#0b1020')
  bg.addColorStop(1, '#1b1240')
  x.fillStyle = bg
  x.fillRect(0, 0, W, H)
  const glow = x.createRadialGradient(640, 120, 20, 640, 120, 600)
  glow.addColorStop(0, 'rgba(255,170,50,0.22)')
  glow.addColorStop(1, 'rgba(255,170,50,0)')
  x.fillStyle = glow
  x.fillRect(0, 0, W, H)
  const rr = (px: number, py: number, w: number, h: number, r: number) => {
    x.beginPath()
    x.moveTo(px + r, py)
    x.arcTo(px + w, py, px + w, py + h, r)
    x.arcTo(px + w, py + h, px, py + h, r)
    x.arcTo(px, py + h, px, py, r)
    x.arcTo(px, py, px + w, py, r)
    x.closePath()
  }
  x.textAlign = 'center'
  x.textBaseline = 'alphabetic'
  bolt(x, 430, 85, 50, '#ffd23c')
  x.fillStyle = '#fff'
  x.font = '70px InterX'
  x.fillText('Buy Boosts', 660, 115)
  x.fillStyle = '#b8c4ee'
  x.font = '32px InterB'
  x.fillText(`Each Boost = ${plain(info.perBoost)}  ·  they never expire`, 640, 170)
  if (info.promo) {
    x.fillStyle = '#ff3d5a'
    rr(150, 205, 980, 64, 32)
    x.fill()
    x.fillStyle = '#fff'
    x.font = '30px InterX'
    x.fillText(plain(info.promo).toUpperCase(), 640, 247)
  }
  info.packs.forEach((p, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    // last row centred when it is not full
    const inRow = Math.min(3, info.packs.length - row * 3)
    const offset = (3 - inRow) * ((cardW + gap) / 2)
    const px = 50 + col * (cardW + gap) + offset
    const py = top + row * (cardH + gap)
    x.fillStyle = 'rgba(255,255,255,0.08)'
    rr(px, py, cardW, cardH, 30)
    x.fill()
    x.strokeStyle = p.popular ? '#ffd23c' : 'rgba(255,255,255,0.14)'
    x.lineWidth = p.popular ? 4 : 2
    x.stroke()
    if (p.popular) {
      x.fillStyle = '#ffd23c'
      rr(px + 90, py - 18, 200, 38, 19)
      x.fill()
      x.fillStyle = '#2a1a00'
      x.font = '20px InterX'
      x.fillText('MOST POPULAR', px + cardW / 2, py + 8)
    }
    x.fillStyle = '#fff'
    x.font = '96px InterX'
    x.fillText(`${p.n}`, px + cardW / 2, py + 120)
    x.fillStyle = '#b8c4ee'
    x.font = '28px InterB'
    x.fillText(p.n === 1 ? 'Boost' : 'Boosts', px + cardW / 2, py + 158)
    let y = py + 200
    if (p.bonus > 0) {
      x.fillStyle = 'rgba(255,210,60,0.18)'
      rr(px + 80, py + 178, 220, 46, 23)
      x.fill()
      x.fillStyle = '#ffd23c'
      x.font = '28px InterX'
      x.fillText(`+${p.bonus} FREE`, px + cardW / 2, py + 210)
      y = py + 275
    } else {
      y = py + 230
    }
    x.fillStyle = '#fff'
    x.font = '34px InterX'
    if (p.stars > 0) {
      const label = `${p.stars}`
      const tw = x.measureText(label).width
      x.fillText(label, px + cardW / 2 - 18, y)
      starPath(x, px + cardW / 2 - 18 + tw / 2 + 22, y - 11, 14)
      x.fillStyle = '#ffc43c'
      x.fill()
      if (p.usdt) {
        x.fillStyle = '#9fa8d6'
        x.font = '24px InterB'
        x.fillText(`or $${p.usdt} USDT`, px + cardW / 2, y + 37)
      }
    } else if (p.usdt) {
      x.fillStyle = '#26c28f'
      x.font = '44px InterX'
      x.fillText(`$${p.usdt}`, px + cardW / 2, y + 6)
      x.fillStyle = '#9fa8d6'
      x.font = '24px InterB'
      x.fillText('USDT', px + cardW / 2, y + 37)
    }
  })
  return canvas.toBuffer('image/png')
}

// ---------- Photo screens (information in the picture, actions in the buttons) ----------

function scene(H: number, glow: string) {
  const { createCanvas } = loadCanvas()
  const canvas = createCanvas(1280, H)
  const x = canvas.getContext('2d')
  const bg = x.createLinearGradient(0, 0, 1280, H)
  bg.addColorStop(0, '#0b1020')
  bg.addColorStop(1, '#1b1240')
  x.fillStyle = bg
  x.fillRect(0, 0, 1280, H)
  const g = x.createRadialGradient(640, 120, 20, 640, 120, 620)
  g.addColorStop(0, glow)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 1280, H)
  x.textBaseline = 'alphabetic'
  return { canvas, x }
}

function rrect(x: any, px: number, py: number, w: number, h: number, r: number) {
  x.beginPath()
  x.moveTo(px + r, py)
  x.arcTo(px + w, py, px + w, py + h, r)
  x.arcTo(px + w, py + h, px, py + h, r)
  x.arcTo(px, py + h, px, py, r)
  x.arcTo(px, py, px + w, py, r)
  x.closePath()
}

function txt(x: any, t: string, px: number, py: number, font: string, col: string, align = 'center') {
  x.textAlign = align
  x.font = font
  x.fillStyle = col
  x.fillText(t, px, py)
}

function panel(x: any, px: number, py: number, w: number, h: number, stroke?: string) {
  x.fillStyle = 'rgba(255,255,255,0.08)'
  rrect(x, px, py, w, h, 28)
  x.fill()
  x.strokeStyle = stroke || 'rgba(255,255,255,0.14)'
  x.lineWidth = stroke ? 4 : 2
  x.stroke()
}

function pillBox(x: any, px: number, py: number, w: number, h: number, fill: string, t: string, col: string, font: string) {
  x.fillStyle = fill
  rrect(x, px, py, w, h, h / 2)
  x.fill()
  txt(x, t, px + w / 2, py + h * 0.68, font, col)
}

function barBox(x: any, px: number, py: number, w: number, h: number, frac: number, c0: string, c1: string) {
  x.fillStyle = 'rgba(255,255,255,0.1)'
  rrect(x, px, py, w, h, h / 2)
  x.fill()
  const g = x.createLinearGradient(px, 0, px + w, 0)
  g.addColorStop(0, c0)
  g.addColorStop(1, c1)
  x.fillStyle = g
  rrect(x, px, py, Math.max(h, w * Math.max(0, Math.min(1, frac))), h, h / 2)
  x.fill()
}

function loopArrows(x: any, cx: number, cy: number, r: number, col: string, lw: number) {
  x.strokeStyle = col
  x.lineWidth = lw
  x.lineCap = 'round'
  for (const a of [0.35, Math.PI + 0.35]) {
    x.beginPath()
    x.arc(cx, cy, r, a, a + Math.PI - 0.7)
    x.stroke()
    const e = a + Math.PI - 0.7
    const px = cx + r * Math.cos(e)
    const py = cy + r * Math.sin(e)
    const t = e + Math.PI / 2
    const k = lw * 1.9
    x.fillStyle = col
    x.beginPath()
    x.moveTo(px + k * Math.cos(t), py + k * Math.sin(t))
    x.lineTo(px + k * 0.73 * Math.cos(t + 2.3), py + k * 0.73 * Math.sin(t + 2.3))
    x.lineTo(px + k * 0.73 * Math.cos(t - 2.3), py + k * 0.73 * Math.sin(t - 2.3))
    x.closePath()
    x.fill()
  }
}

/** Boost menu of one giveaway: packs with the chance after each, progress and balance */
export async function renderOptionsImage(info: {
  giveaway?: string
  banner?: string // e.g. "x2 Boost day"
  chanceNow?: string
  options: { n: number; entries: string; usdt?: string; stars?: number; useBalance?: boolean; chance?: string }[]
  used: number
  max: number
  credits: number
}): Promise<Buffer> {
  const rows = Math.max(1, Math.ceil(info.options.length / 3))
  const hasTop = !!info.chanceNow
  const bannerH = info.banner ? 80 : 0
  const topH = hasTop ? 190 : 0
  const H = 215 + bannerH + topH + rows * 345 + 270 + 40
  const { canvas, x } = scene(H, 'rgba(255,170,50,0.22)')
  bolt(x, 300, 85, 50, '#ffd23c')
  txt(x, 'Boost this giveaway', 700, 115, '66px InterX', '#fff')
  if (info.giveaway) txt(x, plain(info.giveaway), 640, 170, '32px InterB', '#b8c4ee')
  let y = 215
  if (info.banner) {
    pillBox(x, 300, y, 680, 56, '#ff3d5a', plain(info.banner).toUpperCase(), '#fff', '28px InterX')
    y += bannerH
  }
  if (hasTop) {
    panel(x, 90, y, 1100, 170)
    txt(x, 'YOUR CHANCE TO WIN', 640, y + 47, '24px InterB', '#9fa8d6')
    txt(x, plain(info.chanceNow), 640, y + 135, '88px InterX', '#ffd23c')
    y += topH
  }
  const best = info.options.length > 2 ? 1 : -1
  info.options.forEach((o, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const inRow = Math.min(3, info.options.length - row * 3)
    const off = (3 - inRow) * 202
    const px = 60 + col * 405 + off
    const py = y + 30 + row * 345
    panel(x, px, py, 380, 315, i === best ? '#ffd23c' : undefined)
    if (i === best) pillBox(x, px + 90, py - 18, 200, 38, '#ffd23c', 'BEST VALUE', '#2a1a00', '20px InterX')
    txt(x, `${o.n}`, px + 190, py + 115, '104px InterX', '#fff')
    txt(x, o.n === 1 ? 'Boost' : 'Boosts', px + 190, py + 153, '28px InterB', '#b8c4ee')
    pillBox(x, px + 50, py + 172, 280, 46, 'rgba(255,210,60,0.18)', plain(o.entries), '#ffd23c', '26px InterX')
    if (o.useBalance) {
      txt(x, 'Use your balance', px + 190, py + 268, '34px InterX', '#3ddc84')
    } else if (o.usdt) {
      txt(x, `$${o.usdt} USDT`, px + 190, py + 268, '38px InterX', '#26c28f')
    } else if (o.stars) {
      txt(x, `${o.stars} Stars`, px + 190, py + 268, '38px InterX', '#ffc43c')
    }
    if (o.chance) txt(x, `chance ${plain(o.chance)}`, px + 190, py + 300, '22px InterB', '#9fa8d6')
  })
  y += 30 + rows * 345
  panel(x, 60, y, 1160, 110)
  txt(x, 'Boosted so far', 100, y + 68, '28px InterB', '#b8c4ee', 'left')
  barBox(x, 400, y + 40, 500, 26, info.max > 0 ? info.used / info.max : 0, '#ffb020', '#ff6a3d')
  txt(x, `${info.used} / ${info.max}`, 1180, y + 75, '40px InterX', '#ffd23c', 'right')
  y += 135
  panel(x, 60, y, 1160, 110)
  txt(x, 'Your Boosts', 100, y + 68, '28px InterB', '#b8c4ee', 'left')
  txt(x, `${info.credits}`, 1180, y + 77, '48px InterX', '#ffd23c', 'right')
  return canvas.toBuffer('image/png')
}

/** Auto-Boost menu: state, Boosts per giveaway, limit and progress to the next free Boost */
export async function renderAutoImage(info: {
  n: number // Boosts per giveaway, 0 = off
  credits: number
  limit: number
  giveaways: number
  streak: number
  every: number
  people?: string
}): Promise<Buffer> {
  const { canvas, x } = scene(1010, 'rgba(0,214,170,0.28)')
  loopArrows(x, 640, 150, 66, '#00e6b4', 11)
  bolt(x, 640, 150, 38, '#ffd23c')
  txt(x, 'Auto-Boost', 640, 290, '72px InterX', '#fff')
  if (info.n > 0) pillBox(x, 440, 315, 400, 56, 'rgba(0,230,180,0.2)', `ON  -  ${info.n} per giveaway`, '#00e6b4', '30px InterX')
  else pillBox(x, 490, 315, 300, 56, 'rgba(255,255,255,0.1)', 'OFF', '#9fa8d6', '32px InterX')
  panel(x, 90, 410, 540, 150)
  txt(x, 'GIVEAWAYS BOOSTED', 360, 455, '22px InterB', '#9fa8d6')
  txt(x, `${info.giveaways}`, 360, 530, '80px InterX', '#fff')
  panel(x, 650, 410, 540, 150)
  txt(x, 'DAILY LIMIT', 920, 455, '22px InterB', '#9fa8d6')
  txt(x, `${info.limit} Boosts`, 920, 530, '64px InterX', '#fff')
  panel(x, 90, 590, 1100, 170)
  txt(x, 'NEXT FREE BOOST', 130, 640, '24px InterB', '#9fa8d6', 'left')
  txt(x, `${info.streak} / ${info.every} giveaways`, 1150, 640, '28px InterX', '#ffd23c', 'right')
  barBox(x, 130, 670, 1020, 34, info.every > 0 ? info.streak / info.every : 0, '#00e6b4', '#ffd23c')
  txt(x, `Your Boosts: ${info.credits}`, 640, 740, '28px InterB', '#b8c4ee')
  txt(x, 'Choose how many Boosts we add to each giveaway you join', 640, 830, '28px InterB', '#8c97c4')
  if (info.people) txt(x, plain(info.people), 640, 880, '26px InterB', '#00e6b4')
  return canvas.toBuffer('image/png')
}

/** Invite screen: what the friends did and what you earned */
export async function renderInviteImage(info: {
  pct: number
  invited: number
  buyers: number
  earned: number
  link: string
}): Promise<Buffer> {
  const { canvas, x } = scene(960, 'rgba(255,170,50,0.2)')
  txt(x, `Invite & earn ${info.pct}%`, 640, 125, '72px InterX', '#fff')
  txt(x, `${info.pct}% of every Boost your friends buy, for life`, 640, 180, '32px InterB', '#b8c4ee')
  const stats: [string, string][] = [
    ['JOINED', `${info.invited}`],
    ['BOUGHT', `${info.buyers}`],
    ['EARNED', `${info.earned}`],
  ]
  stats.forEach((s, i) => {
    const px = 60 + i * 405
    panel(x, px, 240, 380, 200)
    txt(x, s[0], px + 190, 292, '24px InterB', '#9fa8d6')
    txt(x, s[1], px + 190, 392, '96px InterX', i === 2 ? '#ffd23c' : '#fff')
    if (i === 2) txt(x, 'Boosts', px + 190, 425, '24px InterB', '#9fa8d6')
  })
  panel(x, 60, 480, 1160, 160)
  txt(x, 'YOUR LINK', 100, 530, '22px InterB', '#9fa8d6', 'left')
  x.fillStyle = 'rgba(0,0,0,0.3)'
  rrect(x, 100, 552, 1080, 64, 16)
  x.fill()
  txt(x, plain(info.link), 640, 596, '30px InterB', '#fff')
  panel(x, 60, 670, 1160, 130, '#ffd23c')
  txt(x, 'Your friend gets +1 FREE Boost', 640, 735, '40px InterX', '#ffd23c')
  txt(x, 'when they buy and turn on Auto-Boost', 640, 777, '26px InterB', '#b8c4ee')
  txt(x, 'Paid in Boosts that never expire', 640, 860, '28px InterB', '#8c97c4')
  return canvas.toBuffer('image/png')
}

/** Boost all giveaways: the giveaways, the chance in each and the total to pay */
export async function renderMultiPayImage(info: {
  rows: { name: string; now?: string; after?: string }[]
  more: number
  n: number
  k: number
  total: number
  usdt?: string
  stars?: number
  useBalance: boolean
  topUp?: boolean
  credits: number
}): Promise<Buffer> {
  const rows = info.rows.length
  const H = 250 + rows * 130 + 20 + 215 + 125 + 60
  const { canvas, x } = scene(H, 'rgba(255,150,60,0.25)')
  bolt(x, 250, 85, 50, '#ffd23c')
  txt(x, 'Boost all giveaways', 700, 115, '66px InterX', '#fff')
  txt(x, 'Same Boosts in every giveaway you joined', 640, 170, '30px InterB', '#b8c4ee')
  info.rows.forEach((r, i) => {
    const y = 215 + i * 130
    panel(x, 60, y, 1160, 110)
    txt(x, plain(r.name) || 'Giveaway', 100, y + 68, '32px InterX', '#fff', 'left')
    if (r.now && r.after) {
      txt(x, plain(r.now), 860, y + 68, '32px InterB', '#9fa8d6', 'right')
      txt(x, '>', 900, y + 68, '34px InterX', '#ffd23c')
      txt(x, plain(r.after), 1180, y + 70, '44px InterX', '#ffd23c', 'right')
    }
  })
  let y = 215 + rows * 130
  if (info.more > 0) {
    txt(x, `+ ${info.more} more`, 640, y + 35, '26px InterB', '#9fa8d6')
    y += 50
  }
  panel(x, 60, y + 10, 1160, 215, '#ffd23c')
  txt(x, `${info.n} ${info.n === 1 ? 'Boost' : 'Boosts'} in each`, 640, y + 80, '44px InterX', '#fff')
  txt(x, `${info.k} giveaways x ${info.n} = ${info.total} ${info.total === 1 ? 'Boost' : 'Boosts'}`, 640, y + 125, '28px InterB', '#b8c4ee')
  if (info.useBalance) txt(x, 'Paid with your Boosts', 640, y + 195, '54px InterX', '#3ddc84')
  else if (info.topUp) txt(x, 'Top up Boosts first', 640, y + 195, '54px InterX', '#ffb020')
  else if (info.usdt) txt(x, `$${info.usdt} USDT`, 640, y + 195, '60px InterX', '#26c28f')
  else if (info.stars) txt(x, `${info.stars} Stars`, 640, y + 195, '60px InterX', '#ffc43c')
  panel(x, 60, y + 245, 1160, 100)
  txt(x, 'Your Boosts', 100, y + 307, '28px InterB', '#b8c4ee', 'left')
  txt(x, `${info.credits}`, 1180, y + 313, '48px InterX', '#ffd23c', 'right')
  return canvas.toBuffer('image/png')
}

/** Boost menu of a giveaway for someone without Boosts: top up first */
export async function renderNeedBoostsImage(info: { credits: number }): Promise<Buffer> {
  const { createCanvas } = loadCanvas()
  const H = 900
  const canvas = createCanvas(1280, H)
  const x = canvas.getContext('2d')
  x.textBaseline = 'alphabetic'
  x.fillStyle = '#12082e'
  x.fillRect(0, 0, 1280, H)
  const glow = (cx: number, cy: number, r: number, col: string) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, col)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = g
    x.fillRect(0, 0, 1280, H)
  }
  glow(200, 100, 700, 'rgba(255,90,170,0.32)')
  glow(1100, 800, 800, 'rgba(70,90,255,0.45)')
  x.globalAlpha = 0.07
  bolt(x, 1010, 420, 600, '#ffffff')
  x.globalAlpha = 1
  const center = (t: string, py: number, font: string, col: any, sp: number) => {
    x.font = font
    let w = 0
    for (const ch of t.split('')) w += x.measureText(ch).width + sp
    spaced(x, t, 640 - (w - sp) / 2, py, font, col, sp)
  }
  center('TOP UP', 130, '26px InterX', '#ffc83c', 12)
  txt(x, 'Top up Boosts', 640, 250, '104px InterX', '#ffffff')
  txt(x, 'Needed to boost giveaways', 640, 308, '34px InterB', '#d9c8ff')
  x.fillStyle = 'rgba(255,255,255,0.07)'
  rrect(x, 290, 370, 700, 260, 40)
  x.fill()
  x.lineWidth = 3
  x.strokeStyle = 'rgba(255,200,80,0.5)'
  rrect(x, 290, 370, 700, 260, 40)
  x.stroke()
  center('YOUR BALANCE', 430, '24px InterX', '#d9c8ff', 8)
  txt(x, `${Math.max(0, Math.round(info.credits))}`, 640, 575, '150px InterX', wGold(x, 560, 450, 720, 575) as any)
  center('CHOOSE A PACK BELOW', 705, '24px InterX', '#ffc83c', 6)
  x.strokeStyle = '#ffc83c'
  x.lineWidth = 10
  x.lineCap = 'round'
  x.lineJoin = 'round'
  ;[0, 34].forEach((d, i) => {
    x.globalAlpha = i ? 1 : 0.45
    x.beginPath()
    x.moveTo(606, 730 + d)
    x.lineTo(640, 758 + d)
    x.lineTo(674, 730 + d)
    x.stroke()
  })
  x.globalAlpha = 1
  txt(x, 'Boosts never expire', 640, 860, '26px InterB', '#9d93c8')
  return canvas.toBuffer('image/png')
}
