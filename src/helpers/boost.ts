// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { RaffleModel, Raffle } from '../models'
import { findChat, ChatModel } from '../models/chat'
import { PaymentModel } from '../models/payment'
import { CryptoOrderModel } from '../models/cryptoOrder'
import { MultiBoostModel } from '../models/multiBoost'
import { BoostEventModel, trackBoost } from '../models/boostEvent'
import { CREDIT_PACKS, bonusFor, bestBonus, getCredits, addCredits, removeCredits, spendCreditsSplit } from './credits'
import { acceptTerms, hasAcceptedTerms, termsText, supportContact } from './terms'
import {
  cryptoEnabled,
  networks,
  networkLabel,
  networkShort,
  walletOf,
  Network,
  cryptoPriceLabel,
  createOrder,
  formatUnits,
  startCryptoWatcher,
  CRYPTO_EXPIRY_MIN,
} from './cryptoPay'
import { getChatIdForConfig } from './getChatIdForConfig'
import { raffleTotals, chanceOf, oddsLine, oddsChangeLine } from './odds'
import { loc } from './locale'
import { resolveUser } from './userLookup'

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
/** "1 credit" / "5 credits" */
export function creditsLabel(n: number, language = 'en') {
  return `${n} ${loc(n === 1 ? 'credit_one' : 'credit_many', language)}`
}

/** Short button label: "10+1" (pack + free bonus), "5" without bonus */
function shortPack(n: number) {
  const bonus = bonusFor(n)
  return `${n}${bonus ? `+${bonus}` : ''}`
}

/** "10 credits +1 free" (pack with its bonus) */
function packLabel(n: number, language = 'en') {
  const bonus = bonusFor(n)
  return bonus ? `${creditsLabel(n, language)} +${bonus} ${loc('free_word', language)}` : creditsLabel(n, language)
}

export function pctLabel(n: number, language = 'en', step = BOOST_STEP) {
  return `+${entriesLabel(step * n, language)}`
}

/** Value of one entry in a raffle (1 normally, e.g. 1.5 on special days) */
export function entryValueOf(raffle: { entryValue?: number }) {
  return raffle && raffle.entryValue > 0 ? raffle.entryValue : 1
}

/** Total entries with n boosts, e.g. "4 entries" */
export function multLabel(value: number, language = 'en', base = 1) {
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
  const rate = loc(n === 1 ? 'boost_rate_one' : 'boost_rate_many', language).replace('$n', `${n}`)
  const tag =
    multiplierOf() > 1
      ? ` ${loc('boost_mult_tag', language).replace('$mult', `${+multiplierOf().toFixed(2)}`)}`
      : ''
  const count =
    extra > 0
      ? loc('boost_count', language).replace('$n', `${extra}`)
      : loc('boost_first', language)
  return `${rate}${tag}\n${count}`
}

/** Boost button row for the raffle message */
export function boostButton(raffle: Raffle & { id?: string }, language: string) {
  return [
    {
      text: loc('boost_button', language),
      callback_data: `b~${raffle.id}`,
    },
    {
      text: loc('boost_all_button', language),
      url: `https://t.me/${process.env.USERNAME}?start=boostall`,
    },
  ]
}

/** Checks that the raffle is open, boostable and the user can still boost */
export async function validateBoost(raffleId: string, userId: number, amount = 1) {
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
export async function sendBoostOptions(ctx: ContextMessageUpdate, raffleId: string) {
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
  const credits = await getCredits(ctx.from.id)
  // Chance of winning now and after each pack (same formula as the draw)
  const base = entryValueOf(res.raffle)
  const totals = await raffleTotals(res.raffle._id, base, BOOST_STEP)
  const keyboard: any[] = options.map((n) => {
    // With enough credits only the credits button is shown for that pack
    if (credits >= n) {
      return [
        {
          text: `💰 ${creditsLabel(n, res.language)} · ${pctLabel(n, res.language, stepOf(res.raffle))}`,
          callback_data: `w~${raffleId}~${n}`,
        },
      ]
    }
    const row: any[] = [
      {
        text: `${n * BOOST_PRICE}⭐ · ${pctLabel(n, res.language, stepOf(res.raffle))}`,
        callback_data: `b~${raffleId}~${n}`,
      },
    ]
    if (cryptoEnabled()) {
      row.push({
        text: `🪙 ${cryptoPriceLabel(n)} USDT`,
        callback_data: `c~${raffleId}~${n}`,
      })
    }
    return row
  })
  keyboard.push([{ text: loc('recharge_button', res.language), callback_data: `r~${raffleId}` }])
  let autoLine = ''
  let proofLine = ''
  try {
    const ab = require('./autoBoost')
    const status = await ab.autoBoostStatus(ctx.from.id)
    autoLine = `\n${status.line}`
    keyboard.push([{ text: status.button, callback_data: 'ab~m' }])
    proofLine = await require('./proof').winnersBoostLine()
  } catch (err) {
    console.error(err)
  }
  return ctx.reply(
    `${multiplierNote(res.raffle, res.language)}${
      multiplierNote(res.raffle, res.language) ? '\n' : ''
    }${loc('boost_choose', res.language)
      .replace('$free', entriesLabel(entryValueOf(res.raffle), res.language))
      .replace('$step', `+${entriesLabel(stepOf(res.raffle), res.language)}`)
      .replace('$mult', multLabel(res.value, res.language, entryValueOf(res.raffle)))
      .replace('$used', `${res.used}`)
      .replace('$max', `${maxBoosts()}`)}${
      totals ? `\n${oddsLine(res.language, chanceOf(totals, res.value, base, BOOST_STEP))}` : ''
    }${proofLine ? `\n${proofLine}` : ''}\n\n${loc('boost_credits_line', res.language).replace('$n', `${credits}`)}${autoLine}`,
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
    payload: `${PAYLOAD_PREFIX}${raffleId}:${n}:${+multiplierOf().toFixed(2)}`,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: `Boost ${pctLabel(n, language, stepOf(res.raffle))}`, amount: n * BOOST_PRICE }],
  })
}

/** "🎯 Your chance: 0.4% → 1.6%" after a purchase (empty if it can't be computed) */
export async function chanceAfterBuy(raffle: any, value: number, n: number, language: string, mult: number) {
  try {
    const base = entryValueOf(raffle)
    const totals = await raffleTotals(raffle._id, base, BOOST_STEP)
    if (!totals) return ''
    return `\n${oddsChangeLine(language, totals, value, n * mult, base, BOOST_STEP)}`
  } catch (err) {
    return ''
  }
}

const escHtml = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Private "You won!" message to a winner who had bought Boosts (they opened the bot to pay,
 * so it can reach them). Best effort: errors are ignored.
 */
export async function notifyWinnerPrivate(
  telegram: any,
  raffle: { chatId: number; messageId?: number },
  winner: { id: number; username?: string; name: string },
  info: { stars: number; entries: number; boosts: number; crypto?: boolean; credits?: boolean },
  extraEntries: number
) {
  const userId = winner.id
  const boosts = info.boosts
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
    const lang = (await findChat(userId)).language
    const text = loc('winner_private', lang)
      .replace('$boosts', `${boosts} Boost${boosts === 1 ? '' : 's'}`)
      .replace('$extra', `${Math.max(0, Math.round(extraEntries))}`)
      .replace('$link', link ? `\n\n👉 <a href="${link}">${loc('winner_private_link', lang)}</a>` : '')
    // Same image as the public feed; plain text if it cannot be drawn
    try {
      const image = await require('./boostImage').renderBoostImage({
        name: winner.username ? `@${winner.username}` : winner.name,
        stars: info.stars,
        entries: info.entries,
        boosts: info.boosts,
        winner: true,
        crypto: !!info.crypto,
        credits: !!info.credits,
      })
      await telegram.sendPhoto(userId, { source: image }, { caption: text, parse_mode: 'HTML' })
      return
    } catch (err) {
      // fall through to text
    }
    await telegram.sendMessage(userId, text, { parse_mode: 'HTML', disable_web_page_preview: true })
  } catch (err) {
    // The winner may have blocked the bot: nothing to do
  }
}

