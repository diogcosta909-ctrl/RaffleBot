// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { ChatModel, findChat } from '../models/chat'
import { PaymentModel } from '../models/payment'
import { hasAcceptedTerms, termsText, acceptTerms } from './terms'
import { starsEnabled } from './payMode'
import { loc } from './locale'
import {
  cryptoEnabled,
  createOrder,
  formatUnits,
  networkLabel,
  walletOf,
  CRYPTO_EXPIRY_MIN,
} from './cryptoPay'
import { editScreen, pickNetwork } from './boost'

// Auto-Boost Pass: one payment = 30 days of Auto-Boost in every giveaway, with no limit and no Boosts spent.
// PASS_OPTIONS="Boosts:Stars:USDT,..." (defaults below). Texts are in English (they go to the bot's users).

export interface PassOption {
  n: number
  stars: number
  usdt: number
}

const DEFAULTS = '1:200:5,2:400:10,3:600:15,5:1000:25'
const DAYS = 30
const DAY = 24 * 60 * 60 * 1000

function parseOptions(raw: string): PassOption[] {
  const list: PassOption[] = []
  for (const part of raw.split(',')) {
    const [n, stars, usdt] = part.trim().split(':')
    const o = { n: parseInt(n, 10), stars: parseInt(stars, 10), usdt: parseFloat((usdt || '').replace(',', '.')) }
    if (o.n > 0 && o.stars > 0 && o.usdt > 0) list.push(o)
  }
  return list
}

export function passOptions(): PassOption[] {
  const list = parseOptions(process.env.PASS_OPTIONS || DEFAULTS)
  return list.length ? list : parseOptions(DEFAULTS)
}

export function passOption(n: number) {
  return passOptions().filter((o) => o.n === n)[0]
}

export function passActive(chat: any) {
  return !!(chat && chat.passUntil && new Date(chat.passUntil).getTime() > Date.now() && chat.passN > 0)
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const boostWord = (n: number) => (n === 1 ? 'Boost' : 'Boosts')

export function dateLabel(d: Date) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Andorra' })
}

/** Starts the Pass, or adds 30 days when it is still running */
export async function activatePass(userId: number, n: number) {
  const chat: any = await findChat(userId)
  const now = Date.now()
  const current = chat.passUntil ? new Date(chat.passUntil).getTime() : 0
  const until = new Date(Math.max(now, current) + DAYS * DAY)
  await ChatModel.updateOne(
    { chatId: userId },
    { $set: { passUntil: until, passN: n, passWarned: false, passEndedSent: false } }
  )
  return until
}

async function sendPaidMessage(telegram: any, u: any, n: number, until: Date, paid: string) {
  const name = u.username ? `@${u.username}` : `${u.first_name || ''}${u.last_name ? ` ${u.last_name}` : ''}`.trim()
  try {
    await telegram.sendMessage(
      u.id,
      `👑 <b>Auto-Boost Pass is active</b>\n\n` +
        `🚀 <b>${n} ${boostWord(n)}</b> in every giveaway you join\n` +
        `📅 Valid until <b>${dateLabel(until)}</b>\n` +
        `♾ No limits. No Boosts spent.\n\n` +
        `Just join giveaways. We do the rest.`,
      { parse_mode: 'HTML' }
    )
  } catch (err) {
    console.error('Pass confirmation failed', err)
  }
  const admin = parseInt(process.env.ADMIN, 10)
  if (admin) {
    try {
      await telegram.sendMessage(
        admin,
        `👑 <b>Nuevo Auto-Boost Pass</b>\n\n👤 ${esc(name)} (<code>${u.id}</code>)\n🚀 ${n} por sorteo · hasta ${dateLabel(until)}\n💳 ${paid}`,
        { parse_mode: 'HTML' }
      )
    } catch (err) {
      console.error(err)
    }
  }
}

