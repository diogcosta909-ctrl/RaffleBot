// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { RaffleModel, Raffle } from '../models'
import { findChat } from '../models/chat'
import { PaymentModel } from '../models/payment'
import { getChatIdForConfig } from './getChatIdForConfig'
import { loc } from './locale'

// Config (env overridable): 1 Star = +0.3 weight (x1.3), max 10 boosts per user per raffle
export const BOOST_PRICE = Math.max(1, parseInt(process.env.BOOST_PRICE || '1', 10))
export const BOOST_STEP = parseFloat(process.env.BOOST_STEP || '0.3')
export const BOOST_MAX = Math.max(1, parseInt(process.env.BOOST_MAX || '10', 10))

// Packs offered in private chat (number of boosts per pack)
export const BOOST_OPTIONS = (process.env.BOOST_OPTIONS || '1,3,5,10')
  .split(',')
  .map((v) => parseInt(v.trim(), 10))
  .filter((v) => v > 0)

const PAYLOAD_PREFIX = 'boost:'

/** "+30%" for n boosts */
function pctLabel(n: number) {
  return `+${Math.round(BOOST_STEP * n * 100)}%`
}

/** Total multiplier label for n boosts, e.g. "x1.9" */
function multLabel(n: number) {
  return `x${+(1 + BOOST_STEP * n).toFixed(2)}`
}

/** Multiplier label for one boost, e.g. "x1.3" */
export function boostLabel() {
  return `x${+(1 + BOOST_STEP).toFixed(2)}`
}

/** Count how many boosts each user bought in a raffle */
export function boostCounts(raffle: Raffle) {
  const counts = new Map<number, number>()
  for (const id of raffle.boostIds || []) {
    counts.set(id, Math.min(BOOST_MAX, (counts.get(id) || 0) + 1))
  }
  return counts
}

/** Weight of a participant: 1 + step * boosts */
export function weightFor(counts: Map<number, number>, id: number) {
  return 1 + BOOST_STEP * (counts.get(id) || 0)
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
export function boostNote(raffle: Raffle, language: string) {
  if (!raffle.boostEnabled) return ''
  return `\n\n${loc('boost_note', language)
    .replace('$price', `${BOOST_PRICE}`)
    .replace('$mult', boostLabel())
    .replace('$max', `${BOOST_MAX}`)}`
}

/** Boost button row for the raffle message */
export function boostButton(raffle: Raffle & { id?: string }, language: string) {
  return [
    {
      text: `${loc('boost_button', language)} ⭐`,
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
  if (used + amount > BOOST_MAX) {
    return { error: 'boost_max', language, raffle, used }
  }
  return { raffle, language, used }
}

function errorText(key: string, language = 'en') {
  return loc(key, language).replace('$max', `${BOOST_MAX}`)
}

/** Private chat: show the boost packs the user can still buy */
async function sendBoostOptions(ctx: ContextMessageUpdate, raffleId: string) {
  const res = await validateBoost(raffleId, ctx.from.id)
  if (res.error) {
    return ctx.reply(errorText(res.error, res.language))
  }
  const left = BOOST_MAX - res.used
  const options = BOOST_OPTIONS.filter((n) => n <= left)
  const keyboard = options.map((n) => [
    {
      text: `${n * BOOST_PRICE}⭐ · ${pctLabel(n)}`,
      callback_data: `b~${raffleId}~${n}`,
    },
  ])
  return ctx.reply(
    loc('boost_choose', res.language)
      .replace('$mult', multLabel(res.used))
      .replace('$used', `${res.used}`)
      .replace('$max', `${BOOST_MAX}`),
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
  await (ctx.telegram as any).callApi('sendInvoice', {
    chat_id: ctx.chat.id,
    title: loc('boost_invoice_title', language).replace('$pct', pctLabel(n)),
    description: loc('boost_invoice_description', language)
      .replace('$pct', pctLabel(n))
      .replace('$mult', multLabel(res.used + n))
      .replace('$after', `${res.used + n}`)
      .replace('$max', `${BOOST_MAX}`),
    payload: `${PAYLOAD_PREFIX}${raffleId}:${n}`,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: `Boost ${pctLabel(n)}`, amount: n * BOOST_PRICE }],
  })
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

/**
 * Setting up the Stars boost: /boost toggle, boost button, invoice and payments
 * @param bot Bot to setup
 */
export function setupBoost(bot: Telegraf<ContextMessageUpdate>) {
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
        .replace('$mult', boostLabel()),
      { disable_notification: true }
    )
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
    await PaymentModel.create({
      chargeId,
      userId,
      raffleId,
      stars: p.total_amount,
    })
    const res = await validateBoost(raffleId, userId, n)
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
      { $push: { boostIds: { $each: Array(n).fill(userId) } } }
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
    return ctx.reply(
      loc('boost_applied', res.language)
        .replace('$mult', `x${+(1 + BOOST_STEP * used).toFixed(2)}`)
        .replace('$used', `${used}`)
        .replace('$max', `${BOOST_MAX}`)
    )
  })
}