/** Public feed message when the (first) winner of a giveaway had bought a Boost */
export async function notifyBoostWin(
  telegram: any,
  raffle: { chatId: number; messageId?: number },
  winner: { id: number; username?: string; name: string },
  info: { stars: number; entries: number; boosts?: number; mult?: number; crypto?: boolean; credits?: boolean }
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
      `${info.credits ? '💰 Paid with Boosts' : info.crypto ? '🪙 Paid in USDT' : `⭐ ${info.stars} Stars`} · <b>${entriesLabel(info.entries, 'en')}</b>` +
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
        credits: !!info.credits,
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
export async function notifyOwner(
  ctx: any,
  info: {
    crypto?: string
    network?: string
    credits?: boolean
    gift?: boolean
    auto?: boolean
    userId: number
    stars: number
    n: number
    chatId: number
    mult: string
    total: number
    messageId?: number
    boostMult?: number
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
              info.credits
                ? `${info.gift ? '🎁' : '💰'} ${creditsLabel(info.n, 'es')}${info.gift ? ' (gift)' : ''}${info.auto ? ' · 🔁 Auto-Boost' : ''}`
                : info.crypto
                ? `🪙 ${info.crypto} USDT (${networkShort(info.network || 'bsc')})`
                : `⭐ ${info.stars} Stars`
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
        const mult = info.boostMult || multiplierOf()
        const text =
          `🚀 <b>${who} bought a Boost</b>\n` +
          `${info.credits ? (info.gift ? '🎁 Gift Boosts' : '💰 Boost balance') : info.crypto ? '🪙 USDT' : `⭐ ${info.stars} Stars`} · <b>${pctLabel(info.n, 'en', step)}</b>${info.auto ? ' · 🔁 Auto-Boost' : ''}` +
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
            credits: !!info.credits,
            gift: !!info.gift,
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
const TOPUP_PREFIX = 'topup:'
const MULTI_PREFIX = 'multi:'

function parsePayload(payload: string) {
  const [raffleId, n, m] = payload.substr(PAYLOAD_PREFIX.length).split(':')
  // Multiplier in force when the invoice was made (0 = old invoice without it)
  const mult = parseFloat(m || '0')
  return { raffleId, n: Math.max(1, parseInt(n || '1', 10) || 1), mult: mult >= 1 ? mult : 0 }
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

/** Confirms a credit recharge to the user and tells the owner */
async function notifyTopup(
  telegram: any,
  u: any,
  n: number,
  paid: string,
  balance: number,
  backId?: string,
  pack?: { credits: number; paid: string; label: string }
) {
  let lang = 'en'
  try {
    lang = (await findChat(u.id)).language
  } catch {
    // keep en
  }
  try {
    const extra: any = { parse_mode: 'HTML' }
    if (backId && backId !== '0') {
      extra.reply_markup = {
        inline_keyboard: [[{ text: loc('topup_back', lang), callback_data: `b~${backId}` }]],
      }
    }
    await telegram.sendMessage(
      u.id,
      loc('topup_done', lang)
        .replace('$added', creditsLabel(n, lang))
        .replace('$n', `${balance}`),
      extra
    )
  } catch (err) {
    console.error('Topup confirmation not sent', err)
  }
  const admin = parseInt(process.env.ADMIN, 10)
  if (admin) {
    try {
      const name = u.username ? `@${u.username}` : `${u.first_name || u.id}${u.last_name ? ` ${u.last_name}` : ''}`
      await telegram.sendMessage(
        admin,
        `💳 <b>Recarga de créditos</b>\n👤 <a href="tg://user?id=${u.id}">${escHtml(name)}</a>\n${paid} · ${creditsLabel(n, 'es')}\n💰 Saldo ahora: ${balance}`,
        { parse_mode: 'HTML' }
      )
    } catch (err) {
      console.error('Topup owner notice failed', err)
    }
  }
  // Public feed (BOOST_FEED_CHAT), in English, with an image
  const feed = (process.env.BOOST_FEED_CHAT || '').trim()
  if (feed) {
    try {
      const name = u.username ? `@${u.username}` : `${u.first_name || u.id}${u.last_name ? ` ${u.last_name}` : ''}`
      const who = u.username ? escHtml(name) : `<a href="tg://user?id=${u.id}">${escHtml(name)}</a>`
      const text = `💳 <b>${who} bought Boosts</b>\n${pack ? pack.label : paid} · ${creditsLabel(n, 'en')}`
      let sent = false
      try {
        const credits = pack ? pack.credits : n
        const image = await require('./boostImage').renderRechargeImage({
          name,
          credits,
          bonus: Math.max(0, n - credits),
          paid: pack ? pack.paid : '',
        })
        await telegram.sendPhoto(feed, { source: image }, { caption: text, parse_mode: 'HTML', disable_notification: true })
        sent = true
      } catch (err) {
        console.error('Recharge image failed, sending text', err)
      }
      if (!sent) {
        await telegram.sendMessage(feed, text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          disable_notification: true,
        })
      }
    } catch (err) {
      console.error('Recharge feed message failed', err)
    }
  }
}

/** A USDT payment was matched to an order: apply the boost like a Stars payment */
async function applyCryptoPayment(telegram: any, order: any, txHash: string) {
  if (order.raffleId === 'topup') {
    const added = order.boosts + bonusFor(order.boosts)
    const balance = await addCredits(order.userId, added, {
      type: 'topup',
      method: 'usdt',
      ref: txHash,
      free: bonusFor(order.boosts),
    })
    const who = {
      id: order.userId,
      username: order.username,
      first_name: order.firstName || `${order.userId}`,
      last_name: order.lastName,
    }
    await notifyTopup(
      telegram,
      who,
      added,
      `🪙 ${formatUnits(order.amountUnits)} USDT`,
      balance,
      order.backRaffleId,
      {
        credits: order.boosts,
        paid: `${cryptoPriceLabel(order.boosts)} USDT`,
        label: `🪙 ${cryptoPriceLabel(order.boosts)} USDT`,
      }
    )
    return
  }
  if (`${order.raffleId}`.startsWith(MULTI_PREFIX)) {
    let multi: any = null
    try {
      multi = await MultiBoostModel.findById(`${order.raffleId}`.substr(MULTI_PREFIX.length))
    } catch {
      multi = null
    }
    const who = { id: order.userId, username: order.username, first_name: order.firstName, last_name: order.lastName }
    if (multi) {
      await applyMulti(telegram, who, multi, {
        method: 'usdt',
        network: order.network || 'bsc',
        txHash,
        amountUnits: order.amountUnits,
      })
    } else {
      // Paid but the purchase is gone: the boosts become credits
      const balance = await addCredits(order.userId, order.boosts, { type: 'refund', method: 'usdt', ref: txHash })
      try {
        await telegram.sendMessage(
          order.userId,
          `${loc('multi_expired', 'en')}\n\n${loc('boost_credits_line', 'en').replace('$n', `${balance}`)}`
        )
      } catch {
        // do nothing
      }
    }
    // The per-giveaway rows carry the sale; this one only held the payment
    await CryptoOrderModel.updateOne({ _id: order._id }, { status: 'multi' })
    return
  }
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
            `👤 ${userId}\n🪙 ${amount} USDT\n🔗 https://bscscan.com/tx/${txHash}\n` +
            `Hay que devolverlo a mano.`,
          { disable_web_page_preview: true }
        )
      } catch {
        // do nothing
      }
    }
  }
  if (res.error) return fail(res.error)
  // Value of the boost = multiplier in force when the order was made
  const mult = order.mult >= 1 ? order.mult : multiplierOf()
  const upd: any = await RaffleModel.updateOne(
    { _id: res.raffle._id, winners: { $exists: false } },
    {
      $push: {
        boostIds: { $each: Array(n).fill(userId) },
        boostMults: { $each: Array(n).fill(mult) },
        cryptoIds: { $each: Array(n).fill(userId) },
      },
    }
  )
  if (!upd || !upd.nModified) return fail('raffle_over')
  await CryptoOrderModel.updateOne({ _id: order._id }, { chatId: res.raffle.chatId })
  const used = res.used + n
  const value = res.value + n * mult
  try {
    const fresh = await RaffleModel.findById(res.raffle._id).select('-participantsIds')
    const raffleChat = await findChat(fresh.chatId)
    await require('./raffle').refreshRaffleMessage(telegram, fresh, raffleChat)
    void overtakeAlerts(telegram, fresh, { id: userId, username: order.username, first_name: order.firstName, last_name: order.lastName }, n, mult)
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
      network: order.network || 'bsc',
      n,
      chatId: res.raffle.chatId,
      messageId: res.raffle.messageId,
      step: BOOST_STEP * mult,
      boostMult: mult,
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
        .replace('$max', `${maxBoosts()}`) + (await chanceAfterBuy(res.raffle, value, n, language, mult))
    )
  } catch (err) {
    console.error('Crypto confirmation not sent', err)
  }
}

