// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { RaffleModel, Raffle } from '../models'
import { findChat, ChatModel } from '../models/chat'
import { PaymentModel } from '../models/payment'
import { CryptoOrderModel } from '../models/cryptoOrder'
import { BoostEventModel, trackBoost } from '../models/boostEvent'
import { acceptTerms, hasAcceptedTerms, termsText, supportContact } from './terms'
import {
  cryptoEnabled,
  cryptoPriceLabel,
  createOrder,
  formatUnits,
  startCryptoWatcher,
  CRYPTO_WALLET,
  CRYPTO_EXPIRY_MIN,
} from './cryptoPay'
import { getChatIdForConfig } from './getChatIdForConfig'
import { loc } from './locale'

// Config (env overridable): 1 Star = +0.3 weight (x1.3), max 10 boosts per user per raffle
export const BOOST_PRICE = Math.max(1, parseInt(process.env.BOOST_PRICE || '1', 10))
// Each ⭐ = BOOST_STEP whole entries (min 1, so an old value like 0.3 can't break labels)
export const BOOST_STEP = Math.max(1, Math.round(parseFloat(process.env.BOOST_STEP || '3')) || 1)
export const BOOST_MAX = Math.max(1, parseInt(process.env.BOOST_MAX || '10', 10))

// Packs offered in private chat (number of boosts per pack)
export const BOOST_OPTIONS = (process.env.BOOST_OPTIONS || '1,2,3,4,5')
  .split(',')
  .map((v) => parseInt(v.trim(), 10))
  .filter((v) => v > 0)

const PAYLOAD_PREFIX = 'boost:'

/** "1 entry" / "3 entries" in the chat language */
export function entriesLabel(k: number, language = 'en') {
  // Shown entries are always whole numbers (the draw keeps exact weights)
  const value = Math.round(k)
  return `${value} ${loc(value === 1 ? 'entry_one' : 'entry_many', language)}`
}

// Global boost multiplier (1 normally, 2 or 3 on special days). Applies to every
// chat and to raffles already running; kept in memory, saved on the owner's chat
let globalMultiplier = 1

/** Loads the saved global multiplier (called at startup) */
async function loadMultiplier() {
  try {
    const admin = parseInt(process.env.ADMIN, 10)
    if (!admin) return
    const chat = await findChat(admin)
    globalMultiplier = chat.boostMultiplier >= 1 ? chat.boostMultiplier : 1
  } catch (err) {
    console.error('Boost multiplier not loaded', err)
  }
}

/** Current boost multiplier, the same for every raffle */
export function multiplierOf(_raffle?: any) {
  return globalMultiplier
}

/** Max boosts (⭐) per person and raffle: BOOST_MAX × multiplier (x2 → 20) */
export function maxBoosts() {
  return Math.round(BOOST_MAX * globalMultiplier)
}

/** Entries given by each ⭐ in a raffle: BOOST_STEP × multiplier */
export function stepOf(raffle?: any) {
  return BOOST_STEP * multiplierOf(raffle)
}

/** "+3 entries" for a pack of n boosts */
function pctLabel(n: number, language = 'en', step = BOOST_STEP) {
  return `+${entriesLabel(step * n, language)}`
}

/** Value of one entry in a raffle (1 normally, e.g. 1.5 on special days) */
export function entryValueOf(raffle: { entryValue?: number }) {
  return raffle && raffle.entryValue > 0 ? raffle.entryValue : 1
}

/** Total entries with n boosts, e.g. "4 entries" */
function multLabel(value: number, language = 'en', base = 1) {
  return entriesLabel(base + BOOST_STEP * value, language)
}

/** Line shown on the raffle message when entries are worth more than 1 */
export function entryNote(raffle: { entryValue?: number }, language: string) {
  const value = entryValueOf(raffle)
  if (value === 1) return ''
  return loc('entry_special', language).replace('$value', `${+value.toFixed(2)}`)
}

/** Label for one boost, e.g. "+1 entry" */
export function boostLabel(language = 'en', step = BOOST_STEP) {
  return pctLabel(1, language, step)
}

/** "🔥 Boosts are worth x2 today!" (empty when the multiplier is 1) */
export function multiplierNote(raffle: any, language: string) {
  const mult = multiplierOf(raffle)
  if (mult === 1) return ''
  return loc('boost_multiplier', language).replace('$mult', `${+mult.toFixed(2)}`)
}

