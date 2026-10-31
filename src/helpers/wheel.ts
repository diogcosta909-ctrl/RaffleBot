// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { ChatModel, findChat } from '../models/chat'
import { WheelSpinModel } from '../models/wheelSpin'
import { CreditTxModel } from '../models/creditTx'
import { addCredits, getCredits, FREE_DAYS } from './credits'
import { acceptTerms, hasAcceptedTerms, termsText } from './terms'
import { loc } from './locale'
import * as fs from 'fs'
import * as path from 'path'

// Daily spin: one free spin per day with small Boost prizes. Texts are in English (sent to the users).
// WHEEL_PRIZES="Boosts:weight,..." (default 0:85,1:12,2:2.5,5:0.5), WHEEL_DAILY_CAP = max Boosts given per day (default 300)

const TZ = 'Europe/Andorra'
const BOOST_USD = parseFloat(process.env.BOOST_USD || '0.015') || 0.015
const DAILY_CAP = Math.max(1, parseInt(process.env.WHEEL_DAILY_CAP || '300', 10) || 300)

function prizeTable(): { prize: number; weight: number }[] {
  const raw = process.env.WHEEL_PRIZES || '0:85,1:12,2:2.5,5:0.5'
  const rows = raw
    .split(',')
    .map((p) => p.split(':'))
    .map(([a, b]) => ({ prize: parseInt(a, 10), weight: parseFloat(b) }))
    .filter((r) => r.prize >= 0 && r.weight > 0)
  return rows.length ? rows : [{ prize: 0, weight: 100 }]
}

const dayOf = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const yesterday = () => dayOf(new Date(Date.now() - 24 * 3600 * 1000))