/** Network picked for a USDT payment, or the chooser message when there are two */
async function pickNetwork(ctx: ContextMessageUpdate, picked: string | undefined, back: string, lang: string) {
  const nets = networks()
  if (picked && (nets as string[]).indexOf(picked) >= 0) return picked as Network
  if (nets.length === 1) return nets[0]
  const label: any = { bsc: '🟡 BNB Chain (BEP20)', ton: '🔷 TON' }
  await ctx.reply(loc('crypto_network', lang), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [nets.map((n) => ({ text: label[n], callback_data: `${back}~${n}` }))],
    },
  } as any)
  return undefined
}

/**
 * Setting up the Stars boost: /boost toggle, boost button, invoice and payments
 * @param bot Bot to setup
 */
/** "Best deal: 50+7 = 57 credits" for the largest pack that has free credits ('' when none) */
function bestBonusNote(lang: string) {
  const b = bestBonus()
  if (!b) return ''
  return loc('recharge_bonus_note', lang)
    .replace(/\$pack/g, `${b.pack}`)
    .replace(/\$bonus/g, `${b.bonus}`)
    .replace('$total', `${b.pack + b.bonus}`)
}

/** "5 Boosts" or "10 +1 free Boosts" (pack with its free bonus) */
export function packText(n: number, lang: string) {
  const bonus = bonusFor(n)
  return bonus ? `${n} +${bonus} ${loc('free_word', lang)} ${loc('credit_many', lang)}` : creditsLabel(n, lang)
}

const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

/** Packs as a monospace table (Boosts | Stars | USDT), shown in the recharge text */
function packList(lang: string) {
  const crypto = cryptoEnabled()
  const rows = CREDIT_PACKS.map((n) => {
    const bonus = bonusFor(n)
    return [`${n}${bonus ? ` +${bonus}` : ''}`, `${n * BOOST_PRICE}⭐`, crypto ? cryptoPriceLabel(n) : '']
  })
  const head = ['Boosts', 'Stars', crypto ? 'USDT' : '']
  const all = [head].concat(rows)
  const w0 = Math.max(...all.map((r) => r[0].length)) + 3
  const w1 = Math.max(...all.map((r) => r[1].length)) + 3
  const lines = all.map((r) => `${pad(r[0], w0)}${crypto ? pad(r[1], w1) + r[2] : r[1]}`)
  return `<pre>${lines.join('\n')}</pre>`
}

function pad(s: string, w: number) {
  let out = s
  while (out.length < w) out += ' '
  return out
}

/** Pack buttons (3 per row) to choose a pack; with USDT on they ask how to pay next */
function packNumberKeyboard(raffleId: string, lang: string) {
  const crypto = cryptoEnabled()
  const buttons = CREDIT_PACKS.map((n) => {
    const bonus = bonusFor(n)
    return {
      text: `${n}${bonus ? ` +${bonus}` : ''} ${loc(n === 1 && !bonus ? 'credit_one' : 'credit_many', lang)}`,
      callback_data: crypto ? `ap~${n}~${raffleId}` : `ts~${n}~${raffleId}`,
    }
  })
  const rows: any[] = []
  for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3))
  return rows
}

/** Edits the message the button was pressed on (sends a new one if it cannot be edited) */
async function showScreen(ctx: ContextMessageUpdate, text: string, keyboard: any[], edit: boolean) {
  const extra: any = { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }
  if (edit) {
    try {
      await ctx.editMessageText(text, extra)
      return
    } catch (err) {
      const msg = `${(err && (err.description || err.message)) || ''}`
      if (/not modified/i.test(msg)) return
    }
  }
  await ctx.replyWithHTML(text, { reply_markup: { inline_keyboard: keyboard } } as any)
}

/** Buttons with the packs of one payment method: 's' = Stars, 'c' = USDT (one pack per row) */
function packKeyboard(method: 's' | 'c', lang: string, raffleId: string, withBack: boolean) {
  const keyboard: any[] = CREDIT_PACKS.map((n) => {
    const price = method === 's' ? `${n * BOOST_PRICE} ⭐` : `${cryptoPriceLabel(n)} USDT`
    return [{ text: `${packText(n, lang)} · ${price}`, callback_data: `t${method}~${n}~${raffleId}` }]
  })
  if (withBack) keyboard.push([{ text: loc('back_btn', lang), callback_data: `rb~${raffleId}` }])
  return keyboard
}

/**
 * The recharge screen. With USDT on: packs listed in the text + "Pay with Stars / USDT" buttons
 * (the packs to tap come next). With Stars only: the packs to tap right away.
 * raffleId = giveaway to come back to, or '0'
 */
export async function sendRecharge(ctx: ContextMessageUpdate, raffleId: string, edit = false) {
  try {
    const lang = (await findChat(ctx.from.id)).language
    const credits = await getCredits(ctx.from.id)
    const both = cryptoEnabled()
    const text = loc('recharge_text', lang)
      .replace('$pct', pctLabel(1, lang))
      .replace('$packs', packList(lang))
      .replace('$n', `${credits}`)
      .replace('$choose', loc('choose_pack', lang))
    const keyboard: any[] = packNumberKeyboard(raffleId, lang)
    if (raffleId !== '0') {
      keyboard.push([{ text: loc('topup_back', lang), callback_data: `b~${raffleId}` }])
    }
    await showScreen(ctx, text, keyboard, edit)
  } catch (err) {
    console.error(err)
  }
}

// ---------- Boost all giveaways: the same boosts in every active giveaway of the user, paid once ----------

/** Plural words for the multi-boost texts */
function boostWord(n: number) {
  return n === 1 ? 'Boost' : 'Boosts'
}
function giveawayWord(k: number, lang: string) {
  return lang === 'es' ? (k === 1 ? 'sorteo' : 'sorteos') : k === 1 ? 'giveaway' : 'giveaways'
}
function creditWord(n: number, lang: string) {
  return n === 1 ? 'Boost' : 'Boosts'
}

/** Open giveaways (with Boosts on) where the user takes part and can still boost */
async function activeRafflesOf(userId: number) {
  const list: any[] = await RaffleModel.find({
    participantsIds: userId,
    boostEnabled: true,
    winners: { $exists: false },
  }).select('-participantsIds')
  return list
    .map((r) => ({ raffle: r, used: boostCounts(r).get(userId) || 0 }))
    .filter((x) => x.used < maxBoosts())
}

/** Giveaways chosen by scope ('a' all, 'f' only where the user has not boosted yet) that have room for n more boosts */
async function multiSelection(userId: number, scope: string, n = 1) {
  const list = await activeRafflesOf(userId)
  return list.filter((x) => (scope !== 'f' || x.used === 0) && maxBoosts() - x.used >= n)
}

/** First screen: all giveaways or only the ones without boosts */
async function showMulti(ctx: ContextMessageUpdate, edit = false) {
  const userId = ctx.from.id
  const lang = (await findChat(userId)).language
  if (!(await hasAcceptedTerms(userId))) {
    return ctx.replyWithHTML(`${termsText(lang)}\n\n${loc('terms_accept_prompt', lang)}`, {
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: loc('terms_accept_button', lang), callback_data: 'tm~' }]],
      },
    } as any)
  }
  const list = await activeRafflesOf(userId)
  if (!list.length) return showScreen(ctx, loc('multi_none', lang), [], edit)
  await trackBoost({ type: 'multi_menu', userId })
  const fresh = list.filter((x) => x.used === 0).length
  const keyboard: any[] = [
    [{ text: loc('multi_btn_all', lang).replace('$n', `${list.length}`), callback_data: 'ba~a' }],
  ]
  if (list.length > 1 && fresh > 0) {
    keyboard.push([{ text: loc('multi_btn_new', lang).replace('$n', `${fresh}`), callback_data: 'ba~f' }])
  }
  const text = loc('multi_menu', lang).replace('$n', `${list.length}`)
  // Only one possible choice: skip the question
  if (keyboard.length === 1) return showPickMulti(ctx, 'a', edit)
  return showScreen(ctx, text, keyboard, edit)
}

