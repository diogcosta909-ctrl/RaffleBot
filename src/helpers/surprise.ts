// Dependencies
import * as fs from 'fs'
import * as path from 'path'
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { ChatModel, findChat } from '../models/chat'
import { passActive, dateLabel } from './pass'
import { trackAuto } from '../models/autoBoostEvent'

// Surprise post: a paid-media photo (blurred until unlocked with Stars). Whoever unlocks it gets a free Monthly Pass trial.
// Owner command: /surprise <stars> [chat]   (chat defaults to BOOST_FEED_CHAT; the bot must be admin there)
// SURPRISE_DAYS="3"  SURPRISE_BOOSTS="1"

const DAY = 24 * 60 * 60 * 1000
const days = () => parseInt(process.env.SURPRISE_DAYS || '3', 10) || 3
const boosts = () => parseInt(process.env.SURPRISE_BOOSTS || '1', 10) || 1
const isOwner = (id: number) => id === parseInt(process.env.ADMIN, 10)

/** Gives the free trial once per person */
async function grantTrial(telegram: any, userId: number) {
  const chat: any = await findChat(userId)
  if (chat.surpriseAt) return
  const now = Date.now()
  let until: Date
  if (passActive(chat)) {
    // Already has a Pass: the trial days are added on top
    until = new Date(new Date(chat.passUntil).getTime() + days() * DAY)
    await ChatModel.updateOne({ chatId: userId }, { $set: { passUntil: until, surpriseAt: new Date() } })
  } else {
    until = new Date(now + days() * DAY)
    await ChatModel.updateOne(
      { chatId: userId },
      { $set: { passUntil: until, passN: boosts(), passWarned: false, passEndedSent: false, surpriseAt: new Date() } }
    )
  }
  void trackAuto('pass_trial', userId, { src: 'surprise' })
  try {
    await telegram.sendMessage(
      userId,
      `🎁 <b>Unlocked!</b>\n\nYou got <b>${days()} days of Monthly Pass</b>, free.\n` +
        `🚀 <b>${chat.passN && passActive(chat) ? chat.passN : boosts()} ${boosts() === 1 ? 'Boost' : 'Boosts'}</b> in every giveaway you join\n` +
        `📅 Until <b>${dateLabel(until)}</b>\n\nJust join giveaways. We do the rest.`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🪎 Monthly Pass', callback_data: 'ps~m' }]] },
      }
    )
  } catch {
    // They never opened the bot: the trial is still active and applies when they join a giveaway
  }
}

export function setupSurprise(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('surprise', async (ctx) => {
    if (!ctx.from || !isOwner(ctx.from.id) || ctx.chat.type !== 'private') return
    try {
      const args = ctx.message.text.split(/\s+/)
      const stars = parseInt(args[1], 10)
      const target = args[2] || (process.env.SURPRISE_CHAT || process.env.BOOST_FEED_CHAT || '').trim()
      if (!stars || stars < 1 || !target) {
        return ctx.replyWithHTML('Use: <code>/surprise 50</code> (Stars to unlock) or <code>/surprise 50 @channel</code>')
      }
      // The photo goes to you first only to get its file_id
      const sent: any = await ctx.replyWithPhoto({ source: fs.createReadStream(path.join(__dirname, '..', '..', 'assets', 'surprise.png')) } as any)
      const fileId = sent.photo[sent.photo.length - 1].file_id
      await (ctx.telegram as any).callApi('sendPaidMedia', {
        chat_id: target,
        star_count: stars,
        media: [{ type: 'photo', media: fileId }],
        payload: `surprise:${Date.now()}`,
        caption: `🎁 <b>Surprise inside!</b>\n\nUnlock it and get <b>${days()} days of Monthly Pass free</b> 🚀\n\n<b>Comment "UNLOCKED"</b> if you see it 👇`,
        parse_mode: 'HTML',
      })
      await ctx.replyWithHTML(`✅ Surprise posted in ${target} · ${stars} Stars to unlock`)
    } catch (err) {
      console.error(err)
      await ctx.replyWithHTML(`❌ Could not post: <code>${`${(err && (err.description || err.message)) || err}`.slice(0, 200)}</code>`)
    }
  })

  // Telegram tells the bot who paid for its paid media
  bot.use(async (ctx, next) => {
    const p = ctx.update && (ctx.update as any).purchased_paid_media
    if (!p) return next()
    try {
      if (`${p.paid_media_payload || ''}`.startsWith('surprise:') && p.from) {
        await grantTrial(ctx.telegram, p.from.id)
      }
    } catch (err) {
      console.error('Surprise trial failed', err)
    }
  })
}