/** Count how many boosts each user bought in a raffle */
export function boostCounts(raffle: Raffle) {
  const counts = new Map<number, number>()
  for (const id of raffle.boostIds || []) {
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  return counts
}

/**
 * Boost value per user: each boost counts as the multiplier in force when it was
 * bought (x1 for boosts saved before multipliers existed)
 */
export function boostValues(raffle: Raffle) {
  const values = new Map<number, number>()
  const ids = raffle.boostIds || []
  const mults = raffle.boostMults || []
  // boostMults is always appended together with boostIds, so it lines up with the
  // END of boostIds; older boosts (bought before multipliers existed) have no entry
  const offset = Math.max(0, ids.length - mults.length)
  ids.forEach((id, i) => {
    const m = i >= offset ? mults[i - offset] : 1
    values.set(id, (values.get(id) || 0) + (m >= 1 ? m : 1))
  })
  return values
}

/** Weight of a participant: entry value + step * boosts */
export function weightFor(
  counts: Map<number, number>,
  id: number,
  base = 1,
  step = BOOST_STEP
) {
  return base + step * (counts.get(id) || 0)
}

/** Weighted random index over the given weights */
export function weightedIndex(weights: number[]) {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r < 0) return i
  }
  return weights.length - 1
}

/** Line added to the default raffle message so everybody knows boosts exist */
/** "1⭐" or, when crypto is on, "1⭐ / 0.02 USDT" (price of one boost unit) */
function priceTag() {
  return `${BOOST_PRICE}⭐${cryptoEnabled() ? ` / ${cryptoPriceLabel(1)} USDT` : ''}`
}

export function boostNote(raffle: Raffle, language: string) {
  if (!raffle.boostEnabled) return ''
  const multNote = multiplierNote(raffle, language)
  return `\n\n${loc('boost_note', language)
    .replace('$price⭐', priceTag())
    .replace('$mult', boostLabel(language, stepOf(raffle)))
    .replace('$max', `${maxBoosts()}`)}${multNote ? `\n${multNote}` : ''}`
}

/**
 * "Boost your odds" block of the raffle message (layout 2):
 * header, rate per ⭐ (adapts to the multiplier) and boosted entries so far.
 * extra = boosted entries bought so far (0 → "No boosts yet")
 */
export function boostBlock(language: string, extra: number) {
  const n = Math.round(stepOf())
  const rate = loc(n === 1 ? 'boost_rate_one' : 'boost_rate_many', language)
    .replace('$price⭐', priceTag())
    .replace('$n', `${n}`)
  const tag =
    multiplierOf() > 1
      ? ` ${loc('boost_mult_tag', language).replace('$mult', `${+multiplierOf().toFixed(2)}`)}`
      : ''
  const count =
    extra > 0
      ? loc('boost_count', language).replace('$n', `${extra}`)
      : loc('boost_first', language)
  return `${loc('boost_header', language)}\n${rate}${tag}\n${count}`
}

/** Boost button row for the raffle message */
export function boostButton(raffle: Raffle & { id?: string }, language: string) {
  return [
    {
      text: cryptoEnabled() ? 'Boost ⭐️ or USDT' : `${loc('boost_button', language)} ⭐`,
      callback_data: `b~${raffle.id}`,
    },
  ]
}

/** Checks that the raffle is open, boostable and the user can still boost */
async function validateBoost(raffleId: string, userId: number, amount = 1) {
  let raffle
  try {
    raffle = await RaffleModel.findById(raffleId).select('-participantsIds')
  } catch {
    raffle = undefined
  }
  if (!raffle) return { error: 'please_retry' as string }
  const chat = await findChat(raffle.chatId)
  const language = chat.language
  if (!raffle.boostEnabled) return { error: 'boost_disabled', language, raffle }
  if (raffle.winners) return { error: 'raffle_over', language, raffle }
  const isIn = await RaffleModel.countDocuments({
    _id: raffle._id,
    participantsIds: userId,
  })
  if (!isIn) return { error: 'boost_join_first', language, raffle }
  const used = boostCounts(raffle).get(userId) || 0
  const value = boostValues(raffle).get(userId) || 0
  if (used + amount > maxBoosts()) {
    return { error: 'boost_max', language, raffle, used, value }
  }
  return { raffle, language, used, value }
}

function errorText(key: string, language = 'en') {
  return loc(key, language).replace('$max', `${maxBoosts()}`)
}