/** How many boosts in each giveaway */
async function showPickMulti(ctx: ContextMessageUpdate, scope: string, edit = false) {
  const userId = ctx.from.id
  const lang = (await findChat(userId)).language
  const keyboard: any[] = []
  let first = 0
  for (const n of BOOST_OPTIONS) {
    const k = (await multiSelection(userId, scope, n)).length
    if (!k) continue
    if (!first) first = k
    keyboard.push([
      { text: k === 1 ? `🚀 ${n} Boost${n === 1 ? '' : 's'}` : loc('multi_btn_n', lang).replace('$n', `${n}`).replace('$b', 'Boost' + (n === 1 ? '' : 's')).replace('$k', `${k}`), callback_data: `ba~${scope}~${n}` },
    ])
  }
  if (!keyboard.length) return showScreen(ctx, loc('multi_none', lang), [], edit)
  keyboard.push([{ text: loc('multi_btn_back', lang), callback_data: 'ba~0' }])
  const all = (await multiSelection(userId, scope, 1)).length
  return showScreen(ctx, all === 1 ? loc('multi_pick_one', lang) : loc('multi_pick', lang).replace('$k', `${all}`), keyboard, edit)
}

/** Payment screen for n boosts in each selected giveaway */
async function showPayMulti(ctx: ContextMessageUpdate, scope: string, n: number, edit = false) {
  const userId = ctx.from.id
  const lang = (await findChat(userId)).language
  const picked = await multiSelection(userId, scope, n)
  if (!picked.length) return showScreen(ctx, loc('multi_none', lang), [], edit)
  const multi: any = await MultiBoostModel.create({
    userId,
    raffleIds: picked.map((x) => `${x.raffle._id}`).join(','),
    n,
    mult: multiplierOf(),
  })
  const k = picked.length
  const total = n * k
  await trackBoost({ type: 'multi_pay', userId, boosts: total })
  const credits = await getCredits(userId)
  const keyboard: any[] = []
  if (credits >= total) {
    keyboard.push([{ text: `💰 ${creditsLabel(total, lang)}`, callback_data: `bp~w~${multi._id}` }])
  } else {
    keyboard.push([{ text: `⭐ ${total * BOOST_PRICE} Stars`, callback_data: `bp~s~${multi._id}` }])
    if (cryptoEnabled()) {
      keyboard.push([{ text: `🪙 ${cryptoPriceLabel(total)} USDT`, callback_data: `bp~c~${multi._id}` }])
    }
    keyboard.push([{ text: loc('recharge_button', lang), callback_data: 'r~0' }])
  }
  keyboard.push([{ text: loc('multi_btn_back', lang), callback_data: `ba~${scope}` }])
  const text = loc(k === 1 ? 'multi_pay_one' : 'multi_pay', lang)
    .replace('$n', `${n}`)
    .replace('$b', boostWord(n))
    .replace('$k', `${k}`)
    .replace('$g', giveawayWord(k, lang))
    .replace('$tb', boostWord(total))
    .replace('$t', `${total}`)
    .replace('$c', `${credits}`)
  return showScreen(ctx, text, keyboard, edit)
}

/**
 * Applies the purchase to every chosen giveaway. Credits are charged one giveaway at a time;
 * with Stars or USDT (already paid) what cannot be applied (ended, at the limit) is returned as credits.
 */
async function applyMulti(
  telegram: any,
  user: { id: number; username?: string; first_name?: string; last_name?: string },
  multi: any,
  pay: { method: 'credits' | 'stars' | 'usdt'; chargeId?: string; network?: string; txHash?: string; amountUnits?: number }
) {
  const ids = `${multi.raffleIds}`.split(',').filter(Boolean)
  const n = multi.n
  const mult = multi.mult >= 1 ? multi.mult : multiplierOf()
  const userId = user.id
  const name = user.username
    ? `@${user.username}`
    : `${user.first_name || userId}${user.last_name ? ` ${user.last_name}` : ''}`
  const lang = (await findChat(userId)).language
  const share = pay.amountUnits ? Math.round(pay.amountUnits / Math.max(1, ids.length)) : 0
  let ok = 0
  let failed = 0
  let returned = 0
  const notices: any[] = []
  for (let i = 0; i < ids.length; i++) {
    const raffleId = ids[i]
    const res: any = await validateBoost(raffleId, userId, n)
    let good = !res.error
    let spentFree = 0
    if (good && pay.method === 'credits') {
      const sp = await spendCreditsSplit(userId, n, {
        raffleId,
        chatId: res.raffle.chatId,
        name,
      })
      if (sp.balance < 0) good = false
      else spentFree = sp.free
    }
    if (good) {
      const push: any = {
        boostIds: { $each: Array(n).fill(userId) },
        boostMults: { $each: Array(n).fill(mult) },
      }
      if (pay.method === 'credits') push.creditIds = { $each: Array(n).fill(userId) }
      if (pay.method === 'usdt') push.cryptoIds = { $each: Array(n).fill(userId) }
      const upd: any = await RaffleModel.updateOne(
        { _id: res.raffle._id, winners: { $exists: false } },
        { $push: push }
      )
      if (!upd || !upd.nModified) {
        good = false
        if (pay.method === 'credits') {
          await addCredits(userId, n, { type: 'refund', method: 'credits', raffleId, free: spentFree })
        }
      }
    }
    // Accounting rows (one per giveaway, so every client sees its own sales)
    try {
      if (pay.method === 'stars') {
        await PaymentModel.create({
          chargeId: `${pay.chargeId}#${i}`,
          userId,
          raffleId: good ? raffleId : 'topup',
          chatId: good ? res.raffle.chatId : undefined,
          stars: n * BOOST_PRICE,
          boosts: n,
          userName: name,
        })
      } else if (pay.method === 'usdt') {
        await CryptoOrderModel.create({
          userId,
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          raffleId: good ? raffleId : 'topup',
          boosts: n,
          amountUnits: share,
          status: 'paid',
          txHash: pay.txHash,
          chatId: good ? res.raffle.chatId : undefined,
          network: pay.network,
          mult,
          expiresAt: new Date(),
          paidAt: new Date(),
        })
      }
    } catch (err) {
      console.error('Multi boost row not saved', err)
    }
    if (!good) {
      failed++
      if (pay.method !== 'credits') returned += n
      continue
    }
    ok++
    await trackBoost({
      type: 'invoice',
      userId,
      raffleId,
      boosts: n,
      method: pay.method === 'usdt' ? 'crypto' : pay.method === 'credits' ? 'credits' : undefined,
      reminded: true,
    } as any)
    const used = res.used + n
    const value = res.value + n * mult
    try {
      const fresh = await RaffleModel.findById(res.raffle._id).select('-participantsIds')
      const raffleChat = await findChat(fresh.chatId)
      await require('./raffle').refreshRaffleMessage(telegram, fresh, raffleChat)
      void overtakeAlerts(telegram, fresh, user, n, mult)
    } catch (err) {
      // message may be unchanged or deleted
    }
    notices.push({
        userId,
        stars: n * BOOST_PRICE,
        credits: pay.method === 'credits',
        gift: pay.method === 'credits' && spentFree >= n,
        crypto: pay.method === 'usdt' ? cryptoPriceLabel(n) : undefined,
        network: pay.network,
        n,
        chatId: res.raffle.chatId,
        messageId: res.raffle.messageId,
        step: BOOST_STEP * mult,
        boostMult: mult,
        mult: multLabel(value, 'es', entryValueOf(res.raffle)),
        total: entryValueOf(res.raffle) + BOOST_STEP * value,
    })
    void used
  }
  // One combined notice when the purchase touched 3+ giveaways (no spam), one per giveaway otherwise
  if (notices.length >= 3) {
    await notifyMultiOwner(telegram, user, notices, n, pay)
  } else {
    for (const info of notices) await notifyOwner({ telegram, from: user }, info)
  }
  if (returned > 0) {
    await addCredits(userId, returned, {
      type: 'refund',
      method: pay.method,
      ref: pay.chargeId || pay.txHash,
    })
  }
  try {
    await MultiBoostModel.updateOne(
      { _id: multi._id },
      {
        $inc: { payments: 1, boostsApplied: ok * n, giveawaysApplied: ok, returned },
        $set: { method: pay.method, status: 'done' },
      }
    )
  } catch (err) {
    console.error('Multi boost stats not saved', err)
  }
  const balance = await getCredits(userId)
  const lines: string[] = []
  if (ok > 0) {
    lines.push(
      loc('multi_done', lang)
        .replace('$tb', boostWord(ok * n))
        .replace('$t', `${ok * n}`)
        .replace('$k', `${ok}`)
        .replace('$g', giveawayWord(ok, lang))
        .replace('$n', `${n}`)
        .replace('$b', boostWord(n))
    )
  }
  if (failed > 0) {
    const key = pay.method === 'credits' ? 'multi_skipped' : ok > 0 ? 'multi_failed' : 'multi_all_failed'
    lines.push(
      loc(key, lang)
        .replace('$f', `${failed}`)
        .replace('$g', giveawayWord(failed, lang))
        .replace('$rc', creditWord(returned, lang))
        .replace('$r', `${returned}`)
    )
  }
  if (pay.method === 'credits' || returned > 0) {
    lines.push(loc('boost_credits_line', lang).replace('$n', `${balance}`))
  }
  try {
    await telegram.sendMessage(userId, lines.join('\n\n'), { parse_mode: 'HTML' })
  } catch (err) {
    console.error('Multi boost summary not sent', err)
  }
  return { ok, failed, returned }
}