/** Stars payment of a Pass (payload "pass:N") */
export async function onPassPaid(ctx: any, p: any) {
  const n = parseInt(`${p.invoice_payload}`.substr('pass:'.length), 10) || 0
  const chargeId = p.telegram_payment_charge_id
  if (!n || (await PaymentModel.countDocuments({ chargeId }))) return
  const u = ctx.from
  await PaymentModel.create({
    chargeId,
    userId: u.id,
    raffleId: 'pass',
    stars: p.total_amount,
    boosts: 0,
    userName: u.username ? `@${u.username}` : `${u.first_name}${u.last_name ? ` ${u.last_name}` : ''}`,
  })
  const until = await activatePass(u.id, n)
  await sendPaidMessage(ctx.telegram, u, n, until, `⭐ ${p.total_amount} Stars`)
}

/** USDT payment of a Pass (order with raffleId "pass") */
export async function onPassCrypto(telegram: any, order: any, txHash: string) {
  const until = await activatePass(order.userId, order.boosts)
  const who = { id: order.userId, username: order.username, first_name: order.firstName, last_name: order.lastName }
  await sendPaidMessage(telegram, who, order.boosts, until, `🪙 ${formatUnits(order.amountUnits)} USDT · ${txHash}`)
}

function priceLine(o: PassOption) {
  return `${o.stars}⭐${cryptoEnabled() ? ` / $${o.usdt}` : ''}`
}

async function showPass(ctx: any, edit: boolean) {
  const chat: any = await findChat(ctx.from.id)
  if (!(await hasAcceptedTerms(ctx.from.id))) {
    return ctx.replyWithHTML(`${termsText(chat.language)}\n\n${loc('terms_accept_prompt', chat.language)}`, {
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: loc('terms_accept_button', chat.language), callback_data: 'pta~' }]] },
    })
  }
  const active = passActive(chat)
  const text =
    `👑 <b>Auto-Boost Pass</b>\n\n` +
    `One payment, 30 days.\n` +
    `We boost <b>every giveaway you join</b>, automatically.\n` +
    `♾ No limits · no Boosts spent\n\n` +
    (active
      ? `✅ <b>Active</b> · ${chat.passN} ${boostWord(chat.passN)} per giveaway · until <b>${dateLabel(chat.passUntil)}</b>\n` +
        `Buying again adds 30 days.\n\n`
      : '') +
    `How many Boosts per giveaway? 👇`
  const buttons = passOptions().map((o) => ({
    text: `🚀 ${o.n} ${boostWord(o.n)} · ${priceLine(o)}`,
    callback_data: `ps~${o.n}`,
  }))
  const keyboard: any[] = []
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2))
  keyboard.push([{ text: '← Back', callback_data: 'ab~m' }])
  const extra = { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }
  if (edit) {
    try {
      await editScreen(ctx, text, extra)
      return
    } catch (err) {
      if (/not modified/i.test(`${(err && (err.description || err.message)) || ''}`)) return
    }
  }
  return ctx.replyWithHTML(text, extra)
}

async function answer(ctx: any) {
  try {
    await ctx.answerCbQuery()
  } catch {
    // do nothing
  }
}

