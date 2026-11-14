// Dependencies
import * as fs from 'fs'
import * as path from 'path'
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { ChatModel, findChat } from '../models/chat'
import { PaymentModel } from '../models/payment'
import { passActive, dateLabel } from './pass'
import { trackAuto } from '../models/autoBoostEvent'
import { starsEnabled } from './payMode'

// Surprise post: a blurred photo in the channel with an "Unlock" button. The button opens the bot
// (/start surprise) which sends a Stars invoice to the BOT's balance. Whoever pays gets the real photo
// and a free Monthly Pass trial (once per person).
// Owner command: /surprise [chat]   (chat defaults to SURPRISE_CHAT, then BOOST_FEED_CHAT)
// SURPRISE_STARS="5"  SURPRISE_DAYS="3"  SURPRISE_BOOSTS="1"  SURPRISE_CHAT="@channel"

const DAY = 24 * 60 * 60 * 1000
const days = () => parseInt(process.env.SURPRISE_DAYS || '3', 10) || 3
const boosts = () => parseInt(process.env.SURPRISE_BOOSTS || '1', 10) || 1
const stars = () => parseInt(process.env.SURPRISE_STARS || '5', 10) || 5
const isOwner = (id: number) => id === parseInt(process.env.ADMIN, 10)
const asset = (f: string) => ({ source: fs.createReadStream(path.join(__dirname, '..', '..', 'assets', f)) } as any)

/** Stars paid for the surprise: record it, give the trial once, show the real photo */
export async function onSurprisePaid(ctx: any, p: any) {
  const chargeId = p.telegram_payment_charge_id
  if (await PaymentModel.countDocuments({ chargeId })) return
  const u = ctx.from
  await PaymentModel.create({
    chargeId,
    userId: u.id,
    raffleId: 'surprise',
    stars: p.total_amount,
    boosts: 0,
    userName: u.username ? `@${u.username}` : `${u.first_name}${u.last_name ? ` ${u.last_name}` : ''}`,
  })
  void trackAuto('surprise_paid', u.id)
  const chat: any = await findChat(u.id)
  let until: Date
  if (chat.surpriseAt) {
    // Paid again: no second trial
    until = chat.passUntil
  } else if (passActive(chat)) {
    until = new Date(new Date(chat.passUntil).getTime() + days() * DAY)
    await ChatModel.updateOne({ chatId: u.id }, { $set: { passUntil: until, surpriseAt: new Date() } })
    void trackAuto('pass_trial', u.id)
  } else {
    until = new Date(Date.now() + days() * DAY)
    await ChatModel.updateOne(
      { chatId: u.id },
      { $set: { passUntil: until, passN: boosts(), passWarned: false, passEndedSent: false, surpriseAt: new Date() } }
    )
    void trackAuto('pass_trial', u.id)
  }
  const n = passActive(await findChat(u.id)) ? (await findChat(u.id) as any).passN || boosts() : boosts()
  await ctx.telegram.sendPhoto(u.id, asset('surprise.png'), {
    caption:
      `🎁 <b>Unlocked!</b>\n\nYou got <b>${days()} days of Monthly Pass</b>, free.\n` +
      `🚀 <b>${n} ${n === 1 ? 'Boost' : 'Boosts'}</b> in every giveaway you join\n` +
      `📅 Until <b>${dateLabel(until)}</b>\n\nJust join giveaways. We do the rest.`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: '🪎 Monthly Pass', callback_data: 'ps~m' }]] },
  })
  try {
    const who = u.username ? `@${u.username}` : u.first_name
    await ctx.telegram.sendMessage(process.env.ADMIN, `🎁 Surprise unlocked by ${who} · ⭐ ${p.total_amount}`)
  } catch {
    // ignore
  }
}

export function setupSurprise(bot: Telegraf<ContextMessageUpdate>) {
  // Owner: post the teaser in the channel
  bot.command('surprise', async (ctx) => {
    if (!ctx.from || !isOwner(ctx.from.id) || ctx.chat.type !== 'private') return
    try {
      const target = ctx.message.text.split(/\s+/)[1] || (process.env.SURPRISE_CHAT || process.env.BOOST_FEED_CHAT || '').trim()
      if (!target) return ctx.replyWithHTML('Use: <code>/surprise @channel</code> or set <code>SURPRISE_CHAT</code>')
      await ctx.telegram.sendPhoto(target, asset('surprise_blur.png'), {
        caption: `🎁 <b>We have a surprise for you</b>\n\n🔒 <b>Unlock it</b> to see what's inside 👇`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: `🔓 Unlock ⭐ ${stars()}`, url: `https://t.me/${process.env.USERNAME}?start=surprise` }]],
        },
      } as any)
      await ctx.replyWithHTML(`✅ Surprise posted in ${target} · ⭐ ${stars()} to unlock`)
    } catch (err) {
      console.error(err)
      await ctx.replyWithHTML(`❌ Could not post: <code>${`${(err && (err.description || err.message)) || err}`.slice(0, 200)}</code>`)
    }
  })

  // Deep link: /start surprise → invoice
  bot.use(async (ctx, next) => {
    const text = ctx.message && ctx.message.text
    if (!text || !/^\/start surprise$/.test(text) || ctx.chat.type !== 'private') return next()
    try {
      void trackAuto('surprise_open', ctx.from.id)
      const chat: any = await findChat(ctx.from.id)
      if (chat.surpriseAt) {
        return ctx.replyWithHTML('🎁 <b>You already unlocked this surprise.</b>\n\nCheck your Monthly Pass 👇', {
          reply_markup: { inline_keyboard: [[{ text: '🪎 Monthly Pass', callback_data: 'ps~m' }]] },
        } as any)
      }
      if (!starsEnabled()) return
      await (ctx.telegram as any).callApi('sendInvoice', {
        chat_id: ctx.chat.id,
        title: '🎁 Unlock the surprise',
        description: 'Unlock it to see what is inside.',
        payload: 'surprise:1',
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: 'Surprise', amount: stars() }],
      })
    } catch (err) {
      console.error(err)
    }
  })
}
