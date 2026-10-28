// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { RaffleModel } from '../models'
import { ChatModel, findChat } from '../models/chat'
import { trackBoost } from '../models/boostEvent'
import { AutoBoostEventModel, trackAuto } from '../models/autoBoostEvent'
import { CreditTxModel } from '../models/creditTx'
import { CREDIT_PACKS, CREDIT_POPULAR, getCredits, addCredits, spendCreditsSplit, bonusFor } from './credits'
import { acceptTerms, hasAcceptedTerms, termsText } from './terms'
import { raffleTotals, chanceOf, pct } from './odds'
import { cryptoEnabled, cryptoPriceLabel } from './cryptoPay'
import { expireFreeCredits } from './freeExpiry'
import { loc } from './locale'
import {
  validateBoost,
  notifyOwner,
  overtakeAlerts,
  multLabel,
  pctLabel,
  packText,
  multiplierOf,
  maxBoosts,
  entryValueOf,
  BOOST_STEP,
  BOOST_PRICE,
  sendRecharge,
} from './boost'

// Auto-Boost: Boosts paid with credits and added automatically to every giveaway a person joins.
// Texts are in English (they are sent to the users of the bot).

const DEFAULT_LIMIT = Math.max(1, parseInt(process.env.AUTOBOOST_LIMIT || '10', 10) || 10)
const MAX_MISSED = 3
const GIFT_AFTER_HOURS = 48
const LIMITS = [5, 10, 20, 50]
const TZ = 'Europe/Andorra'

let tg: any = null

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const boostWord = (n: number) => (n === 1 ? 'Boost' : 'Boosts')
const giveawayWord = (n: number) => (n === 1 ? 'giveaway' : 'giveaways')
const creditWord = (n: number) => (n === 1 ? 'Boost' : 'Boosts')
const dayOf = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })

/** One button to the recharge screen (numbered packs with both prices) */
function packButtons() {
  return [[{ text: '💳 Buy Boosts', callback_data: 'abr~' }]]
}

async function giveawayInfo(raffle: any) {
  let title = `${raffle.chatId}`
  let link = ''
  try {
    const c: any = await tg.getChat(raffle.chatId)
    title = c.title || title
    if (raffle.messageId) {
      const internal = `${raffle.chatId}`.replace(/^-100/, '')
      link = c.username
        ? `https://t.me/${c.username}/${raffle.messageId}`
        : `${raffle.chatId}`.startsWith('-100')
        ? `https://t.me/c/${internal}/${raffle.messageId}`
        : ''
    }
  } catch {
    // keep the id
  }
  return { title, link }
}

const linkRow = (link: string) => (link ? [[{ text: '🔗 Open giveaway', url: link }]] : [])

async function send(userId: number, text: string, keyboard: any[]) {
  try {
    await tg.sendMessage(userId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: keyboard },
    })
  } catch {
    // the person blocked the bot
  }
}

/** Status line + button for the Boost menu */
export async function autoBoostStatus(userId: number) {
  const chat: any = await ChatModel.findOne({ chatId: userId }).select('autoBoost')
  const n = (chat && chat.autoBoost) || 0
  return {
    line: n ? `🔁 Auto-Boost: ${n} per giveaway` : '🔁 Auto-Boost: OFF',
    button: n ? '🔁 Auto-Boost: ON' : '🔁 Auto-Boost: OFF',
  }
}

/** Auto-Boost can only be turned on with Boosts in the balance */
async function needBoosts(ctx: any, edit: boolean) {
  const text =
    `🔁 <b>Auto-Boost</b>\n\n` +
    `Boost every giveaway you join, automatically.\n\n` +
    `💰 You have 0 Boosts. Buy Boosts first, then turn Auto-Boost on 👇`
  const keyboard: any[] = [[{ text: '💳 Buy Boosts', callback_data: 'abr~' }]]
  if (edit) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } })
      return
    } catch (err) {
      if (/not modified/i.test(`${(err && (err.description || err.message)) || ''}`)) return
    }
  }
  return ctx.replyWithHTML(text, { reply_markup: { inline_keyboard: keyboard } } as any)
}

