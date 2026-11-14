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
import { editScreen, pickNetwork, BOOST_STEP, BOOST_PRICE } from './boost'
import { showPhoto } from './photoScreen'
import { AutoBoostEventModel, trackAuto } from '../models/autoBoostEvent'
import { CryptoOrderModel } from '../models/cryptoOrder'

// Monthly Pass: one payment = 30 days of Auto-Boost in every giveaway, with no limit and no Boosts spent.
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

/** Example of the saving: 1,000 giveaways with 1 Boost each, in packs vs with the Pass (null when the Pass is not cheaper) */
export function passValue() {
  const one = passOptions().filter((o) => o.n === 1)[0] || passOptions()[0]
  const giveaways = 1000
  const packs = Math.round(giveaways * one.n * BOOST_PRICE)
  const save = Math.round((1 - one.stars / packs) * 100)
  return save > 0 ? { giveaways, packs, pass: one.stars, save } : null
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
  const caption =
    `👑 <b>Monthly Pass is active</b>\n\n` +
    `🚀 <b>${n} ${boostWord(n)}</b> in every giveaway you join\n` +
    `📅 Valid until <b>${dateLabel(until)}</b>\n` +
    `♾ No limits. No Boosts spent.\n\n` +
    `Just join giveaways. We do the rest.`
  try {
    let sent = false
    try {
      const image = await require('./boostImage').renderPassImage({ n, until: dateLabel(until), step: BOOST_STEP })
      await telegram.sendPhoto(u.id, { source: image }, { caption, parse_mode: 'HTML' })
      sent = true
    } catch (err) {
      console.error('Pass image failed, sending text', err)
    }
    if (!sent) await telegram.sendMessage(u.id, caption, { parse_mode: 'HTML' })
  } catch (err) {
    console.error('Pass confirmation failed', err)
  }
  const admin = parseInt(process.env.ADMIN, 10)
  if (admin) {
    try {
      await telegram.sendMessage(
        admin,
        `👑 <b>Nuevo Monthly Pass</b>\n\n👤 ${esc(name)} (<code>${u.id}</code>)\n🚀 ${n} por sorteo · hasta ${dateLabel(until)}\n💳 ${paid}`,
        { parse_mode: 'HTML' }
      )
    } catch (err) {
      console.error(err)
    }
  }
  // Public feed (BOOST_FEED_CHAT)
  const feed = (process.env.BOOST_FEED_CHAT || '').trim()
  if (feed) {
    try {
      const who = u.username ? esc(name) : `<a href="tg://user?id=${u.id}">${esc(name)}</a>`
      const text = `👑 <b>${who}</b> got the <b>Monthly Pass</b>\n🚀 <b>${n} ${boostWord(n)}</b> in every giveaway`
      let sent = false
      try {
        const image = await require('./boostImage').renderPassImage({ n, until: dateLabel(until), name, step: BOOST_STEP })
        await telegram.sendPhoto(feed, { source: image }, { caption: text, parse_mode: 'HTML', disable_notification: true })
        sent = true
      } catch (err) {
        console.error('Pass feed image failed, sending text', err)
      }
      if (!sent) await telegram.sendMessage(feed, text, { parse_mode: 'HTML', disable_notification: true })
    } catch (err) {
      console.error('Pass feed message failed', err)
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
  void trackAuto('pass_paid', u.id, { n, src: 'stars' })
  await sendPaidMessage(ctx.telegram, u, n, until, `⭐ ${p.total_amount} Stars`)
}

/** USDT payment of a Pass (order with raffleId "pass") */
export async function onPassCrypto(telegram: any, order: any, txHash: string) {
  const until = await activatePass(order.userId, order.boosts)
  void trackAuto('pass_paid', order.userId, { n: order.boosts, src: 'usdt' })
  const who = { id: order.userId, username: order.username, first_name: order.firstName, last_name: order.lastName }
  await sendPaidMessage(telegram, who, order.boosts, until, `🪙 ${formatUnits(order.amountUnits)} USDT · ${txHash}`)
}

async function showPass(ctx: any, edit: boolean, src = 'menu') {
  const chat: any = await findChat(ctx.from.id)
  if (!(await hasAcceptedTerms(ctx.from.id))) {
    return ctx.replyWithHTML(`${termsText(chat.language)}\n\n${loc('terms_accept_prompt', chat.language)}`, {
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: loc('terms_accept_button', chat.language), callback_data: 'pta~' }]] },
    })
  }
  void trackAuto('pass_open', ctx.from.id, { src })
  const active = passActive(chat)
  const text =
    `👑 <b>Monthly Pass</b>\n\n` +
    `One payment. <b>30 days</b>. Zero effort.\n` +
    `We <b>boost every giveaway you join</b>, automatically.\n\n` +
    `✅ <b>1 Boost = ${BOOST_STEP} entries</b>\n` +
    `✅ Pick <b>1, 2, 3 or 5 Boosts</b> per giveaway\n` +
    `✅ <b>Unlimited giveaways</b> · all month ♾\n\n` +
    (active
      ? `🟢 <b>Active</b> · ${chat.passN} ${boostWord(chat.passN)} per giveaway · until <b>${dateLabel(chat.passUntil)}</b>\n\n`
      : '') +
    `<b>How many Boosts per giveaway?</b> 👇`
  const buttons = passOptions().map((o) => ({
    text: `🚀 ${o.n} ${boostWord(o.n)}`,
    callback_data: `ps~${o.n}`,
  }))
  const keyboard: any[] = []
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2))
  keyboard.push([{ text: '← Back', callback_data: 'ab~m' }])
  const caption = text
  try {
    const image = await require('./boostImage').renderPassMenuImage({
      options: passOptions(),
      step: BOOST_STEP,
      style: 'c',
      active: active ? `ACTIVE · UNTIL ${dateLabel(chat.passUntil).toUpperCase()}` : 'NEW · MONTHLY PASS',
    })
    if (await showPhoto(ctx, image, keyboard, edit, caption)) return
  } catch (err) {
    console.error('Pass image failed, sending text', err)
  }
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
  // Owner only: Pass numbers
  bot.command('passes', async (ctx) => {
    if (!ctx.from || ctx.from.id !== parseInt(process.env.ADMIN, 10)) return
    try {
      await ctx.replyWithHTML(await passStatsText())
    } catch (err) {
      console.error(err)
    }
  })

  bot.command('pass', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    try {
      await showPass(ctx, false, 'cmd')
    } catch (err) {
      console.error(err)
    }
  })

  // Deep link: /start pass
  bot.use(async (ctx, next) => {
    const text = ctx.message && ctx.message.text
    if (!text || !/^\/start pass$/.test(text) || ctx.chat.type !== 'private') return next()
    try {
      await showPass(ctx, false, 'link')
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
    void trackAuto('pass_pick', ctx.from.id, { n: o.n })
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
        `👑 <b>Monthly Pass</b> · ${o.n} ${boostWord(o.n)} per giveaway\n📅 30 days · no limits\n\nHow do you want to pay? 👇`,
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
    void trackAuto('pass_stars', ctx.from.id, { n: o.n })
    try {
      await (ctx.telegram as any).callApi('sendInvoice', {
        chat_id: ctx.chat.id,
        title: `Monthly Pass · ${o.n} ${boostWord(o.n)} per giveaway`,
        description: '30 days. We boost every giveaway you join, automatically. No limits.',
        payload: `pass:${o.n}`,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: `Monthly Pass · ${o.n}/giveaway`, amount: o.stars }],
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
      void trackAuto('pass_usdt', u.id, { n: o.n })
      const amount = formatUnits(order.amountUnits)
      const caption =
        `👑 <b>Monthly Pass</b> · ${o.n} ${boostWord(o.n)} per giveaway · 30 days\n\n` +
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


/** Numbers for the owner: active Passes, funnel (who opens, picks, starts paying, buys) and sales */
export async function passStatsText() {
  const now = new Date()
  const opts = passOptions()
  const byStars: any = {}
  opts.forEach((o) => (byStars[o.stars] = o.n))
  const active: any[] = await ChatModel.find({ passUntil: { $gt: now }, passN: { $gt: 0 } }).select('passN passUntil')
  const perN: any = {}
  active.forEach((c) => (perN[c.passN] = (perN[c.passN] || 0) + 1))
  const soon = active.filter((c) => new Date(c.passUntil).getTime() < now.getTime() + 3 * DAY).length
  const lapsed = await ChatModel.countDocuments({ passUntil: { $lte: now }, passN: { $gt: 0 } })
  const used: any[] = await ChatModel.aggregate([
    { $group: { _id: null, n: { $sum: '$passBoosts' }, users: { $sum: { $cond: [{ $gt: ['$passBoosts', 0] }, 1, 0] } } } },
  ])
  const trials = await ChatModel.countDocuments({ surpriseAt: { $exists: true } })
  const sOpen = (await AutoBoostEventModel.distinct('userId', { type: 'surprise_open' })).length
  const sStars = await PaymentModel.aggregate([{ $match: { raffleId: 'surprise' } }, { $group: { _id: null, s: { $sum: '$stars' } } }])
  const periods: [string, number][] = [['Hoy', 1], ['7 d', 7], ['30 d', 30], ['Total', 100000]]
  const pad = (t: any, w: number) => `${t}`.padStart(w, ' ')
  const cols = await Promise.all(
    periods.map(async ([, days]) => {
      const from = new Date(now.getTime() - days * DAY)
      const ev: any[] = await AutoBoostEventModel.aggregate([
        { $match: { type: { $regex: '^pass_' }, createdAt: { $gte: from } } },
        { $group: { _id: '$type', users: { $addToSet: '$userId' }, n: { $sum: 1 } } },
      ])
      const u: any = {}
      ev.forEach((e) => (u[e._id] = e.users.length))
      const st: any[] = await PaymentModel.find({ raffleId: 'pass', status: 'applied', createdAt: { $gte: from } }).select('stars')
      const us: any[] = await CryptoOrderModel.find({ raffleId: 'pass', status: 'paid', createdAt: { $gte: from } }).select('amountUnits boosts')
      return {
        open: u.pass_open || 0,
        pick: u.pass_pick || 0,
        pay: Math.max(u.pass_stars || 0, 0) + (u.pass_usdt || 0),
        sales: st.length + us.length,
        stars: st.reduce((a, p) => a + (p.stars || 0), 0),
        usdt: us.reduce((a, o) => a + (o.amountUnits || 0), 0) / 10000,
        st,
        us,
      }
    })
  )
  const row = (label: string, f: (c: any) => any) => `${label.padEnd(9, ' ')}${cols.map((c) => pad(f(c), 7)).join('')}`
  const head = `${''.padEnd(9, ' ')}${periods.map(([l]) => pad(l, 7)).join('')}`
  const conv = (c: any) => (c.open ? `${Math.round((c.sales / c.open) * 100)}%` : '-')
  // What people pick and where they come from (30 days)
  const from30 = new Date(now.getTime() - 30 * DAY)
  const picks: any[] = await AutoBoostEventModel.aggregate([
    { $match: { type: 'pass_pick', createdAt: { $gte: from30 } } },
    { $group: { _id: '$n', c: { $sum: 1 } } },
  ])
  const srcs: any[] = await AutoBoostEventModel.aggregate([
    { $match: { type: 'pass_open', createdAt: { $gte: from30 } } },
    { $group: { _id: '$src', c: { $sum: 1 } } },
  ])
  const srcName: any = { link: 'enlace/botón de post', menu: 'menú del bot', cmd: '/pass' }
  const sold: any = {}
  cols[2].st.forEach((p: any) => {
    const n = byStars[p.stars]
    if (n) sold[n] = (sold[n] || 0) + 1
  })
  cols[2].us.forEach((o: any) => (sold[o.boosts] = (sold[o.boosts] || 0) + 1))
  return (
    `👑 <b>Monthly Pass</b>\n\n` +
    `<b>Ahora</b>\n` +
    `✅ Activos: <b>${active.length}</b>${active.length ? ` (${opts.map((o) => `${o.n}×: ${perN[o.n] || 0}`).join(' · ')})` : ''}\n` +
    `⏳ Terminan en 3 días: <b>${soon}</b>\n` +
    `💤 Caducados sin renovar: <b>${lapsed}</b>\n` +
    `🚀 Boosts aplicados: <b>${(used[0] && used[0].n) || 0}</b> (${(used[0] && used[0].users) || 0} personas)\n` +
    `🎁 Sorpresa: <b>${sOpen}</b> abren → <b>${trials}</b> desbloquean (⭐ ${(sStars[0] && sStars[0].s) || 0})\n\n` +
    `<b>Embudo</b> (personas distintas)\n<pre>${head}\n${row('Abren', (c) => c.open)}\n${row('Eligen', (c) => c.pick)}\n${row('Pagan', (c) => c.pay)}\n${row('Compran', (c) => c.sales)}\n${row('Conv.', conv)}</pre>\n` +
    `<b>Ingresos</b>\n<pre>${head}\n${row('Stars', (c) => c.stars)}\n${row('USDT', (c) => c.usdt.toFixed(1))}</pre>\n` +
    `<b>Últimos 30 días</b>\n` +
    `🎯 Más elegido: ${picks.length ? picks.sort((a, b) => b.c - a.c).map((p) => `${p._id}× (${p.c})`).join(' · ') : '—'}\n` +
    `🛒 Vendidos: ${opts.filter((o) => sold[o.n]).map((o) => `${o.n}× (${sold[o.n]})`).join(' · ') || '—'}\n` +
    `🔗 Origen: ${srcs.length ? srcs.sort((a, b) => b.c - a.c).map((x) => `${srcName[x._id] || x._id} (${x.c})`).join(' · ') : '—'}\n\n` +
    `<i>Abren = tocan el botón o el enlace del Pass (cuenta los clics de /postbutton pass). Pagan = generan factura Stars u orden USDT.</i>`
  )
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
        `👑 <b>Your Monthly Pass ends on ${dateLabel(c.passUntil)}</b>\n\nRenew now and the 30 days are added to what you have left.`,
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
        `👑 <b>Your Monthly Pass has ended</b>\n\nGet it again so you never miss a Boost.`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '👑 Get Pass', callback_data: 'ps~m' }]] } }
      )
    } catch {
      // the person blocked the bot
    }
  }
}