/** One notice (owner + public feed) for a Boost All purchase that touched several giveaways */
async function notifyMultiOwner(
  telegram: any,
  user: { id: number; username?: string; first_name?: string; last_name?: string },
  notices: any[],
  per: number,
  pay: { method: 'credits' | 'stars' | 'usdt'; amountUnits?: number }
) {
  const admin = parseInt(process.env.ADMIN, 10)
  const feed = (process.env.BOOST_FEED_CHAT || '').trim()
  if (!admin && !feed) return
  try {
    const name = user.username
      ? `@${user.username}`
      : `${user.first_name || user.id}${user.last_name ? ` ${user.last_name}` : ''}`
    const k = notices.length
    const boosts = k * per
    const titles: string[] = []
    for (const info of notices) {
      try {
        const c: any = await telegram.getChat(info.chatId)
        const t = c.title || `${info.chatId}`
        if (titles.indexOf(t) < 0) titles.push(t)
      } catch {
        // keep going
      }
    }
    const how =
      pay.method === 'credits'
        ? `${notices.every((x) => x.gift) ? '🎁' : '💰'} ${creditsLabel(boosts, 'es')}`
        : pay.method === 'usdt'
        ? `🪙 ${formatUnits(pay.amountUnits || 0)} USDT`
        : `⭐ ${boosts * BOOST_PRICE} Stars`
    if (admin) {
      try {
        await telegram.sendMessage(
          admin,
          `🚀 <b>Nuevo boost múltiple</b>\n` +
            `👤 <a href="tg://user?id=${user.id}">${escHtml(name)}</a>\n` +
            `🎯 ${k} sorteos · ${per} ${per === 1 ? 'Boost' : 'Boosts'} en cada uno\n` +
            `📦 ${boosts} ${boosts === 1 ? 'Boost' : 'Boosts'} · ${how}\n` +
            `📢 ${titles.map(escHtml).join(', ')}`,
          { parse_mode: 'HTML', disable_web_page_preview: true }
        )
      } catch (err) {
        console.error('Owner multi notification failed', err)
      }
    }
    if (feed) {
      const who = user.username ? escHtml(name) : `<a href="tg://user?id=${user.id}">${escHtml(name)}</a>`
      const caption =
        `🚀 <b>${who} boosted ${k} giveaways</b>\n` +
        `📦 <b>${boosts} ${boosts === 1 ? 'Boost' : 'Boosts'}</b> · ${per} in each`
      try {
        const image = await require('./boostImage').renderMultiImage({
          name,
          giveaways: k,
          boosts,
          per,
          method: pay.method,
        })
        await telegram.sendPhoto(feed, { source: image }, { caption, parse_mode: 'HTML', disable_notification: true } as any)
      } catch (err) {
        console.error('Multi feed image failed, sending text', err)
        try {
          await telegram.sendMessage(feed, caption, { parse_mode: 'HTML', disable_notification: true } as any)
        } catch (e) {
          console.error('Multi feed message failed', e)
        }
      }
    }
  } catch (err) {
    console.error('Multi boost notification failed', err)
  }
}

// ---------- "Someone passed you": private alert to boosters who were overtaken ----------
const overtakeSent = new Map<string, number>()
const OVERTAKE_COOLDOWN_MIN = 60
const OVERTAKE_MAX_PER_BOOST = 3

const escHtmlName = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * After a boost: tells the people who had boosted as much as the buyer (or more) and are now behind.
 * Only people who boosted before; at most 3 per boost and one alert per person and giveaway per hour.
 */