/** Auto-Boost screen: choose how many Boosts per giveaway */
async function showMenu(ctx: any, edit = false) {
  const userId = ctx.from.id
  const chat: any = await findChat(userId)
  if (!(await hasAcceptedTerms(userId))) {
    return ctx.replyWithHTML(`${termsText(chat.language)}\n\n${loc('terms_accept_prompt', chat.language)}`, {
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: loc('terms_accept_button', chat.language), callback_data: 'ta~' }]],
      },
    })
  }
  const n = chat.autoBoost || 0
  if (!n && (await getCredits(userId)) <= 0) {
    void trackAuto('open_nobal', userId)
    return needBoosts(ctx, edit)
  }
  void trackAuto('open', userId)
  const text =
    `🔁 <b>Auto-Boost</b>\n\n` +
    `Boost every giveaway you join, automatically.\n` +
    `Paid with your Boosts. Free Boosts are used first.\n\n` +
    (n ? `Now: <b>ON · ${n} ${boostWord(n)} per giveaway</b>\n\n` : '') +
    `How many Boosts per giveaway?`
  const keyboard: any[] = [
    [
      { text: '🚀 1 Boost', callback_data: 'ab~1' },
      { text: '🚀 2 Boosts', callback_data: 'ab~2' },
      { text: '🚀 3 Boosts', callback_data: 'ab~3' },
    ],
  ]
  if (n) keyboard.push([{ text: 'Turn off', callback_data: 'ab~0' }])
  if (edit) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } })
      return
    } catch (err) {
      if (/not modified/i.test(`${(err && (err.description || err.message)) || ''}`)) return
    }
  }
  return ctx.replyWithHTML(text, { reply_markup: { inline_keyboard: keyboard } } as any)
}

async function setBoosts(ctx: any, n: number) {
  const userId = ctx.from.id
  if (n === 0) {
    await ChatModel.updateOne({ chatId: userId }, { $set: { autoBoost: 0, autoBoostMissed: 0 }, $unset: { autoBoostPausedAt: 1 } })
    void trackAuto('off_manual', userId)
    return ctx.editMessageText('🔁 <b>Auto-Boost is OFF</b>\n\nYou can turn it on again anytime.', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🔁 Turn on', callback_data: 'ab~m' }]] },
    })
  }
  if ((await getCredits(userId)) <= 0) return needBoosts(ctx, true)
  const before: any = await ChatModel.findOne({ chatId: userId }).select('autoBoost')
  const wasOn = !!(before && before.autoBoost > 0)
  const chat: any = await ChatModel.findOneAndUpdate(
    { chatId: userId },
    { $set: { autoBoost: n, autoBoostMissed: 0 }, $unset: { autoBoostPausedAt: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
  const credits = chat.credits || 0
  const limit = chat.autoBoostLimit || DEFAULT_LIMIT
  void trackAuto('pick', userId, { n })
  if (!wasOn) void trackAuto('activate', userId, { n })
  // Owner alert: someone turned Auto-Boost on (not when only changing the amount)
  if (!wasOn) {
    try {
      const admin = parseInt(process.env.ADMIN, 10)
      if (admin) {
        const u = ctx.from
        const name = u.username ? `@${u.username}` : `${u.first_name || ''}${u.last_name ? ` ${u.last_name}` : ''}`.trim()
        await tg.sendMessage(
          admin,
          `🔁 <b>Auto-Boost activado</b>\n\n👤 ${esc(name)} (<code>${userId}</code>)\n🚀 ${n} ${boostWord(n)} por sorteo\n💰 Boosts: ${credits}`,
          { parse_mode: 'HTML' } as any
        )
      }
    } catch (err) {
      console.error(err)
    }
  }
  const text =
    `✅ <b>Auto-Boost is ON</b>\n\n` +
    `🚀 ${n} ${boostWord(n)} in every giveaway you join\n` +
    `🛡 Daily limit: ${limit} Boosts\n\n` +
    (credits > 0
      ? `💰 Your Boosts: ${credits} · enough for ${Math.floor(credits / n)} ${giveawayWord(Math.floor(credits / n))}`
      : `💰 You have 0 Boosts. Buy Boosts to start 👇`)
  const keyboard: any[] = []
  if (credits <= 0) {
    packButtons().forEach((r) => keyboard.push(r))
  }
  keyboard.push([
    { text: '🚀 Change Boosts', callback_data: 'ab~m' },
    { text: '🛡 Daily limit', callback_data: 'abl~m' },
  ])
  keyboard.push([{ text: 'Turn off', callback_data: 'ab~0' }])
  return ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } })
}