export function setupPass(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('pass', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    try {
      await showPass(ctx, false)
    } catch (err) {
      console.error(err)
    }
  })

  // Deep link: /start pass
  bot.use(async (ctx, next) => {
    const text = ctx.message && ctx.message.text
    if (!text || !/^\/start pass$/.test(text) || ctx.chat.type !== 'private') return next()
    try {
      await showPass(ctx, false)
    } catch (err) {
      console.error(err)
    }
  })

  bot.action('ps~m', async (ctx) => {
    await answer(ctx)
    try {
      await showPass(ctx, true)
    } catch (err) {
      console.error(err)
    }
  })

  bot.action('pta~', async (ctx) => {
    await answer(ctx)
    try {
      await acceptTerms(ctx.from.id)
      await showPass(ctx, false)
    } catch (err) {
      console.error(err)
    }
  })

  // Pay-method page for the chosen option
  bot.action(/^ps~(\d+)$/, async (ctx) => {
    await answer(ctx)
    const o = passOption(parseInt((ctx as any).match[1], 10))
    if (!o) return
    try {
      const keyboard: any[] = []
      const row: any[] = []
      if (starsEnabled()) row.push({ text: `⭐ ${o.stars} Stars`, callback_data: `pst~${o.n}` })
      if (cryptoEnabled()) row.push({ text: `🪙 ${o.usdt} USDT`, callback_data: `psc~${o.n}` })
      if (!row.length) return
      keyboard.push(row)
      keyboard.push([{ text: '← Back', callback_data: 'ps~m' }])
      await editScreen(
        ctx,
        `👑 <b>Auto-Boost Pass</b> · ${o.n} ${boostWord(o.n)} per giveaway\n📅 30 days · no limits\n\nHow do you want to pay? 👇`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }
      )
    } catch (err) {
      console.error(err)
    }
  })

  // Stars invoice
  bot.action(/^pst~(\d+)$/, async (ctx) => {
    await answer(ctx)
    const o = passOption(parseInt((ctx as any).match[1], 10))
    if (!o || !starsEnabled()) return
    try {
      await (ctx.telegram as any).callApi('sendInvoice', {
        chat_id: ctx.chat.id,
        title: `Auto-Boost Pass · ${o.n} ${boostWord(o.n)} per giveaway`,
        description: '30 days. We boost every giveaway you join, automatically. No limits.',
        payload: `pass:${o.n}`,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: `Auto-Boost Pass · ${o.n}/giveaway`, amount: o.stars }],
      })
    } catch (err) {
      console.error(err)
    }
  })

  // USDT order
  bot.action(/^psc~(\d+)(?:~(bsc|ton))?$/, async (ctx) => {
    await answer(ctx)
    const o = passOption(parseInt((ctx as any).match[1], 10))
    if (!o || !cryptoEnabled()) return
    try {
      const lang = (await findChat(ctx.from.id)).language
      const network = await pickNetwork(ctx, (ctx as any).match[2], `psc~${o.n}`, lang)
      if (!network) return
      const u = ctx.from
      const order = await createOrder({
        network,
        userId: u.id,
        username: u.username,
        firstName: u.first_name,
        lastName: u.last_name,
        raffleId: 'pass',
        boosts: o.n,
        units: Math.round(o.usdt * 10000),
      })
      const amount = formatUnits(order.amountUnits)
      const caption =
        `👑 <b>Auto-Boost Pass</b> · ${o.n} ${boostWord(o.n)} per giveaway · 30 days\n\n` +
        `1️⃣ Send exactly <i>(tap to copy)</i>\n<code>${amount}</code> USDT\n\n` +
        `2️⃣ To this address <i>(tap to copy)</i> · <b>${networkLabel(network)}</b> only\n<code>${walletOf(network)}</code>\n\n` +
        `⏳ Valid ${CRYPTO_EXPIRY_MIN} min · Pass starts automatically in 1–2 min\n` +
        `⚠️ Send the exact amount, only on ${networkLabel(network)}.`
      try {
        const image = await require('./boostImage').renderUsdtImage({
          amount,
          pct: `Pass · ${o.n}/giveaway`,
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
}

/** Hourly: "ends in 3 days" and "ended" notices, once each */
export async function passSweep(tg: any) {
  const now = new Date()
  const soon = new Date(now.getTime() + 3 * DAY)
  const warn: any[] = await ChatModel.find({ passUntil: { $gt: now, $lte: soon }, passWarned: { $ne: true } })
  for (const c of warn) {
    await ChatModel.updateOne({ chatId: c.chatId }, { $set: { passWarned: true } })
    try {
      await tg.sendMessage(
        c.chatId,
        `👑 <b>Your Auto-Boost Pass ends on ${dateLabel(c.passUntil)}</b>\n\nRenew now and the 30 days are added to what you have left.`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '👑 Renew Pass', callback_data: 'ps~m' }]] } }
      )
    } catch {
      // the person blocked the bot
    }
  }
  const ended: any[] = await ChatModel.find({
    passUntil: { $lte: now, $gt: new Date(now.getTime() - 7 * DAY) },
    passEndedSent: { $ne: true },
  })
  for (const c of ended) {
    await ChatModel.updateOne({ chatId: c.chatId }, { $set: { passEndedSent: true } })
    try {
      await tg.sendMessage(
        c.chatId,
        `👑 <b>Your Auto-Boost Pass has ended</b>\n\nGet it again so you never miss a Boost.`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '👑 Get Pass', callback_data: 'ps~m' }]] } }
      )
    } catch {
      // the person blocked the bot
    }
  }
}