/** Private chat: show the boost packs the user can still buy */
async function sendBoostOptions(ctx: ContextMessageUpdate, raffleId: string) {
  const res = await validateBoost(raffleId, ctx.from.id)
  if (res.error) {
    return ctx.reply(errorText(res.error, res.language))
  }
  // Telegram requires users to accept the terms before purchasing
  if (!(await hasAcceptedTerms(ctx.from.id))) {
    return ctx.replyWithHTML(
      `${termsText(res.language)}\n\n${loc('terms_accept_prompt', res.language)}`,
      {
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: loc('terms_accept_button', res.language),
                callback_data: `t~${raffleId}`,
              },
            ],
          ],
        },
      }
    )
  }
  await trackBoost({ type: 'menu', userId: ctx.from.id, raffleId })
  const left = maxBoosts() - res.used
  const options = BOOST_OPTIONS.filter((n) => n <= left)
  const keyboard = options.map((n) => {
    const row: any[] = [
      {
        text: `${n * BOOST_PRICE}⭐ · ${pctLabel(n, res.language, stepOf(res.raffle))}`,
        callback_data: `b~${raffleId}~${n}`,
      },
    ]
    if (cryptoEnabled()) {
      row.push({
        text: `🟢 ${cryptoPriceLabel(n)} USDT`,
        callback_data: `c~${raffleId}~${n}`,
      })
    }
    return row
  })
  return ctx.reply(
    `${multiplierNote(res.raffle, res.language)}${
      multiplierNote(res.raffle, res.language) ? '\n' : ''
    }${loc('boost_choose', res.language)
      .replace('$free', entriesLabel(entryValueOf(res.raffle), res.language))
      .replace('$step', `+${entriesLabel(stepOf(res.raffle), res.language)}`)
      .replace('$mult', multLabel(res.value, res.language, entryValueOf(res.raffle)))
      .replace('$used', `${res.used}`)
      .replace('$max', `${maxBoosts()}`)}`,
    { reply_markup: { inline_keyboard: keyboard } }
  )
}

/** Sends the Stars invoice for a pack of n boosts */
async function sendBoostInvoice(
  ctx: ContextMessageUpdate,
  raffleId: string,
  n: number
) {
  const res = await validateBoost(raffleId, ctx.from.id, n)
  if (res.error) {
    return ctx.reply(errorText(res.error, res.language))
  }
  const language = res.language
  await trackBoost({ type: 'invoice', userId: ctx.from.id, raffleId, boosts: n })
  await (ctx.telegram as any).callApi('sendInvoice', {
    chat_id: ctx.chat.id,
    title: loc('boost_invoice_title', language).replace(
      '$pct',
      pctLabel(n, language, stepOf(res.raffle))
    ),
    description: loc('boost_invoice_description', language)
      .replace('$pct', pctLabel(n, language, stepOf(res.raffle)))
      .replace(
        '$mult',
        multLabel(res.value + n * multiplierOf(), language, entryValueOf(res.raffle))
      )
      .replace('$after', `${res.used + n}`)
      .replace('$max', `${maxBoosts()}`),
    payload: `${PAYLOAD_PREFIX}${raffleId}:${n}`,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: `Boost ${pctLabel(n, language, stepOf(res.raffle))}`, amount: n * BOOST_PRICE }],
  })
}

const escHtml = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Public feed message when the (first) winner of a giveaway had bought a Boost */
export async function notifyBoostWin(
  telegram: any,
  raffle: { chatId: number; messageId?: number },
  winner: { id: number; username?: string; name: string },
  info: { stars: number; entries: number; boosts?: number; mult?: number; crypto?: boolean }
) {
  const feed = (process.env.BOOST_FEED_CHAT || '').trim()
  if (!feed) return
  try {
    let link = ''
    try {
      const c: any = await telegram.getChat(raffle.chatId)
      if (raffle.messageId) {
        const internal = `${raffle.chatId}`.replace(/^-100/, '')
        link = c.username
          ? `https://t.me/${c.username}/${raffle.messageId}`
          : `${raffle.chatId}`.startsWith('-100')
          ? `https://t.me/c/${internal}/${raffle.messageId}`
          : ''
      }
    } catch {
      // no link
    }
    const who = winner.username
      ? escHtml(`@${winner.username}`)
      : `<a href="tg://user?id=${winner.id}">${escHtml(winner.name)}</a>`
    const text =
      `🏆 <b>${who} won a giveaway with a Boost!</b>\n` +
      `${info.crypto ? '🟢 Paid in USDT' : `⭐ ${info.stars} Stars`} · <b>${entriesLabel(info.entries, 'en')}</b>` +
      (link ? `\n🔗 <a href="${link}">Giveaway</a>` : '')
    let sent = false
    try {
      const image = await require('./boostImage').renderBoostImage({
        name: winner.username ? `@${winner.username}` : winner.name,
        stars: info.stars,
        entries: info.entries,
        boosts: info.boosts,
        winner: true,
        crypto: !!info.crypto,
      })
      await telegram.sendPhoto(
        feed,
        { source: image },
        { caption: text, parse_mode: 'HTML', disable_notification: true }
      )
      sent = true
    } catch (err) {
      console.error('Boost win image failed, sending text', err)
    }
    if (!sent) {
      await telegram.sendMessage(feed, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: true,
      })
    }
  } catch (err) {
    console.error('Boost win feed message failed', err)
  }
}