async function pauseOrOff(chat: any, raffle: any, res: any, today: string) {
  const userId = chat.chatId
  const missed = (chat.autoBoostMissed || 0) + 1
  if (missed >= MAX_MISSED) {
    await ChatModel.updateOne({ chatId: userId }, { $set: { autoBoost: 0, autoBoostMissed: 0 }, $unset: { autoBoostPausedAt: 1 } })
    void trackAuto('off_auto', userId)
    await send(
      userId,
      `🔁 <b>Auto-Boost turned off</b>\n\nYou missed ${MAX_MISSED} giveaways without Boosts, so we paused it to keep things quiet.\n\nTurn it back on anytime 👇`,
      [[{ text: '🔁 Turn on again', callback_data: 'ab~m' }], [{ text: 'Buy Boosts', callback_data: 'abr~' }]]
    )
    return
  }
  const first = !chat.autoBoostPausedAt
  await ChatModel.updateOne(
    { chatId: userId },
    first ? { $set: { autoBoostMissed: missed, autoBoostPausedAt: new Date() } } : { $set: { autoBoostMissed: missed } }
  )
  if (!first) return
  void trackAuto('paused', userId, { raffleId: `${raffle._id}` })
  const { title, link } = await giveawayInfo(raffle)
  const base = entryValueOf(raffle)
  const mult = multiplierOf()
  let chanceLine = ''
  try {
    const totals = await raffleTotals(raffle._id, base, BOOST_STEP)
    if (totals) {
      const now = chanceOf(totals, res.value, base, BOOST_STEP)
      const after = chanceOf(totals, res.value, base, BOOST_STEP, mult)
      chanceLine = `\n🎯 Your chance: ${pct(now)} → ${pct(after)} with a Boost`
    }
  } catch {
    // no odds line
  }
  const keyboard: any[] = linkRow(link)
  packButtons().forEach((r) => keyboard.push(r))
  keyboard.push([{ text: `⭐ Boost only this one · ${BOOST_PRICE}⭐`, callback_data: `b~${raffle._id}~1` }])
  await send(
    userId,
    `🔁 <b>Auto-Boost paused</b>\n\n` +
      `You joined <b>${esc(title)}</b> with ${multLabel(res.value, 'en', base)} instead of ${multLabel(res.value + mult, 'en', base)}.` +
      `${chanceLine}\n\nBoost this one now, or buy Boosts to resume Auto-Boost 👇`,
    keyboard
  )
}

/**
 * Called right after somebody joins a giveaway. Returns a short text for the "You're in" pop-up
 * ('' when Auto-Boost did nothing). The private message goes out on its own.
 */
