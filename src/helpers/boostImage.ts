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
  win: { chip: 'WINNER', a: '#ffd34a', l: '#fff0b3', b0: '#3a2a06', b1: '#140d02' },
  pay: { chip: 'PAY', a: '#26c28f', l: '#9af0cf', b0: '#0d2a24', b1: '#06130f' },
}

type Hero = 'stars' | 'usdt' | 'bolts' | 'bolt1' | 'loop' | 'cards' | 'coins' | 'gift' | 'trophy'

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
    ;[-60, 60].forEach((dx) => {
      const g = x.createLinearGradient(0, cy - 50, 0, cy + 50)
      g.addColorStop(0, '#ffe27a')
      g.addColorStop(1, '#f5a30a')
      starPath(x, cx + dx, cy, 56)
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
  if (info.winner) {
    const how = info.credits ? 'Boosts' : info.crypto ? 'USDT' : plural(info.stars, 'Star', 'Stars')
    return renderCard({
      theme: 'win',
      hero: 'trophy',
      title: name,
      sub: 'won a giveaway with a Boost',
      big: `${info.entries}`,
      label: 'ENTRIES',
      foot: `Boost paid with ${how}`,
    })
  }
  let theme = 'stars'
  let hero: Hero = 'stars'
  let paid = `paid ${plural(info.stars, 'Star', 'Stars')}`
  if (info.credits && info.gift) {
    theme = 'gift'
    hero = 'bolt1'
    paid = `${plural(boosts, 'gift Boost', 'gift Boosts')}`
  } else if (info.credits) {
    theme = info.auto ? 'auto' : 'credits'
    hero = info.auto ? 'loop' : 'bolts'
    paid = info.auto ? `${plural(boosts, 'Boost', 'Boosts')} applied` : `paid with ${plural(boosts, 'Boost', 'Boosts')}`
  } else if (info.crypto) {
    theme = 'usdt'
    hero = 'usdt'
    paid = `paid ${plain(`${info.usdt || ''}`)} USDT`.replace('  ', ' ')
  }
  const sub = info.auto ? 'was boosted automatically' : info.gift ? 'used a free gift Boost' : 'boosted a giveaway'
  const added = info.added && info.added > 0 ? `+${Math.round(info.added)} entries · ` : ''
  return renderCard({
    theme,
    hero,
    heroCount: boosts,
    title: name,
    sub,
    big: `${info.entries}`,
    label: 'ENTRIES NOW',
    foot: `${added}${paid}`,
  })
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
  paid: string // "20 stars" / "0.4 USDT"
}): Promise<Buffer> {
  const bonus = info.bonus || 0
  const total = Math.max(1, Math.round(info.credits + bonus))
  const paid = plain(info.paid)
  return renderCard({
    theme: 'pack',
    hero: 'coins',
    title: drawableName(info.name) || 'Someone',
    sub: 'bought Boosts',
    big: `+${total}`,
    label: total === 1 ? 'BOOST' : 'BOOSTS',
    foot: `${paid ? `paid ${paid}` : 'ready to boost'}${bonus > 0 ? ` · ${bonus} free` : ''}`,
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
    sub: `boosted ${info.giveaways} giveaways`,
    big: `${info.boosts}`,
    label: info.boosts === 1 ? 'BOOST USED' : 'BOOSTS USED',
    foot: `${info.per} in each · paid with ${how}`,
  })
}