/** Time left until the next spin (midnight, Andorra time) as "5h 20m" */
function untilMidnight() {
  const parts: any = {}
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' } as any)
    .formatToParts(new Date())
    .forEach((x) => (parts[x.type] = x.value))
  const left = 24 * 3600 - (+parts.hour * 3600 + +parts.minute * 60 + +parts.second)
  const h = Math.floor(left / 3600)
  const m = Math.floor((left % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`
}

// Wheel videos (assets/wheel): one per landing slice. Telegram file ids are kept after the first upload
const WHEEL_DIR = path.join(__dirname, '..', '..', 'assets', 'wheel')
const VIDEOS: { [prize: number]: string[] } = {
  0: ['nada1', 'nada2', 'nada3', 'nada4'],
  1: ['p11', 'p12'],
  2: ['p21'],
  5: ['p51'],
}
const videoIds = new Map<string, string>()

function pickVideo(prize: number) {
  const list = VIDEOS[prize]
  if (!list) return ''
  const name = list[Math.floor(Math.random() * list.length)]
  return fs.existsSync(path.join(WHEEL_DIR, `${name}.mp4`)) ? name : ''
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function roll(maxPrize: number) {
  const t = prizeTable().filter((r) => r.prize <= maxPrize)
  const rows = t.length ? t : [{ prize: 0, weight: 1 }]
  const total = rows.reduce((a, r) => a + r.weight, 0)
  let x = Math.random() * total
  let prize = rows[rows.length - 1].prize
  for (const r of rows) {
    if (x < r.weight) {
      prize = r.prize
      break
    }
    x -= r.weight
  }
  return prize
}

const keyboardAfter = (won: boolean) => [
  [{ text: '🔁 Auto-Boost', callback_data: 'ab~m' }],
  won ? [{ text: '👥 Invite & earn 10%', callback_data: 'inv~' }] : [{ text: '💳 Buy Boosts', callback_data: 'abr~' }],
]

async function edit(ctx: any, msg: any, text: string, keyboard?: any[]) {
  const extra: any = { parse_mode: 'HTML', reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined }
  try {
    if (msg) await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, text, extra)
    else await ctx.editMessageText(text, extra)
  } catch (err) {
    if (!/not modified/i.test(`${(err && (err.description || err.message)) || ''}`)) {
      await ctx.replyWithHTML(text, extra)
    }
  }
}

/** Public feed notice (BOOST_FEED_CHAT) when somebody wins on the wheel, with a button to spin */
async function feedNotice(ctx: any, prize: number, streak: number) {
  const feed = (process.env.BOOST_FEED_CHAT || '').trim()
  if (!feed || prize <= 0) return
  const u = ctx.from
  const name = u.username ? `@${u.username}` : `${u.first_name || ''}${u.last_name ? ` ${u.last_name}` : ''}`.trim() || 'Someone'
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const caption =
    `🎡 <b>${esc(name)}</b> won <b>+${prize} ${prize === 1 ? 'Boost' : 'Boosts'}</b> on the daily spin!\n` +
    `🔥 ${streak} ${streak === 1 ? 'day' : 'days'} streak · spin free every day`
  const extra: any = {
    caption,
    parse_mode: 'HTML',
    disable_notification: true,
    reply_markup: { inline_keyboard: [[{ text: '🎡 Spin the wheel', url: `https://t.me/${process.env.USERNAME}?start=spin` }]] },
  }
  try {
    let sent = false
    try {
      const image = await require('./boostImage').renderWheelImage({ name, prize, streak })
      await ctx.telegram.sendPhoto(feed, { source: image }, extra)
      sent = true
    } catch (err) {
      console.error('Wheel image failed, sending text', err)
    }
    if (!sent) {
      await ctx.telegram.sendMessage(feed, caption, {
        parse_mode: 'HTML',
        disable_notification: true,
        reply_markup: extra.reply_markup,
      } as any)
    }
  } catch (err) {
    console.error('Wheel feed notice failed', err)
  }
}

export async function spinFromStart(ctx: any) {
  return spin(ctx, false)
}

async function spin(ctx: any, fromButton: boolean) {
  const userId = ctx.from.id
  const chat: any = await findChat(userId)
  if (!(await hasAcceptedTerms(userId))) {
    return ctx.replyWithHTML(`${termsText(chat.language)}\n\n${loc('terms_accept_prompt', chat.language)}`, {
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: loc('terms_accept_button', chat.language), callback_data: 'tw~' }]] },
    } as any)
  }
  const today = dayOf()
  if (chat.wheelDay === today) {
    const text =
      `🎡 <b>Daily spin</b>\n\n` +
      `You already spun today.\n` +
      `⏳ <b>Next spin in:</b> ${untilMidnight()}\n` +
      `🔥 <b>Streak:</b> ${chat.wheelStreak || 1} ${(chat.wheelStreak || 1) === 1 ? 'day' : 'days'}`
    if (fromButton) return edit(ctx, null, text, keyboardAfter(false))
    return ctx.replyWithHTML(text, { reply_markup: { inline_keyboard: keyboardAfter(false) } } as any)
  }
  const streak = chat.wheelDay === yesterday() ? (chat.wheelStreak || 0) + 1 : 1
  // Claim today's spin first so it can never be used twice
  const claim: any = await ChatModel.findOneAndUpdate(
    { chatId: userId, wheelDay: { $ne: today } },
    { $set: { wheelDay: today, wheelStreak: streak } },
    { new: true }
  )
  if (!claim) return
  // Daily cap: when it is reached only the smallest prize can come out
  const given: any[] = await WheelSpinModel.aggregate([{ $match: { day: today } }, { $group: { _id: null, n: { $sum: '$prize' } } }])
  const capped = ((given[0] && given[0].n) || 0) >= DAILY_CAP
  const prize = roll(capped ? 1 : 1000)
  await WheelSpinModel.create({ userId, prize, streak, day: today })
  // The wheel video (falls back to a text animation when the video is missing or fails)
  let msg: any = null
  let isVideo = false
  const video = pickVideo(prize)
  if (video) {
    try {
      const sent: any = await ctx.replyWithAnimation(
        videoIds.get(video) || { source: fs.readFileSync(path.join(WHEEL_DIR, `${video}.mp4`)) },
        { caption: `🎡 <b>Daily spin</b>\n\nSpinning...`, parse_mode: 'HTML' } as any
      )
      if (sent && sent.animation && !videoIds.has(video)) videoIds.set(video, sent.animation.file_id)
      msg = sent
      isVideo = true
      await wait(5000)
    } catch (err) {
      console.error('Wheel video failed', err)
      videoIds.delete(video)
      msg = null
      isVideo = false
    }
  }
  if (!isVideo) {
    if (fromButton) {
      await edit(ctx, null, `🎡 <b>Daily spin</b>\n\nSpinning...`)
    } else {
      msg = await ctx.replyWithHTML(`🎡 <b>Daily spin</b>\n\nSpinning...`)
    }
    await wait(700)
    await edit(ctx, msg, `🎡 <b>Daily spin</b>\n\nSpinning... 🎰`)
    await wait(700)
  }
  let balance = await getCredits(userId)
  if (prize > 0) {
    balance = await addCredits(userId, prize, { type: 'code', method: 'wheel', free: prize })
    void feedNotice(ctx, prize, streak)
  }
  const text =
    `🎡 <b>Daily spin</b>\n\n` +
    (prize > 0
      ? `🎉 <b>You won +${prize} ${prize === 1 ? 'Boost' : 'Boosts'}!</b>\n`
      : `😅 <b>No prize today</b>\nTry again tomorrow.\n`) +
    `\n🔥 <b>Streak:</b> ${streak} ${streak === 1 ? 'day' : 'days'}` +
    `\n💰 <b>Your Boosts:</b> ${balance}` +
    (prize > 0 && FREE_DAYS > 0 ? `\n⏳ Free Boosts last ${FREE_DAYS} days` : '') +
    `\n\n⏳ <b>Next spin in:</b> ${untilMidnight()}`
  if (isVideo) {
    try {
      await ctx.telegram.editMessageCaption(msg.chat.id, msg.message_id, undefined, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboardAfter(prize > 0) },
      } as any)
    } catch (err) {
      await ctx.replyWithHTML(text, { reply_markup: { inline_keyboard: keyboardAfter(prize > 0) } } as any)
    }
    return
  }
  await edit(ctx, msg, text, keyboardAfter(prize > 0))
}