export async function autoBoostOnJoin(raffle: any, from: any): Promise<string> {
  if (!tg || !from) return ''
  const userId = from.id
  const chat: any = await ChatModel.findOne({ chatId: userId })
  if (!chat || !(chat.autoBoost > 0)) return ''
  const raffleId = `${raffle._id}`
  const res: any = await validateBoost(raffleId, userId, 1)
  if (res.error) return '' // over, Boost off, or already at the maximum
  const today = dayOf()
  const spentToday = chat.autoBoostDay === today ? chat.autoBoostSpent || 0 : 0
  const limit = chat.autoBoostLimit || DEFAULT_LIMIT
  const want = Math.min(chat.autoBoost, maxBoosts() - res.used)
  const credits = chat.credits || 0
  if (credits <= 0) {
    await pauseOrOff(chat, res.raffle, res, today)
    return ''
  }
  if (limit - spentToday <= 0) {
    if (chat.autoBoostLimitDay !== today) {
      await ChatModel.updateOne({ chatId: userId }, { $set: { autoBoostLimitDay: today } })
      void trackAuto('limit_hit', userId)
      await send(
        userId,
        `🛡 <b>Daily limit reached</b>\n\nAuto-Boost used ${limit} Boosts today and will pause until tomorrow.\n💰 Your Boosts: ${credits}`,
        [[{ text: '⚙️ Change limit', callback_data: 'abl~m' }], [{ text: 'Turn off', callback_data: 'ab~0' }]]
      )
    }
    return ''
  }
  const k = Math.min(want, credits, limit - spentToday)
  const mult = multiplierOf()
  const name = from.username ? `@${from.username}` : `${from.first_name}${from.last_name ? ` ${from.last_name}` : ''}`
  const spent = await spendCreditsSplit(userId, k, { raffleId, chatId: raffle.chatId, name })
  if (spent.balance < 0) return ''
  const upd: any = await RaffleModel.updateOne(
    { _id: raffle._id, winners: { $exists: false } },
    {
      $push: {
        boostIds: { $each: Array(k).fill(userId) },
        boostMults: { $each: Array(k).fill(mult) },
        creditIds: { $each: Array(k).fill(userId) },
      },
    }
  )
  if (!upd || !upd.nModified) {
    await addCredits(userId, k, { type: 'refund', method: 'credits', raffleId, free: spent.free })
    return ''
  }
  await ChatModel.updateOne(
    { chatId: userId },
    {
      $set: { autoBoostDay: today, autoBoostSpent: spentToday + k, autoBoostMissed: 0 },
      $unset: { autoBoostPausedAt: 1 },
      $inc: { autoBoostTotal: k },
    }
  )
  await trackBoost({ type: 'invoice', userId, raffleId, boosts: k, method: 'credits', reminded: true })
  void trackAuto('applied', userId, { k, raffleId })
  const value = res.value + k * mult
  const base = entryValueOf(res.raffle)
  try {
    const fresh: any = await RaffleModel.findById(raffle._id).select('-participantsIds')
    const raffleChat = await findChat(fresh.chatId)
    await require('./raffle').refreshRaffleMessage(tg, fresh, raffleChat)
    void overtakeAlerts(tg, fresh, from, k, mult)
  } catch {
    // message may be unchanged or deleted
  }
  const step = BOOST_STEP * mult
  await notifyOwner(
    { telegram: tg, from },
    {
      userId,
      stars: k * BOOST_PRICE,
      credits: true,
      gift: spent.free >= k,
      auto: true,
      n: k,
      chatId: raffle.chatId,
      messageId: raffle.messageId,
      step,
      boostMult: mult,
      mult: multLabel(value, 'es', base),
      total: base + BOOST_STEP * value,
    }
  )
  // Private message
  const balance = spent.balance
  const partial = k < want
  const low = balance <= 2
  const { title, link } = await giveawayInfo(raffle)
  const per = chat.autoBoost
  const enough = Math.floor(balance / per)
  const text =
    `🔁 <b>Auto-Boost applied${partial ? ' (partial)' : ''}</b>\n\n` +
    `🎁 <b>${esc(title)}</b>\n` +
    (partial
      ? `🚀 ${k} of ${want} ${boostWord(want)} · ${pctLabel(k, 'en', step)}\n`
      : `🚀 ${pctLabel(k, 'en', step)} · you have ${multLabel(value, 'en', base)}\n`) +
    `💰 Boosts left: ${balance}` +
    (low && !partial && balance > 0 ? ` · enough for ${enough} ${giveawayWord(enough)}` : '') +
    (partial
      ? `\n\nBuy more Boosts to get your full ${want} next time 👇`
      : low
      ? `\n\n⚠️ Buy more Boosts so you never miss one 👇`
      : '')
  const keyboard: any[] = linkRow(link)
  if (partial) void trackAuto('partial', userId, { k, raffleId })
  if (low || partial) {
    void trackAuto('low_warn', userId)
    packButtons().forEach((r) => keyboard.push(r))
  }
  await send(userId, text, keyboard)
  return `\n🔁 ${pctLabel(k, 'en', step)} applied`
}