/** Private notification to the bot owner (ADMIN) for every paid boost */
async function notifyOwner(
  ctx: any,
  info: {
    crypto?: string
    userId: number
    stars: number
    n: number
    chatId: number
    mult: string
    total: number
    messageId?: number
    step?: number
  }
) {
  const admin = parseInt(process.env.ADMIN, 10)
  const feed = (process.env.BOOST_FEED_CHAT || '').trim()
  if (!admin && !feed) return
  try {
    const u = ctx.from
    const name = u.username
      ? `@${u.username}`
      : `${u.first_name}${u.last_name ? ` ${u.last_name}` : ''}`
    let where = `${info.chatId}`
    let link = ''
    try {
      const c: any = await ctx.telegram.getChat(info.chatId)
      where = c.title || where
      if (info.messageId) {
        const internal = `${info.chatId}`.replace(/^-100/, '')
        link = c.username
          ? `https://t.me/${c.username}/${info.messageId}`
          : `${info.chatId}`.startsWith('-100')
          ? `https://t.me/c/${internal}/${info.messageId}`
          : ''
      }
    } catch {
      // keep id
    }
    const step = info.step || BOOST_STEP
    if (admin) {
      try {
        await ctx.telegram.sendMessage(
          admin,
          `🚀 <b>Nuevo boost</b>\n` +
            `👤 <a href="tg://user?id=${info.userId}">${escHtml(name)}</a>\n` +
            `${
              info.crypto ? `🟢 ${info.crypto} USDT (BSC)` : `⭐ ${info.stars} Stars`
            } · ${pctLabel(info.n, 'es', step)}\n` +
            `📢 ${escHtml(where)}\n` +
            `🎯 Ahora tiene: ${info.mult}` +
            (link ? `\n🔗 <a href="${link}">Giveaway</a>` : ''),
          { parse_mode: 'HTML', disable_web_page_preview: true }
        )
      } catch (err) {
        console.error('Owner notification failed', err)
      }
    }
    // Public feed for participants (BOOST_FEED_CHAT = channel or group id), in English
    if (feed) {
      try {
        const who = u.username
          ? escHtml(name)
          : `<a href="tg://user?id=${info.userId}">${escHtml(name)}</a>`
        const mult = multiplierOf()
        const text =
          `🚀 <b>${who} bought a Boost</b>\n` +
          `${info.crypto ? '🟢 USDT' : `⭐ ${info.stars} Stars`} · <b>${pctLabel(info.n, 'en', step)}</b>` +
          (mult > 1 ? ` 🔥 <b>x${+mult.toFixed(2)} today!</b>` : '') +
          `\n🎟 Now has <b>${entriesLabel(info.total, 'en')}</b>` +
          (link ? `\n🔗 <a href="${link}">Giveaway</a>` : '')
        const extra: any = {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          disable_notification: true,
        }
        let sent = false
        try {
          // Card image with the Stars paid and the entries now (needs @napi-rs/canvas)
          const image = await require('./boostImage').renderBoostImage({
            name,
            stars: info.stars,
            entries: Math.round(info.total),
            mult,
            boosts: info.n,
            crypto: !!info.crypto,
            usdt: info.crypto,
          })
          await ctx.telegram.sendPhoto(
            feed,
            { source: image },
            { caption: text, parse_mode: 'HTML', disable_notification: true } as any
          )
          sent = true
        } catch (err) {
          console.error('Boost feed image failed, sending text', err)
        }
        if (!sent) {
          await ctx.telegram.sendMessage(feed, text, extra)
        }
      } catch (err) {
        console.error('Boost feed message failed', err)
      }
    }
  } catch (err) {
    console.error('Boost notification failed', err)
  }
}

/** Parses "boost:<raffleId>:<n>" (n defaults to 1) */
function parsePayload(payload: string) {
  const [raffleId, n] = payload.substr(PAYLOAD_PREFIX.length).split(':')
  return { raffleId, n: Math.max(1, parseInt(n || '1', 10) || 1) }
}

async function refund(ctx: ContextMessageUpdate, userId: number, chargeId: string) {
  try {
    await (ctx.telegram as any).callApi('refundStarPayment', {
      user_id: userId,
      telegram_payment_charge_id: chargeId,
    })
    await PaymentModel.updateOne({ chargeId }, { status: 'refunded' })
    return true
  } catch (err) {
    console.error('Refund failed', chargeId, err)
    return false
  }
}