export async function overtakeAlerts(
  telegram: any,
  raffle: any,
  booster: { id: number; username?: string; first_name?: string; last_name?: string },
  n: number,
  mult: number
) {
  try {
    const values = boostValues(raffle)
    const now = (values.get(booster.id) || 0)
    const before = now - n * mult
    const passed: Array<[number, number]> = []
    values.forEach((v, id) => {
      if (id !== booster.id && v > 0 && v >= before && v < now) passed.push([id, v])
    })
    passed.sort((a, b) => b[1] - a[1])
    if (!passed.length) return
    const name = escHtmlName(
      booster.username ? `@${booster.username}` : `${booster.first_name || booster.id}${booster.last_name ? ` ${booster.last_name}` : ''}`
    )
    const raffleId = `${raffle._id}`
    // Link to the giveaway message
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
    const base = entryValueOf(raffle)
    const totals = await raffleTotals(raffle._id, base, BOOST_STEP)
    let sent = 0
    for (const [id, value] of passed) {
      if (sent >= OVERTAKE_MAX_PER_BOOST) break
      const key = `${raffleId}:${id}`
      const last = overtakeSent.get(key) || 0
      if (Date.now() - last < OVERTAKE_COOLDOWN_MIN * 60000) continue
      overtakeSent.set(key, Date.now())
      try {
        const lang = (await findChat(id)).language
        const odds = totals ? `\n${oddsLine(lang, chanceOf(totals, value, base, BOOST_STEP))}` : ''
        const keyboard: any[] = [
          [
            { text: loc('boost_button', lang), url: `https://t.me/${process.env.USERNAME}?start=boost_${raffleId}` },
            { text: loc('boost_all_button', lang), url: `https://t.me/${process.env.USERNAME}?start=boostall` },
          ],
        ]
        if (link) keyboard.push([{ text: loc('overtaken_link', lang), url: link }])
        await telegram.sendMessage(id, loc('overtaken', lang).replace('$name', name).replace('$odds', odds), {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: keyboard },
        })
        sent++
      } catch {
        // the person never opened the bot or blocked it
      }
    }
  } catch (err) {
    console.error('Overtake alerts failed', err)
  }
}

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
    // Boost All
    const multiOpen = (await BoostEventModel.distinct('userId', { type: 'multi_menu', ...sinceMatch })).length
    const multiPay = (await BoostEventModel.distinct('userId', { type: 'multi_pay', ...sinceMatch })).length
    const multiRows: any[] = await MultiBoostModel.aggregate([
      { $match: { payments: { $gt: 0 }, ...sinceMatch } },
      {
        $group: {
          _id: '$method',
          buys: { $sum: '$payments' },
          boosts: { $sum: '$boostsApplied' },
          giveaways: { $sum: '$giveawaysApplied' },
          returned: { $sum: '$returned' },
        },
      },
    ])
    const multiBuyers = (await MultiBoostModel.distinct('userId', { payments: { $gt: 0 }, ...sinceMatch })).length
    const mSum = (key: string) => multiRows.reduce((a, r) => a + (r[key] || 0), 0)
    const mBy = (m: string) => (multiRows.find((r) => r._id === m) || { buys: 0, boosts: 0 })
    const multiText =
      `🎯 <b>Boost All</b>\n` +
      `👆 Lo abrieron: <b>${multiOpen}</b>\n` +
      `🧾 Llegaron al pago: <b>${multiPay}</b>\n` +
      `✅ Compraron: <b>${multiBuyers}</b> personas (${mSum('buys')} compras)\n` +
      `🚀 Boosts: <b>${mSum('boosts')}</b> en ${mSum('giveaways')} sorteos` +
      (mSum('buys') ? ` (media ${Math.round((mSum('giveaways') / mSum('buys')) * 10) / 10} sorteos por compra)` : '') +
      `\n💰 Créditos: ${mBy('credits').buys} · ⭐ Stars: ${mBy('stars').buys} · 🪙 USDT: ${mBy('usdt').buys}\n` +
      `↩️ Devueltos como créditos: ${mSum('returned')}\n` +
      `📈 Conversión abrir → comprar: <b>${pct(multiBuyers, multiOpen)}</b>\n\n`
    let autoText = ''
    try {
      autoText = await require('./autoBoost').autoBoostText()
    } catch {
      autoText = ''
    }
    const text =
      `⭐ <b>Stars</b>\n\n` +
      `Total: <b>${applied.stars}⭐</b> (${applied.count} pagos)\n` +
      `Devueltas: ${refunded.stars}⭐ (${refunded.count})\n` +
      (cryptoEnabled()
        ? `🪙 Crypto: <b>${formatUnits(cryptoTotal.units)} USDT</b> (${cryptoTotal.count} pagos)\n`
        : '') +
      `\n` +
      funnelText +
      multiText +
      `<b>Últimos pagos</b>\n` +
      (lines.length ? lines.join('\n') : 'Aún no hay pagos.')
    await ctx.replyWithHTML(text, { disable_web_page_preview: true })
    // Auto-Boost numbers go in their own message (Telegram limits one message to 4096 characters)
    if (autoText) await ctx.replyWithHTML(autoText.trim(), { disable_web_page_preview: true })
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

  // Deep link from the ranking button: /start recharge
  bot.use(async (ctx, next) => {
    const text = ctx.message && ctx.message.text
    if (!text || !/^\/start recharge$/.test(text) || ctx.chat.type !== 'private') return next()
    try {
      await sendRecharge(ctx, '0')
    } catch (err) {
      console.error(err)
    }
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
  bot.action(/^c~([a-f0-9]{24})~(\d+)(?:~(bsc|ton))?$/, async (ctx) => {
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
      const network = await pickNetwork(ctx, (ctx as any).match[3], `c~${raffleId}~${n}`, res.language)
      if (!network) return
      await trackBoost({ type: 'invoice', userId: ctx.from.id, raffleId, boosts: n, method: 'crypto' })
      const u = ctx.from
      const order = await createOrder({
        network,
        userId: u.id,
        username: u.username,
        firstName: u.first_name,
        lastName: u.last_name,
        raffleId,
        boosts: n,
        mult: multiplierOf(),
      })
      const pct = pctLabel(n, res.language, stepOf(res.raffle))
      const amount = formatUnits(order.amountUnits)
      const caption = loc('crypto_invoice', res.language)
        .replace('$pct', pct)
        .replace('$amount', amount)
        .replace(/\$network/g, networkLabel(network))
        .replace('$address', walletOf(network))
        .replace('$min', `${CRYPTO_EXPIRY_MIN}`)
      try {
        const image = await require('./boostImage').renderUsdtImage({ amount, pct, network: networkLabel(network) })
        return await ctx.replyWithPhoto({ source: image }, { caption, parse_mode: 'HTML' } as any)
      } catch (err) {
        console.error('USDT image failed, sending text', err)
      }
      return ctx.replyWithHTML(caption, { disable_web_page_preview: true })
    } catch (err) {
      console.error(err)
    }
  })

  // RECHARGE: credit packs paid with Stars or USDT (id = raffle to come back to, or 0)
  bot.action(/^r~([a-f0-9]{24}|0)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    return sendRecharge(ctx, (ctx as any).match[1])
  })

  // "Back" from the packs: the recharge screen again, in the same message
  bot.action(/^rb~([a-f0-9]{24}|0)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    return sendRecharge(ctx, (ctx as any).match[1], true)
  })

  // Payment method chosen: show the packs to tap
  bot.action(/^rm~(s|c)~([a-f0-9]{24}|0)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    try {
      const method = (ctx as any).match[1] as 's' | 'c'
      const raffleId = (ctx as any).match[2]
      if (method === 'c' && !cryptoEnabled()) return
      const lang = (await findChat(ctx.from.id)).language
      const text = `${loc(method === 's' ? 'pack_stars_title' : 'pack_usdt_title', lang)}\n\n${loc('choose_pack', lang)}`
      await showScreen(ctx, text, packKeyboard(method, lang, raffleId, true), true)
    } catch (err) {
      console.error(err)
    }
  })

  // Stars invoice for a credit pack
  bot.action(/^ts~(\d+)~([a-f0-9]{24}|0)$/, async (ctx) => {
    const n = parseInt((ctx as any).match[1], 10)
    const raffleId = (ctx as any).match[2]
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    if (CREDIT_PACKS.indexOf(n) < 0) return
    try {
      const lang = (await findChat(ctx.from.id)).language
      await (ctx.telegram as any).callApi('sendInvoice', {
        chat_id: ctx.chat.id,
        title: loc('topup_invoice_title', lang).replace('$n', `${n}`),
        description:
          loc('topup_invoice_description', lang) +
          (bonusFor(n) ? loc('topup_bonus_note', lang).replace('$b', `${bonusFor(n)}`) : ''),
        payload: `${TOPUP_PREFIX}${n}:${raffleId}`,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: packLabel(n, lang), amount: n * BOOST_PRICE }],
      })
    } catch (err) {
      console.error(err)
    }
  })

  // USDT order for a credit pack
  bot.action(/^tc~(\d+)~([a-f0-9]{24}|0)(?:~(bsc|ton))?$/, async (ctx) => {
    const n = parseInt((ctx as any).match[1], 10)
    const raffleId = (ctx as any).match[2]
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    if (!cryptoEnabled() || CREDIT_PACKS.indexOf(n) < 0) return
    try {
      const lang = (await findChat(ctx.from.id)).language
      const network = await pickNetwork(ctx, (ctx as any).match[3], `tc~${n}~${raffleId}`, lang)
      if (!network) return
      const u = ctx.from
      const order = await createOrder({
        network,
        userId: u.id,
        username: u.username,
        firstName: u.first_name,
        lastName: u.last_name,
        raffleId: 'topup',
        boosts: n,
        backRaffleId: raffleId,
      })
      const amount = formatUnits(order.amountUnits)
      const caption = loc('crypto_invoice_topup', lang)
        .replace('$n', packLabel(n, lang))
        .replace('$amount', amount)
        .replace(/\$network/g, networkLabel(network))
        .replace('$address', walletOf(network))
        .replace('$min', `${CRYPTO_EXPIRY_MIN}`)
      try {
        const image = await require('./boostImage').renderUsdtImage({
          amount,
          pct: packLabel(n, lang),
          network: networkLabel(network),
        })
        return await ctx.replyWithPhoto({ source: image }, { caption, parse_mode: 'HTML' } as any)
      } catch (err) {
        console.error('USDT image failed, sending text', err)
      }
      return ctx.replyWithHTML(caption, { disable_web_page_preview: true })
    } catch (err) {
      console.error(err)
    }
  })

  // ---- Boost all giveaways ----
  bot.use(async (ctx, next) => {
    const text = ctx.message && ctx.message.text
    if (!text || !/^\/start boostall$/.test(text) || ctx.chat.type !== 'private') return next()
    try {
      await showMulti(ctx)
    } catch (err) {
      console.error(err)
    }
  })

  bot.action('tm~', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    await acceptTerms(ctx.from.id)
    try {
      await showMulti(ctx)
    } catch (err) {
      console.error(err)
    }
  })

  bot.action(/^ba~(0|a|f)(?:~(\d+))?$/, async (ctx) => {
    const scope = (ctx as any).match[1]
    const n = parseInt((ctx as any).match[2] || '0', 10)
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    try {
      if (scope === '0') return await showMulti(ctx, true)
      if (!n) return await showPickMulti(ctx, scope, true)
      if (!BOOST_OPTIONS.includes(n)) return
      return await showPayMulti(ctx, scope, n, true)
    } catch (err) {
      console.error(err)
    }
  })

  bot.action(/^bp~(w|s|c)~([a-f0-9]{24})(?:~(bsc|ton))?$/, async (ctx) => {
    const method = (ctx as any).match[1]
    const id = (ctx as any).match[2]
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    try {
      const userId = ctx.from.id
      const lang = (await findChat(userId)).language
      const multi: any = await MultiBoostModel.findOne({ _id: id, userId, status: 'open' })
      if (!multi) return ctx.reply(loc('multi_expired', lang))
      const k = `${multi.raffleIds}`.split(',').filter(Boolean).length
      const total = multi.n * k
      if (method === 'w') {
        if ((await getCredits(userId)) < total) return ctx.reply(loc('credit_not_enough', lang))
        // Claim it so a double tap cannot charge twice
        const claimed: any = await MultiBoostModel.findOneAndUpdate(
          { _id: id, userId, status: 'open' },
          { status: 'done' }
        )
        if (!claimed) return
        await applyMulti(ctx.telegram, ctx.from, multi, { method: 'credits' })
        return
      }
      if (method === 's') {
        await (ctx.telegram as any).callApi('sendInvoice', {
          chat_id: ctx.chat.id,
          title: k === 1 ? loc('multi_invoice_title_one', lang) : loc('multi_invoice_title', lang).replace('$k', `${k}`),
          description: loc(k === 1 ? 'multi_invoice_description_one' : 'multi_invoice_description', lang)
            .replace('$n', `${multi.n}`)
            .replace('$b', boostWord(multi.n))
            .replace('$k', `${k}`)
            .replace('$tb', boostWord(total))
            .replace('$t', `${total}`),
          payload: `${MULTI_PREFIX}${id}`,
          provider_token: '',
          currency: 'XTR',
          prices: [{ label: `${total} ${boostWord(total)}`, amount: total * BOOST_PRICE }],
        })
        return
      }
      if (!cryptoEnabled()) return
      const network = await pickNetwork(ctx, (ctx as any).match[3], `bp~c~${id}`, lang)
      if (!network) return
      const u = ctx.from
      const order = await createOrder({
        network,
        userId: u.id,
        username: u.username,
        firstName: u.first_name,
        lastName: u.last_name,
        raffleId: `${MULTI_PREFIX}${id}`,
        boosts: total,
        mult: multi.mult || multiplierOf(),
      })
      const amount = formatUnits(order.amountUnits)
      const caption = loc('crypto_invoice_multi', lang)
        .replace('$k', `${k}`)
        .replace('$t', `${total}`)
        .replace('$amount', amount)
        .replace(/\$network/g, networkLabel(network))
        .replace('$address', walletOf(network))
        .replace('$min', `${CRYPTO_EXPIRY_MIN}`)
      try {
        const image = await require('./boostImage').renderUsdtImage({
          amount,
          pct: `${total} Boosts`,
          network: networkLabel(network),
        })
        return await ctx.replyWithPhoto({ source: image }, { caption, parse_mode: 'HTML' } as any)
      } catch (err) {
        console.error('USDT image failed, sending text', err)
      }
      return ctx.replyWithHTML(caption, { disable_web_page_preview: true })
    } catch (err) {
      console.error(err)
    }
  })

  // Boost paid with credits
  bot.action(/^w~([a-f0-9]{24})~(\d+)$/, async (ctx) => {
    const raffleId = (ctx as any).match[1]
    const n = parseInt((ctx as any).match[2], 10)
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    if (!BOOST_OPTIONS.includes(n)) return
    try {
      const userId = ctx.from.id
      const res: any = await validateBoost(raffleId, userId, n)
      if (res.error) return ctx.reply(errorText(res.error, res.language))
      const mult = multiplierOf()
      const spent = await spendCreditsSplit(userId, n, {
        raffleId,
        chatId: res.raffle.chatId,
        name: ctx.from.username
          ? `@${ctx.from.username}`
          : `${ctx.from.first_name}${ctx.from.last_name ? ` ${ctx.from.last_name}` : ''}`,
      })
      const balance = spent.balance
      if (balance < 0) return ctx.reply(loc('credit_not_enough', res.language))
      const upd: any = await RaffleModel.updateOne(
        { _id: res.raffle._id, winners: { $exists: false } },
        {
          $push: {
            boostIds: { $each: Array(n).fill(userId) },
            boostMults: { $each: Array(n).fill(mult) },
            creditIds: { $each: Array(n).fill(userId) },
          },
        }
      )
      if (!upd || !upd.nModified) {
        await addCredits(userId, n, { type: 'refund', method: 'credits', raffleId, free: spent.free })
        return ctx.reply(errorText('raffle_over', res.language))
      }
      await trackBoost({ type: 'invoice', userId, raffleId, boosts: n, method: 'credits', reminded: true })
      const used = res.used + n
      const value = res.value + n * mult
      try {
        const fresh = await RaffleModel.findById(res.raffle._id).select('-participantsIds')
        const raffleChat = await findChat(fresh.chatId)
        await require('./raffle').refreshRaffleMessage(ctx.telegram, fresh, raffleChat)
        void overtakeAlerts(ctx.telegram, fresh, ctx.from, n, mult)
      } catch (err) {
        // message may be unchanged or deleted
      }
      await notifyOwner(ctx, {
        userId,
        stars: n * BOOST_PRICE,
        credits: true,
        gift: spent.free >= n,
        n,
        chatId: res.raffle.chatId,
        messageId: res.raffle.messageId,
        step: BOOST_STEP * mult,
      boostMult: mult,
        mult: multLabel(value, 'es', entryValueOf(res.raffle)),
        total: entryValueOf(res.raffle) + BOOST_STEP * value,
      })
      await ctx.reply(
        `${loc('boost_applied', res.language)
          .replace('$mult', multLabel(value, res.language, entryValueOf(res.raffle)))
          .replace('$used', `${used}`)
          .replace('$max', `${maxBoosts()}`)}${await chanceAfterBuy(res.raffle, value, n, res.language, mult)}\n${loc('boost_credits_line', res.language).replace('$n', `${balance}`)}`
      )
      // Low balance: right moment to offer a recharge
      if (balance <= 1) {
        await ctx.reply(
          balance === 0
            ? loc('credit_out', res.language)
            : loc('credit_low', res.language).replace('$n', creditsLabel(balance, res.language)),
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: loc('recharge_button', res.language), callback_data: `r~${raffleId}` }],
              ],
            },
          } as any
        )
      }
      return
    } catch (err) {
      console.error(err)
    }
  })

  // Owner: /addcredits <userId> <n> (negative n removes) to fix a balance by hand
  bot.command('addcredits', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    if (ctx.from.id !== parseInt(process.env.ADMIN, 10)) return
    const parts = ((ctx.message as any).text || '').split(/\s+/)
    const n = parseInt(parts[2], 10)
    if (!parts[1] || !n) return ctx.reply('Uso: /addcredits @usuario 5  (o el ID) · n negativo quita créditos')
    const userId = await resolveUser(parts[1])
    if (!userId) {
      return ctx.reply(`No encuentro a ${parts[1]}. Tiene que haber escrito al bot alguna vez; si no, usa su ID.`)
    }
    const balance = await addCredits(userId, n, { type: 'admin', method: 'admin' })
    return ctx.reply(`✅ ${parts[1]}: ${n > 0 ? '+' : ''}${n} créditos. Saldo: ${balance}`)
  })

  // Owner: /removeboosts <@user|id> <n|all> takes Boosts off an account (manual refund). Never below 0
  bot.command('removeboosts', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    if (ctx.from.id !== parseInt(process.env.ADMIN, 10)) return
    const parts = ((ctx.message as any).text || '').split(/\s+/)
    const usage = 'Uso: /removeboosts @usuario 5  (o el ID) · o "all" para quitar todos\nQuita primero los comprados y al final los gratis. Nunca baja de 0.'
    if (!parts[1] || !parts[2]) return ctx.reply(usage)
    const userId = await resolveUser(parts[1])
    if (!userId) {
      return ctx.reply(`No encuentro a ${parts[1]}. Tiene que haber escrito al bot alguna vez; si no, usa su ID.`)
    }
    const before = await getCredits(userId)
    const n = /^all$/i.test(parts[2]) ? before : parseInt(parts[2], 10)
    if (!(n > 0)) return ctx.reply(usage)
    if (before <= 0) return ctx.reply(`${parts[1]} no tiene Boosts (saldo 0). No se ha quitado nada.`)
    const res = await removeCredits(userId, n)
    return ctx.reply(
      `✅ ${parts[1]}: quitados ${res.removed} Boosts${res.removed < n ? ` (pediste ${n}, solo tenía ${before})` : ''}\n` +
        `Saldo: ${before} → ${res.balance}`
    )
  })

  // Start watching the chain for USDT payments (needs CRYPTO_WALLET)
  startCryptoWatcher(async (order, txHash) => {
    try {
      await applyCryptoPayment(bot.telegram, order, txHash)
    } catch (err) {
      // The money arrived but the database failed: the owner must know right away
      console.error('USDT payment not applied', txHash, err)
      const admin = parseInt(process.env.ADMIN, 10)
      if (admin) {
        try {
          const what =
            order.raffleId === 'topup'
              ? `recarga de ${order.boosts + bonusFor(order.boosts)} créditos (/addcredits ${order.userId} ${order.boosts + bonusFor(order.boosts)})`
              : `${order.boosts} boosts`
          await bot.telegram.sendMessage(
            admin,
            `⚠️ <b>Pago USDT recibido pero NO aplicado</b> (error interno)\n` +
              `👤 <code>${order.userId}</code>\n🪙 ${formatUnits(order.amountUnits)} USDT (${networkShort(order.network || 'bsc')})\n` +
              `🧾 ${what}\n🔗 <code>${txHash}</code>\nAplícalo a mano o devuélvelo.`,
            { parse_mode: 'HTML' }
          )
        } catch {
          // nothing else to do
        }
      }
      throw err
    }
  })
  startReminders(bot.telegram)

  // Validate right before Telegram charges the user
  bot.on('pre_checkout_query', async (ctx) => {
    const q = ctx.preCheckoutQuery
    if (q.invoice_payload.startsWith(TOPUP_PREFIX)) {
      return ctx.answerPreCheckoutQuery(true)
    }
    if (q.invoice_payload.startsWith(MULTI_PREFIX)) {
      let multi: any = null
      try {
        multi = await MultiBoostModel.findById(q.invoice_payload.substr(MULTI_PREFIX.length))
      } catch {
        multi = null
      }
      return multi && multi.userId === q.from.id
        ? ctx.answerPreCheckoutQuery(true)
        : ctx.answerPreCheckoutQuery(false, loc('multi_expired', 'en'))
    }
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
    if (p && p.invoice_payload.startsWith(TOPUP_PREFIX)) {
      const [nStr, backId] = p.invoice_payload.substr(TOPUP_PREFIX.length).split(':')
      const n = parseInt(nStr, 10) || 0
      const chargeId = p.telegram_payment_charge_id
      if (!n || (await PaymentModel.countDocuments({ chargeId }))) return
      const u = ctx.from
      await PaymentModel.create({
        chargeId,
        userId: u.id,
        raffleId: 'topup',
        stars: p.total_amount,
        boosts: n,
        userName: u.username ? `@${u.username}` : `${u.first_name}${u.last_name ? ` ${u.last_name}` : ''}`,
      })
      const added = n + bonusFor(n)
      let balance: number
      try {
        balance = await addCredits(u.id, added, { type: 'topup', method: 'stars', ref: chargeId, free: bonusFor(n) })
      } catch (err) {
        // Paid but the credits could not be saved: give the Stars back and tell the owner
        console.error('Topup credits not saved', chargeId, err)
        const ok = await refund(ctx, u.id, chargeId)
        const admin = parseInt(process.env.ADMIN, 10)
        if (admin) {
          try {
            await ctx.telegram.sendMessage(
              admin,
              `⚠️ Recarga con Stars sin aplicar (error interno)\n👤 <code>${u.id}</code> · ${p.total_amount}⭐\n🔗 <code>${chargeId}</code>\n${ok ? '✅ Devueltas automáticamente' : '❌ No se pudo devolver: hazlo a mano'}`,
              { parse_mode: 'HTML' }
            )
          } catch {
            // nothing else to do
          }
        }
        return ctx.reply(`${loc('please_retry', 'en')}\n\n${loc(ok ? 'boost_refunded' : 'boost_refund_failed', 'en')}`)
      }
      await notifyTopup(ctx.telegram, u, added, `⭐ ${p.total_amount} Stars`, balance, backId, {
        credits: n,
        paid: `${p.total_amount} stars`,
        label: `⭐ ${p.total_amount} Stars`,
      })
      return
    }
    if (p && p.invoice_payload.startsWith(MULTI_PREFIX)) {
      const chargeId = p.telegram_payment_charge_id
      if (await PaymentModel.countDocuments({ chargeId: `${chargeId}#0` })) return
      let multi: any = null
      try {
        multi = await MultiBoostModel.findById(p.invoice_payload.substr(MULTI_PREFIX.length))
      } catch {
        multi = null
      }
      const u = ctx.from
      if (!multi) {
        // Paid but the purchase is gone: give the Stars back
        const ok = await refund(ctx, u.id, chargeId)
        return ctx.reply(`${loc('multi_expired', 'en')}\n\n${loc(ok ? 'boost_refunded' : 'boost_refund_failed', 'en')}`)
      }
      await applyMulti(ctx.telegram, u, multi, { method: 'stars', chargeId })
      return
    }
    if (!p || !p.invoice_payload.startsWith(PAYLOAD_PREFIX)) return
    const { raffleId, n, mult: paidMult } = parsePayload(p.invoice_payload)
    // Value of the boost = multiplier in force when the invoice was made
    const mult = paidMult || multiplierOf()
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
          boostMults: { $each: Array(n).fill(mult) },
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
    const value = res.value + n * mult
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
      void overtakeAlerts(ctx.telegram, fresh, ctx.from, n, mult)
    } catch (err) {
      // message may be unchanged or deleted
    }
    await notifyOwner(ctx, {
      userId,
      stars: p.total_amount,
      n,
      chatId: res.raffle.chatId,
      messageId: res.raffle.messageId,
      step: BOOST_STEP * mult,
      boostMult: mult,
      mult: multLabel(value, 'es', entryValueOf(res.raffle)),
      total: entryValueOf(res.raffle) + BOOST_STEP * value,
    })
    return ctx.reply(
      loc('boost_applied', res.language)
        .replace('$mult', multLabel(value, res.language, entryValueOf(res.raffle)))
        .replace('$used', `${used}`)
        .replace('$max', `${maxBoosts()}`) + (await chanceAfterBuy(res.raffle, value, n, res.language, mult))
    )
  })
}