/** A top-up right after a low-balance / paused / partial / gift message counts as bought after the warning */
async function markRechargeAfterWarn(userId: number) {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const warn = await AutoBoostEventModel.findOne({
      userId,
      type: { $in: ['low_warn', 'paused', 'gift_sent'] },
      createdAt: { $gte: since },
    } as any)
    if (warn) await trackAuto('recharge_after_warn', userId)
  } catch (err) {
    console.error(err)
  }
}

const giving = new Set<number>()

/** Credits arrived (recharge or code): resume a paused Auto-Boost and give the one-time gift */
export async function afterCredit(userId: number, type: string) {
  if (!tg || giving.has(userId)) return
  const chat: any = await ChatModel.findOne({ chatId: userId })
  if (!chat || !(chat.autoBoost > 0)) return
  let gift = 0
  if (type === 'topup') void markRechargeAfterWarn(userId)
  if (type === 'topup' && chat.autoBoostGift) {
    giving.add(userId)
    try {
      await ChatModel.updateOne({ chatId: userId }, { $set: { autoBoostGift: false } })
      await addCredits(userId, 1, { type: 'code', method: 'auto_gift', free: 1 })
      gift = 1
      void trackAuto('gift_claimed', userId)
    } finally {
      giving.delete(userId)
    }
  }
  if (!chat.autoBoostPausedAt) return
  await ChatModel.updateOne({ chatId: userId }, { $set: { autoBoostMissed: 0 }, $unset: { autoBoostPausedAt: 1 } })
  void trackAuto('resumed', userId)
  const balance = await getCredits(userId)
  const n = chat.autoBoost
  await send(
    userId,
    `✅ <b>Auto-Boost resumed</b>\n\n💰 Your Boosts: ${balance}\n🚀 ${n} ${boostWord(n)} in every giveaway you join` +
      (gift ? `\n🎁 +1 free ${creditWord(1)} added` : ''),
    []
  )
}

/** Hourly: offer the gift to people paused for 48 hours, expire free credits */
async function sweep() {
  try {
    await expireFreeCredits(tg)
  } catch (err) {
    console.error('Free credits expiry failed', err)
  }
  try {
    const before = new Date(Date.now() - GIFT_AFTER_HOURS * 60 * 60 * 1000)
    const list: any[] = await ChatModel.find({
      autoBoost: { $gt: 0 },
      autoBoostPausedAt: { $lte: before },
      autoBoostGift: { $ne: true },
      credits: { $lte: 0 },
    })
    for (const c of list) {
      await ChatModel.updateOne({ chatId: c.chatId }, { $set: { autoBoostGift: true } })
      const keyboard: any[] = packButtons()
      void trackAuto('gift_sent', c.chatId)
      await send(
        c.chatId,
        `🎁 <b>A little gift for you</b>\n\nBuy Boosts today and get <b>+1 extra Boost</b> free.\nYour Auto-Boost will resume right away.`,
        keyboard
      )
    }
  } catch (err) {
    console.error('Auto-Boost gift sweep failed', err)
  }
}