/** A USDT payment was matched to an order: apply the boost like a Stars payment */
async function applyCryptoPayment(telegram: any, order: any, txHash: string) {
  const userId = order.userId
  const n = order.boosts
  const raffleId = order.raffleId
  const admin = parseInt(process.env.ADMIN, 10)
  const amount = formatUnits(order.amountUnits)
  const res: any = await validateBoost(raffleId, userId, n)
  const language = res.language || 'en'
  const fail = async (key: string) => {
    await CryptoOrderModel.updateOne({ _id: order._id }, { status: 'failed' })
    try {
      await telegram.sendMessage(
        userId,
        `${errorText(key, language)}\n\n${loc('crypto_failed', language)
          .replace('$contact', supportContact())
          .replace('$hash', txHash)}`,
        { parse_mode: 'HTML', disable_web_page_preview: true }
      )
    } catch (err) {
      console.error('Crypto fail notice not sent', err)
    }
    if (admin) {
      try {
        await telegram.sendMessage(
          admin,
          `⚠️ Pago crypto NO aplicado (${key})\n` +
            `👤 ${userId}\n🟢 ${amount} USDT\n🔗 https://bscscan.com/tx/${txHash}\n` +
            `Hay que devolverlo a mano.`,
          { disable_web_page_preview: true }
        )
      } catch {
        // do nothing
      }
    }
  }
  if (res.error) return fail(res.error)
  const upd: any = await RaffleModel.updateOne(
    { _id: res.raffle._id, winners: { $exists: false } },
    {
      $push: {
        boostIds: { $each: Array(n).fill(userId) },
        boostMults: { $each: Array(n).fill(multiplierOf()) },
        cryptoIds: { $each: Array(n).fill(userId) },
      },
    }
  )
  if (!upd || !upd.nModified) return fail('raffle_over')
  await CryptoOrderModel.updateOne({ _id: order._id }, { chatId: res.raffle.chatId })
  const used = res.used + n
  const value = res.value + n * multiplierOf()
  try {
    const fresh = await RaffleModel.findById(res.raffle._id).select('-participantsIds')
    const raffleChat = await findChat(fresh.chatId)
    await require('./raffle').refreshRaffleMessage(telegram, fresh, raffleChat)
  } catch (err) {
    // message may be unchanged or deleted
  }
  await notifyOwner(
    {
      telegram,
      from: {
        id: userId,
        username: order.username,
        first_name: order.firstName || `${userId}`,
        last_name: order.lastName,
      },
    },
    {
      userId,
      stars: n * BOOST_PRICE,
      crypto: amount,
      n,
      chatId: res.raffle.chatId,
      messageId: res.raffle.messageId,
      step: stepOf(res.raffle),
      mult: multLabel(value, 'es', entryValueOf(res.raffle)),
      total: entryValueOf(res.raffle) + BOOST_STEP * value,
    }
  )
  try {
    await telegram.sendMessage(
      userId,
      loc('boost_applied', language)
        .replace('$mult', multLabel(value, language, entryValueOf(res.raffle)))
        .replace('$used', `${used}`)
        .replace('$max', `${maxBoosts()}`)
    )
  } catch (err) {
    console.error('Crypto confirmation not sent', err)
  }
}

/**
 * Setting up the Stars boost: /boost toggle, boost button, invoice and payments
 * @param bot Bot to setup
 */