/**
 * Abandoned-payment reminders (one per person and raffle, 10 min after opening the payment):
 * Stars invoices that were never paid, and USDT orders still waiting.
 */
const REMIND_AFTER_MIN = 10

export async function remindOnce(telegram: any) {
  const now = Date.now()
  // Stars invoices left unpaid
  const events: any[] = await BoostEventModel.find({
    type: 'invoice',
    method: 'stars',
    reminded: { $ne: true },
    createdAt: { $lt: new Date(now - REMIND_AFTER_MIN * 60000), $gt: new Date(now - 90 * 60000) },
  }).limit(50)
  for (const e of events) {
    await BoostEventModel.updateOne({ _id: e._id }, { reminded: true })
    try {
      const already = await BoostEventModel.countDocuments({
        userId: e.userId,
        raffleId: e.raffleId,
        reminded: true,
        _id: { $ne: e._id },
      })
      if (already) continue
      const paid =
        (await PaymentModel.countDocuments({
          userId: e.userId,
          raffleId: e.raffleId,
          status: 'applied',
          createdAt: { $gte: e.createdAt },
        })) +
        (await CryptoOrderModel.countDocuments({
          userId: e.userId,
          raffleId: e.raffleId,
          status: 'paid',
          paidAt: { $gte: e.createdAt },
        }))
      if (paid) continue
      const n = e.boosts || 1
      const res: any = await validateBoost(e.raffleId, e.userId, n)
      if (res.error) continue
      const lang = (await findChat(e.userId)).language
      const row: any[] = [
        {
          text: `${n * BOOST_PRICE}⭐ · ${pctLabel(n, lang, stepOf(res.raffle))}`,
          callback_data: `b~${e.raffleId}~${n}`,
        },
      ]
      if (cryptoEnabled()) {
        row.push({ text: `🪙 ${cryptoPriceLabel(n)} USDT`, callback_data: `c~${e.raffleId}~${n}` })
      }
      await telegram.sendMessage(
        e.userId,
        loc('remind_stars', lang).replace('$pct', pctLabel(n, lang, stepOf(res.raffle))),
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [row] } }
      )
    } catch (err) {
      console.error('Stars reminder failed', err)
    }
  }
  // USDT orders still pending
  const orders: any[] = await CryptoOrderModel.find({
    status: 'pending',
    reminded: { $ne: true },
    createdAt: { $lt: new Date(now - REMIND_AFTER_MIN * 60000) },
    expiresAt: { $gt: new Date(now) },
  }).limit(50)
  for (const o of orders) {
    await CryptoOrderModel.updateOne({ _id: o._id }, { reminded: true })
    try {
      const res: any = await validateBoost(o.raffleId, o.userId, o.boosts)
      if (res.error) continue
      const lang = (await findChat(o.userId)).language
      const left = Math.max(1, Math.round((new Date(o.expiresAt).getTime() - now) / 60000))
      await telegram.sendMessage(
        o.userId,
        loc('remind_crypto', lang)
          .replace('$amount', formatUnits(o.amountUnits))
          .replace(/\$network/g, networkLabel(o.network || 'bsc'))
          .replace('$address', walletOf(o.network || 'bsc'))
          .replace('$min', `${left}`),
        { parse_mode: 'HTML', disable_web_page_preview: true }
      )
    } catch (err) {
      console.error('USDT reminder failed', err)
    }
  }
}

function startReminders(telegram: any) {
  setInterval(() => {
    remindOnce(telegram).catch((err) => console.error('Reminders failed', err))
  }, 60 * 1000)
}