/** Numbers for the owner's /stars */
export async function autoBoostText() {
  try {
    const now = Date.now()
    const d1 = new Date(now - 24 * 60 * 60 * 1000)
    const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000)
    const cnt = (type: string, since?: Date) =>
      AutoBoostEventModel.countDocuments(since ? ({ type, createdAt: { $gte: since } } as any) : ({ type } as any))
    const users = async (type: string, since?: Date) =>
      ((await AutoBoostEventModel.distinct('userId', since ? ({ type, createdAt: { $gte: since } } as any) : ({ type } as any))) as any[]).length
    const sum = async (since?: Date) => {
      const r: any[] = await AutoBoostEventModel.aggregate([
        { $match: Object.assign({ type: 'applied' }, since ? { createdAt: { $gte: since } } : {}) },
        { $group: { _id: null, k: { $sum: '$k' }, raffles: { $addToSet: '$raffleId' } } },
      ])
      return { k: (r[0] && r[0].k) || 0, raffles: (r[0] && r[0].raffles.length) || 0 }
    }
    const active = await ChatModel.countDocuments({ autoBoost: { $gt: 0 } })
    const paused = await ChatModel.countDocuments({ autoBoost: { $gt: 0 }, autoBoostPausedAt: { $exists: true } })
    const per: number[] = []
    for (const n of [1, 2, 3]) per.push(await ChatModel.countDocuments({ autoBoost: n }))
    const total: any[] = await ChatModel.aggregate([{ $group: { _id: null, n: { $sum: '$autoBoostTotal' } } }])
    const buyers = (await CreditTxModel.distinct('userId', { type: 'topup', method: { $in: ['stars', 'usdt'] } } as any)) as number[]
    const buyersOn = buyers.length ? await ChatModel.countDocuments({ chatId: { $in: buyers }, autoBoost: { $gt: 0 } }) : 0
    const buyersPct = buyers.length ? Math.round((buyersOn / buyers.length) * 100) : 0
    const s1 = await sum(d1)
    const s7 = await sum(d7)
    const sAll = await sum()
    const spentAll = (total[0] && total[0].n) || 0
    const star = (n: number) => `${n} (${n * BOOST_PRICE}⭐)`
    const [act1, act7, actAll] = [await cnt('activate', d1), await cnt('activate', d7), await cnt('activate')]
    const [open7, openUsers7] = [await cnt('open', d7), await users('open', d7)]
    const [noBal7, buy7, buyUsers7, pack7, packUsers7] = [
      await cnt('open_nobal', d7),
      await cnt('buy_click', d7),
      await users('buy_click', d7),
      await cnt('pack_pick', d7),
      await users('pack_pick', d7),
    ]
    return (
      `🔁 <b>Auto-Boost</b>\n` +
      `👥 Activos: <b>${active}</b> · ⏸ Pausados sin Boosts: <b>${paused}</b>\n` +
      `🎚 Reparto: 1 Boost <b>${per[0]}</b> · 2 Boosts <b>${per[1]}</b> · 3 Boosts <b>${per[2]}</b>\n` +
      `🛒 Compradores con Auto-Boost activo: <b>${buyersPct}%</b> (${buyersOn}/${buyers.length})\n\n` +
      `➕ Activaciones: 24 h <b>${act1}</b> · 7 d <b>${act7}</b> · total <b>${actAll}</b>\n` +
      `💰 Boosts gastados: 24 h <b>${star(s1.k)}</b> · 7 d <b>${star(s7.k)}</b> · total <b>${star(spentAll)}</b>\n` +
      `🎁 Sorteos potenciados: 24 h <b>${s1.raffles}</b> · 7 d <b>${s7.raffles}</b> · total <b>${sAll.raffles}</b>\n\n` +
      `👆 <b>Clics (7 d)</b>\n` +
      `🔁 Abrieron Auto-Boost: <b>${open7}</b> clics (${openUsers7} personas) · sin Boosts: <b>${noBal7}</b>\n` +
      `💳 Pulsaron Buy Boosts desde ahí: <b>${buy7}</b> (${buyUsers7} personas)\n` +
      `📦 Eligieron un pack: <b>${pack7}</b> (${packUsers7} personas)\n` +
      `✅ Compraron tras un aviso: <b>${await cnt('recharge_after_warn', d7)}</b>\n\n` +
      `🩺 <b>Salud</b>\n` +
      `🔕 Apagados solos (3 sorteos sin Boosts): <b>${await cnt('off_auto')}</b> · ▶️ Reanudados al recargar: <b>${await cnt('resumed')}</b>\n` +
      `🛡 Límite diario alcanzado: <b>${await cnt('limit_hit')}</b> veces\n` +
      `🎁 Regalo +1 Boost: enviados <b>${await cnt('gift_sent')}</b> · canjeados <b>${await cnt('gift_claimed')}</b>\n\n`
    )
  } catch (err) {
    console.error(err)
    return ''
  }
}