export function setupBoost(bot: Telegraf<ContextMessageUpdate>) {
  loadMultiplier()
  // Admin toggles boost for the chat (works in chat or via /configRaffle)
  bot.command('boost', async (ctx) => {
    const chatId = await getChatIdForConfig(ctx)
    if (!chatId) return
    const chat = await findChat(chatId)
    chat.boost = !chat.boost
    await chat.save()
    return ctx.reply(
      loc(`boost_${chat.boost}`, chat.language)
        .replace('$price', `${BOOST_PRICE}`)
        .replace('$mult', boostLabel(chat.language)),
      { disable_notification: true }
    )
  })

  // Admin sets the value of each entry for new raffles (special days)
  bot.command('setentryvalue', async (ctx) => {
    const chatId = await getChatIdForConfig(ctx)
    if (!chatId) return
    const chat = await findChat(chatId)
    const text = ((ctx.message || ctx.channelPost) as any).text || ''
    const arg = text.split(/\s+/)[1]
    const value = arg ? parseFloat(arg.replace(',', '.')) : NaN
    if (isNaN(value) || value < 1 || value > 10) {
      return ctx.reply(
        loc('entry_value_format', chat.language).replace(
          '$value',
          `${+(chat.entryValue || 1).toFixed(2)}`
        ),
        { disable_notification: true }
      )
    }
    chat.entryValue = +value.toFixed(2)
    await chat.save()
    return ctx.reply(
      loc('entry_value_set', chat.language).replace('$value', `${chat.entryValue}`),
      { disable_notification: true }
    )
  })

  // Bot owner: global boost multiplier (x1 normal, x2 or x3 on special days)
  bot.command('setboostmultiplier', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    const admin = parseInt(process.env.ADMIN, 10)
    if (ctx.from.id !== admin) return
    const chat = await findChat(admin)
    const text = (ctx.message as any).text || ''
    const arg = text.split(/\s+/)[1]
    const value = arg ? parseFloat(arg.replace(',', '.')) : NaN
    if (isNaN(value) || value < 1 || value > 5) {
      return ctx.reply(
        loc('boost_multiplier_format', chat.language).replace('$mult', `${globalMultiplier}`)
      )
    }
    globalMultiplier = +value.toFixed(2)
    chat.boostMultiplier = globalMultiplier
    await chat.save()
    return ctx.replyWithHTML(
      loc(
        globalMultiplier === 1 ? 'boost_multiplier_off' : 'boost_multiplier_set',
        chat.language
      ).replace('$mult', `${globalMultiplier}`)
    )
  })

  // Bot owner: Stars earned and who paid
  bot.command('stars', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    if (ctx.from.id !== parseInt(process.env.ADMIN, 10)) return
    const ownerChat = await findChat(ctx.from.id)
    const since = ownerChat.statsResetAt
    const sinceMatch: any = since ? { createdAt: { $gte: since } } : {}
    const totals = await PaymentModel.aggregate([
      { $match: sinceMatch },
      { $group: { _id: '$status', stars: { $sum: '$stars' }, count: { $sum: 1 } } },
    ])
    const applied = totals.find((t) => t._id === 'applied') || { stars: 0, count: 0 }
    const refunded = totals.find((t) => t._id === 'refunded') || { stars: 0, count: 0 }
    const last = await PaymentModel.find({ status: 'applied', ...sinceMatch })
      .sort({ createdAt: -1 })
      .limit(20)
    const esc = (t: string) =>
      t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const lines = last.map((pay: any) => {
      const date = pay.createdAt
        ? (() => {
            const parts: any = {}
            new Intl.DateTimeFormat('en-GB', {
              timeZone: 'Europe/Paris',
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
            } as any)
              .formatToParts(new Date(pay.createdAt))
              .forEach((x) => (parts[x.type] = x.value))
            return `${parts.day}/${parts.month} - ${parts.hour}:${parts.minute}`
          })()
        : ''
      const who = `<a href="tg://user?id=${pay.userId}">${esc(
        pay.userName || `${pay.userId}`
      )}</a>`
      return `${date} · ${who} · ${pay.stars}⭐`
    })
    // Funnel: unique people per step
    const funnel = await BoostEventModel.aggregate([
      { $match: sinceMatch },
      { $group: { _id: { type: '$type', ok: '$ok' }, users: { $addToSet: '$userId' }, total: { $sum: 1 } } },
    ])
    const step = (type: string, ok?: boolean) => {
      const rows = funnel.filter(
        (f) => f._id.type === type && (ok === undefined || f._id.ok === ok)
      )
      const users = new Set<number>()
      let total = 0
      for (const r of rows) {
        r.users.forEach((u: number) => users.add(u))
        total += r.total
      }
      return { people: users.size, total }
    }
    const clicks = step('click')
    const menus = step('menu')
    const invoices = step('invoice')
    const payerIds = new Set<number>([
      ...(await PaymentModel.distinct('userId', { status: 'applied', ...sinceMatch })),
      ...(await CryptoOrderModel.distinct('userId', { status: 'paid', ...sinceMatch })),
    ])
    const payers = payerIds.size
    const cryptoPaid = await CryptoOrderModel.aggregate([
      { $match: { status: 'paid', ...sinceMatch } },
      { $group: { _id: null, units: { $sum: '$amountUnits' }, count: { $sum: 1 } } },
    ])
    const cryptoTotal = cryptoPaid[0] || { units: 0, count: 0 }
    const termsTotal = await ChatModel.countDocuments({ termsAccepted: true })
    const pct = (a: number, b: number) =>
      b ? `${Math.round((a / b) * 1000) / 10}%` : '—'
    const funnelText =
      `<b>Embudo Boost</b>\n` +
      `📜 Aceptaron los términos: <b>${termsTotal}</b>\n` +
      `👆 Clic en Boost: <b>${clicks.people}</b> (${clicks.total} clics)\n` +
      `📋 Vieron las opciones: <b>${menus.people}</b>\n` +
      `🧾 Eligieron un pack: <b>${invoices.people}</b>\n` +
      `✅ Pagaron: <b>${payers}</b>\n` +
      `📈 Conversión clic → pago: <b>${pct(payers, clicks.people)}</b>\n\n`
    const text =
      `⭐ <b>Stars</b>\n\n` +
      `Total: <b>${applied.stars}⭐</b> (${applied.count} pagos)\n` +
      `Devueltas: ${refunded.stars}⭐ (${refunded.count})\n` +
      (cryptoEnabled()
        ? `🟢 Crypto: <b>${formatUnits(cryptoTotal.units)} USDT</b> (${cryptoTotal.count} pagos)\n`
        : '') +
      `\n` +
      funnelText +
      `<b>Últimos pagos</b>\n` +
      (lines.length ? lines.join('\n') : 'Aún no hay pagos.')
    return ctx.replyWithHTML(text, { disable_web_page_preview: true })
  })

  // Bot owner: reset the /stars stats to 0 (data is kept, only the counting start changes)
  bot.command('resetstars', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    if (ctx.from.id !== parseInt(process.env.ADMIN, 10)) return
    const chat = await findChat(ctx.from.id)
    chat.statsResetAt = new Date()
    await chat.save()
    return ctx.reply('✅ /stars reset to 0. Counting from now.')
  })

  // Deep link from the boost button: /start boost_<raffleId>
  bot.use(async (ctx, next) => {
    const text = ctx.message && ctx.message.text
    const match = text && /^\/start boost_([a-f0-9]{24})$/.exec(text)
    if (!match || ctx.chat.type !== 'private') return next()
    try {
      await sendBoostOptions(ctx, match[1])
    } catch (err) {
      console.error(err)
      await ctx.reply(loc('please_retry', 'en'))
    }
  })

  // Boost button in the raffle message
  bot.action(/^b~([a-f0-9]{24})$/, async (ctx) => {
    const raffleId = (ctx as any).match[1]
    const res = await validateBoost(raffleId, ctx.from.id)
    const cbId = ctx.callbackQuery.id
    await trackBoost({
      type: 'click',
      userId: ctx.from.id,
      raffleId,
      ok: !res.error,
    })
    if (res.error) {
      try {
        await (ctx.telegram as any).callApi('answerCallbackQuery', {
          callback_query_id: cbId,
          text: errorText(res.error, res.language),
          show_alert: true,
        })
      } catch {
        // do nothing
      }
      return
    }
    // Open private chat with the bot, which sends the invoice
    try {
      await (ctx.telegram as any).callApi('answerCallbackQuery', {
        callback_query_id: cbId,
        url: `https://t.me/${process.env.USERNAME}?start=boost_${raffleId}`,
      })
    } catch {
      // do nothing
    }
  })

  // Terms accepted: store it and show the boost packs
  bot.action(/^t~([a-f0-9]{24})$/, async (ctx) => {
    const raffleId = (ctx as any).match[1]
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    await acceptTerms(ctx.from.id)
    try {
      await sendBoostOptions(ctx, raffleId)
    } catch (err) {
      console.error(err)
    }
  })

  // Pack chosen in private chat: send the invoice
  bot.action(/^b~([a-f0-9]{24})~(\d+)$/, async (ctx) => {
    const raffleId = (ctx as any).match[1]
    const n = parseInt((ctx as any).match[2], 10)
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    if (!BOOST_OPTIONS.includes(n)) return
    try {
      await sendBoostInvoice(ctx, raffleId, n)
    } catch (err) {
      console.error(err)
    }
  })

  // Pack chosen to pay with USDT (BEP20): show the exact amount and the wallet
  bot.action(/^c~([a-f0-9]{24})~(\d+)$/, async (ctx) => {
    const raffleId = (ctx as any).match[1]
    const n = parseInt((ctx as any).match[2], 10)
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    if (!cryptoEnabled() || !BOOST_OPTIONS.includes(n)) return
    try {
      const res: any = await validateBoost(raffleId, ctx.from.id, n)
      if (res.error) return ctx.reply(errorText(res.error, res.language))
      await trackBoost({ type: 'invoice', userId: ctx.from.id, raffleId, boosts: n })
      const u = ctx.from
      const order = await createOrder({
        userId: u.id,
        username: u.username,
        firstName: u.first_name,
        lastName: u.last_name,
        raffleId,
        boosts: n,
      })
      const pct = pctLabel(n, res.language, stepOf(res.raffle))
      const amount = formatUnits(order.amountUnits)
      const caption = loc('crypto_invoice', res.language)
        .replace('$pct', pct)
        .replace('$amount', amount)
        .replace('$address', CRYPTO_WALLET)
        .replace('$min', `${CRYPTO_EXPIRY_MIN}`)
      try {
        const image = await require('./boostImage').renderUsdtImage({ amount, pct })
        return await ctx.replyWithPhoto({ source: image }, { caption, parse_mode: 'HTML' } as any)
      } catch (err) {
        console.error('USDT image failed, sending text', err)
      }
      return ctx.replyWithHTML(caption, { disable_web_page_preview: true })
    } catch (err) {
      console.error(err)
    }
  })

  // Start watching the chain for USDT payments (needs CRYPTO_WALLET)
  startCryptoWatcher((order, txHash) => applyCryptoPayment(bot.telegram, order, txHash))

  // Validate right before Telegram charges the user
  bot.on('pre_checkout_query', async (ctx) => {
    const q = ctx.preCheckoutQuery
    if (!q.invoice_payload.startsWith(PAYLOAD_PREFIX)) {
      return ctx.answerPreCheckoutQuery(false, 'Unknown payment')
    }
    const { raffleId, n } = parsePayload(q.invoice_payload)
    const res = await validateBoost(raffleId, q.from.id, n)
    if (res.error) {
      return ctx.answerPreCheckoutQuery(false, errorText(res.error, res.language))
    }
    return ctx.answerPreCheckoutQuery(true)
  })

  // Payment received: apply the boost (refund if the raffle closed meanwhile)
  bot.on('successful_payment', async (ctx) => {
    const p = (ctx.message as any).successful_payment
    if (!p || !p.invoice_payload.startsWith(PAYLOAD_PREFIX)) return
    const { raffleId, n } = parsePayload(p.invoice_payload)
    const chargeId = p.telegram_payment_charge_id
    const userId = ctx.from.id
    // Idempotency: ignore duplicates
    if (await PaymentModel.countDocuments({ chargeId })) return
    const u = ctx.from
    await PaymentModel.create({
      chargeId,
      userId,
      raffleId,
      stars: p.total_amount,
      boosts: n,
      userName: u.username
        ? `@${u.username}`
        : `${u.first_name}${u.last_name ? ` ${u.last_name}` : ''}`,
    })
    const res = await validateBoost(raffleId, userId, n)
    if (res.raffle) {
      await PaymentModel.updateOne({ chargeId }, { chatId: res.raffle.chatId })
    }
    if (res.error) {
      const ok = await refund(ctx, userId, chargeId)
      return ctx.reply(
        `${errorText(res.error, res.language)}\n\n${loc(
          ok ? 'boost_refunded' : 'boost_refund_failed',
          res.language
        )}`
      )
    }
    const upd: any = await RaffleModel.updateOne(
      { _id: res.raffle._id, winners: { $exists: false } },
      {
        $push: {
          boostIds: { $each: Array(n).fill(userId) },
          boostMults: { $each: Array(n).fill(multiplierOf()) },
        },
      }
    )
    if (!upd || !upd.nModified) {
      const ok = await refund(ctx, userId, chargeId)
      return ctx.reply(
        `${errorText('raffle_over', res.language)}\n\n${loc(
          ok ? 'boost_refunded' : 'boost_refund_failed',
          res.language
        )}`
      )
    }
    const used = res.used + n
    const value = res.value + n * multiplierOf()
    try {
      const fresh = await RaffleModel.findById(res.raffle._id).select(
        '-participantsIds'
      )
      const raffleChat = await findChat(fresh.chatId)
      // Lazy require to avoid a circular import with raffle.ts
      await require('./raffle').refreshRaffleMessage(
        ctx.telegram,
        fresh,
        raffleChat
      )
    } catch (err) {
      // message may be unchanged or deleted
    }
    await notifyOwner(ctx, {
      userId,
      stars: p.total_amount,
      n,
      chatId: res.raffle.chatId,
      messageId: res.raffle.messageId,
      step: stepOf(res.raffle),
      mult: multLabel(value, 'es', entryValueOf(res.raffle)),
      total: entryValueOf(res.raffle) + BOOST_STEP * value,
    })
    return ctx.reply(
      loc('boost_applied', res.language)
        .replace('$mult', multLabel(value, res.language, entryValueOf(res.raffle)))
        .replace('$used', `${used}`)
        .replace('$max', `${maxBoosts()}`)
    )
  })
}