/** Owner numbers */
async function wheelStats() {
  const DAY = 24 * 3600 * 1000
  const block = async (label: string, from?: Date) => {
    const match: any = from ? { createdAt: { $gte: from } } : {}
    const rows: any[] = await WheelSpinModel.aggregate([
      { $match: match },
      { $group: { _id: '$prize', n: { $sum: 1 }, users: { $addToSet: '$userId' } } },
    ])
    const spins = rows.reduce((a, r) => a + r.n, 0)
    const users = new Set<number>()
    rows.forEach((r) => r.users.forEach((u: number) => users.add(u)))
    const boosts = rows.reduce((a, r) => a + r._id * r.n, 0)
    const dist = rows
      .sort((a, b) => a._id - b._id)
      .map((r) => `${r._id === 0 ? 'nada' : `+${r._id}`}: ${r.n}`)
      .join(' · ')
    return (
      `<b>📅 ${label}</b>\n` +
      `<b>🎡 Giros:</b> ${spins} · <b>👥 Personas:</b> ${users.size}\n` +
      `<b>🎁 Boosts regalados:</b> ${boosts} (≈ $${(boosts * BOOST_USD).toFixed(2)})\n` +
      `<b>📊 Premios:</b> ${dist || '—'}`
    )
  }
  const ids: number[] = await WheelSpinModel.distinct('userId')
  const buyers: number[] = ids.length ? await CreditTxModel.distinct('userId', { userId: { $in: ids }, type: 'topup' } as any) : []
  const today = dayOf()
  const todayGiven: any[] = await WheelSpinModel.aggregate([{ $match: { day: today } }, { $group: { _id: null, n: { $sum: '$prize' } } }])
  const best: any[] = await ChatModel.find({ wheelStreak: { $gt: 0 } }).sort({ wheelStreak: -1 }).limit(1).select('wheelStreak')
  return (
    `<b>🎡 RULETA</b>\n\n` +
    (await block('Hoy', new Date(Date.now() - DAY))) +
    `\n\n` +
    (await block('7 días', new Date(Date.now() - 7 * DAY))) +
    `\n\n` +
    (await block('Total')) +
    `\n\n<b>🛒 Compradores entre quienes giraron:</b> ${buyers.length} de ${ids.length}\n` +
    `<b>🛡 Tope de hoy:</b> ${(todayGiven[0] && todayGiven[0].n) || 0}/${DAILY_CAP} Boosts\n` +
    `<b>🔥 Mejor racha activa:</b> ${(best[0] && best[0].wheelStreak) || 0} días`
  )
}

export function setupWheel(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('spin', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    try {
      await spin(ctx, false)
    } catch (err) {
      console.error(err)
    }
  })
  bot.action('wh~', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    try {
      await spin(ctx, true)
    } catch (err) {
      console.error(err)
    }
  })
  bot.action('tw~', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    try {
      await acceptTerms(ctx.from.id)
      await spin(ctx, false)
    } catch (err) {
      console.error(err)
    }
  })
  bot.command('ruleta', async (ctx) => {
    if (ctx.chat.type !== 'private' || ctx.from.id !== parseInt(process.env.ADMIN, 10)) return
    try {
      await ctx.replyWithHTML(await wheelStats())
    } catch (err) {
      console.error(err)
    }
  })
}