export function setupAutoBoost(bot: Telegraf<ContextMessageUpdate>) {
  tg = bot.telegram
  setTimeout(() => sweep(), 60 * 1000)
  setInterval(() => sweep(), 60 * 60 * 1000)

  bot.command('autoboost', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    try {
      await showMenu(ctx)
    } catch (err) {
      console.error(err)
    }
  })

  const answer = async (ctx: any) => {
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
  }

  // "Buy Boosts" pressed from an Auto-Boost screen: count it, then open the recharge screen
  bot.action('abr~', async (ctx) => {
    await answer(ctx)
    void trackAuto('buy_click', ctx.from.id)
    try {
      await sendRecharge(ctx, '0')
    } catch (err) {
      console.error(err)
    }
  })

  bot.action('ab~m', async (ctx) => {
    await answer(ctx)
    try {
      await showMenu(ctx)
    } catch (err) {
      console.error(err)
    }
  })

  bot.action('ta~', async (ctx) => {
    await answer(ctx)
    await acceptTerms(ctx.from.id)
    try {
      await showMenu(ctx)
    } catch (err) {
      console.error(err)
    }
  })

  bot.action(/^ab~([0-3])$/, async (ctx) => {
    await answer(ctx)
    try {
      await setBoosts(ctx, parseInt((ctx as any).match[1], 10))
    } catch (err) {
      console.error(err)
    }
  })

  // A pack was chosen: now ask how to pay
  bot.action(/^ap~(\d+)~([a-f0-9]{24}|0)$/, async (ctx) => {
    await answer(ctx)
    const n = parseInt((ctx as any).match[1], 10)
    const raffleId = (ctx as any).match[2]
    if (CREDIT_PACKS.indexOf(n) < 0) return
    try {
      const recent = await AutoBoostEventModel.findOne({
        userId: ctx.from.id,
        type: 'buy_click',
        createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) },
      } as any)
      if (recent) void trackAuto('pack_pick', ctx.from.id, { n })
      const chat: any = await findChat(ctx.from.id)
      const row: any[] = [{ text: `⭐ ${n * BOOST_PRICE} Stars`, callback_data: `ts~${n}~${raffleId}` }]
      if (cryptoEnabled()) row.push({ text: `🪙 ${cryptoPriceLabel(n)} USDT`, callback_data: `tc~${n}~${raffleId}` })
      await ctx.editMessageText(
        `💳 <b>${packText(n, chat.language)}</b>\n\nHow do you want to pay? 👇`,
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [row, [{ text: loc('back_btn', chat.language), callback_data: `r~${raffleId}` }]] },
        } as any
      )
    } catch (err) {
      console.error(err)
    }
  })

  bot.action('abl~m', async (ctx) => {
    await answer(ctx)
    try {
      const chat: any = await findChat(ctx.from.id)
      const limit = chat.autoBoostLimit || DEFAULT_LIMIT
      await ctx.reply(
        `🛡 <b>Daily limit</b>\n\nMost Boosts Auto-Boost can use in one day.\nNow: <b>${limit}</b>`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [LIMITS.map((n) => ({ text: `${n === limit ? '✅ ' : ''}${n}`, callback_data: `abl~${n}` }))],
          },
        } as any
      )
    } catch (err) {
      console.error(err)
    }
  })

  bot.action(/^abl~(\d+)$/, async (ctx) => {
    await answer(ctx)
    const n = parseInt((ctx as any).match[1], 10)
    if (LIMITS.indexOf(n) < 0) return
    try {
      await ChatModel.updateOne({ chatId: ctx.from.id }, { $set: { autoBoostLimit: n } })
      await ctx.editMessageText(`🛡 <b>Daily limit set to ${n} Boosts</b>`, { parse_mode: 'HTML' })
    } catch (err) {
      console.error(err)
    }
  })
}
