// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { RaffleModel } from '../models'
import { PaymentModel } from '../models/payment'
import { CryptoOrderModel } from '../models/cryptoOrder'
import { CreditTxModel } from '../models/creditTx'
import { WinCountModel } from '../models/winCount'
import { findChat, ChatModel } from '../models/chat'
import { checkIfAdmin } from './checkAdmin'

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const MEDALS = ['🥇', '🥈', '🥉']
const TOP = 10

// Names (user id → display name), cached so the message refreshes fast
const names = new Map<number, string>()

async function nameOf(telegram: any, chatId: number | undefined, id: number) {
  const cached = names.get(id)
  if (cached) return cached
  let name = ''
  const read = (u: any) =>
    u.username ? `@${u.username}` : `${u.first_name || ''}${u.last_name ? ` ${u.last_name}` : ''}`.trim()
  try {
    if (chatId) name = read((await telegram.getChatMember(chatId, id)).user)
  } catch (err) {
    // left the chat
  }
  if (!name) {
    try {
      name = read(await telegram.getChat(id))
    } catch (err) {
      // never opened the bot
    }
  }
  if (name) names.set(id, name)
  return name || 'Anonymous'
}

/**
 * Adds the win of a finished giveaway to the permanent ranking (once per giveaway).
 * When the giveaway is drawn again, the win moves from the old first winner to the new one.
 */
export async function recordRaffleWins(raffle: any, previousFirst = 0) {
  try {
    if (!raffle || !raffle.winners) return
    // Only the first winner counts; the others are substitutes
    const userId = parseInt(`${raffle.winners}`.split(',')[0], 10)
    // Claim it first so a giveaway is never counted twice
    const claimed: any = await RaffleModel.updateOne(
      { _id: raffle._id, winsRecorded: { $ne: true } },
      { $set: { winsRecorded: true } }
    )
    if (!claimed || !claimed.nModified) {
      // Already counted: a new draw replaces the previous first winner
      if (userId && previousFirst && previousFirst !== userId) {
        await WinCountModel.updateOne({ chatId: raffle.chatId, userId: previousFirst, wins: { $gt: 0 } }, { $inc: { wins: -1 } })
        await WinCountModel.updateOne({ chatId: raffle.chatId, userId }, { $inc: { wins: 1 } }, { upsert: true })
      }
      return
    }
    if (userId) {
      await WinCountModel.updateOne({ chatId: raffle.chatId, userId }, { $inc: { wins: 1 } }, { upsert: true })
    }
    await ChatModel.updateOne({ chatId: raffle.chatId }, { $inc: { giveawaysDone: 1 } }, { upsert: true })
  } catch (err) {
    console.error('Wins not recorded', err)
  }
}

/** Counts giveaways that finished before the permanent ranking existed (still stored) */
async function backfillWins() {
  try {
    // One-time reset: earlier versions also counted substitutes, so recount from scratch
    const marker = await WinCountModel.findOne({ chatId: 0, userId: 0 })
    if (!marker) {
      await WinCountModel.deleteMany({})
      await RaffleModel.updateMany({}, { $set: { winsRecorded: false } })
      await ChatModel.updateMany({}, { $set: { giveawaysDone: 0 } })
      await WinCountModel.create({ chatId: 0, userId: 0, wins: 0 })
      console.log('Hall of fame: recounted (first winner only)')
    }
    const old: any[] = await RaffleModel.find({
      winners: { $exists: true, $ne: '' },
      winsRecorded: { $ne: true },
    }).select('chatId winners')
    for (const r of old) await recordRaffleWins(r)
    if (old.length) console.log(`Hall of fame: ${old.length} finished giveaways counted`)
  } catch (err) {
    console.error('Hall of fame backfill failed', err)
  }
}

/**
 * All-time ranking: giveaways won and boosts bought in total (Stars + USDT + credits).
 * chatId = only that chat; undefined = every chat.
 */
async function ranking(chatId?: number) {
  const rows: any[] = await WinCountModel.find(chatId ? { chatId, userId: { $gt: 0 }, wins: { $gt: 0 } } : { userId: { $gt: 0 }, wins: { $gt: 0 } }).select('userId wins')
  const wins = new Map<number, number>()
  for (const r of rows) wins.set(r.userId, (wins.get(r.userId) || 0) + (r.wins || 0))
  let giveaways = 0
  if (chatId) {
    const c: any = await ChatModel.findOne({ chatId }).select('giveawaysDone')
    giveaways = (c && c.giveawaysDone) || 0
  } else {
    const t: any[] = await ChatModel.aggregate([
      { $group: { _id: null, n: { $sum: { $ifNull: ['$giveawaysDone', 0] } } } },
    ])
    giveaways = (t[0] && t[0].n) || 0
  }
  const ids = Array.from(wins.keys())
  const boosts = new Map<number, number>()
  if (ids.length) {
    const add = (id: number, n: number) => boosts.set(id, (boosts.get(id) || 0) + (n || 0))
    // Payments carry the chat; older ones only know the raffle (look it up while it still exists)
    let scope: any = {}
    let spendScope: any = {}
    if (chatId) {
      const raffleIds = (await RaffleModel.find({ chatId }).select('_id')).map((r: any) => `${r._id}`)
      scope = { $or: [{ chatId }, { chatId: { $exists: false }, raffleId: { $in: raffleIds } }] }
      spendScope = scope
    }
    const stars: any[] = await PaymentModel.find({
      ...scope,
      status: 'applied',
      userId: { $in: ids },
      raffleId: { $ne: 'topup' },
    }).select('userId boosts')
    for (const p of stars) add(p.userId, p.boosts || 1)
    const usdt: any[] = await CryptoOrderModel.find({
      ...scope,
      status: 'paid',
      userId: { $in: ids },
      raffleId: { $ne: 'topup' },
    }).select('userId boosts')
    for (const o of usdt) add(o.userId, o.boosts || 1)
    const spends: any[] = await CreditTxModel.find({
      type: 'spend',
      userId: { $in: ids },
      ...spendScope,
    }).select('userId delta')
    for (const t of spends) add(t.userId, -t.delta)
  }
  const list = ids
    .map((id) => ({ id, wins: wins.get(id) || 0, boosts: boosts.get(id) || 0 }))
    .sort((a, b) => b.wins - a.wins || b.boosts - a.boosts || a.id - b.id)
  return { list: list.slice(0, TOP), giveaways, winners: ids.length }
}

async function hallText(telegram: any, chatId?: number) {
  const r = await ranking(chatId)
  if (!r.list.length) {
    return '🏆 <b>Top 10 winners</b>\n\nThe first winner will appear here after the next draw.'
  }
  const lines: string[] = []
  for (let i = 0; i < r.list.length; i++) {
    const u = r.list[i]
    const name = esc(await nameOf(telegram, chatId, u.id))
    const medal = i < 3 ? MEDALS[i] : `${i + 1}.`
    const w = `${u.wins} ${u.wins === 1 ? 'win' : 'wins'}`
    const b = `${u.boosts} ${u.boosts === 1 ? 'boost' : 'boosts'}`
    lines.push(`${medal} <b>${name}</b> · ${w} · ${b}`)
  }
  return (
    `🏆 <b>Top 10 winners</b> · all time\n\n${lines.join('\n')}\n\n` +
    `📊 ${r.giveaways} ${r.giveaways === 1 ? 'giveaway' : 'giveaways'} · ${r.winners} ${r.winners === 1 ? 'winner' : 'winners'}\n\n` +
    `🚀 Boost your next giveaway and climb the ranking!`
  )
}

/** "Buy Boosts" button under the ranking: opens the recharge screen in the bot's private chat */
function hallButtons() {
  return {
    inline_keyboard: [[{ text: '🚀 Buy Boosts', url: `https://t.me/${process.env.USERNAME}?start=recharge` }]],
  }
}

/** Sends the ranking to the chat, remembers it and pins it (when the bot may pin) */
async function createHallOfFame(telegram: any, chat: any, chatId: number) {
  const sent = await telegram.sendMessage(chatId, await hallText(telegram, chatId), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: hallButtons(),
  })
  chat.hofMessageId = sent.message_id
  await chat.save()
  try {
    await telegram.callApi('pinChatMessage', {
      chat_id: chatId,
      message_id: sent.message_id,
      disable_notification: true,
    })
  } catch (err) {
    // No "Pin messages" permission: the ranking is still posted and keeps updating
  }
}

/**
 * Refreshes the ranking of a chat after every draw. The first time (or if the message was
 * deleted) it posts and pins a new one, so nobody has to send /winners.
 */
export async function updateHallOfFame(telegram: any, chatId: number) {
  try {
    const chat = await findChat(chatId)
    if (chat.hofMessageId) {
      try {
        await telegram.editMessageText(chatId, chat.hofMessageId, undefined, await hallText(telegram, chatId), {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
    reply_markup: hallButtons(),
        })
        return
      } catch (err) {
        const msg = `${(err && (err.description || err.message)) || ''}`
        if (/not modified/i.test(msg)) return
        if (!/not found|MESSAGE_ID_INVALID|can't be edited/i.test(msg)) {
          console.error('Hall of fame not updated', msg)
          return
        }
        // The message was deleted: post a new one below
      }
    }
    await createHallOfFame(telegram, chat, chatId)
  } catch (err) {
    console.error('Hall of fame failed', err)
  }
}

/**
 * /winners
 *  - group, admin: creates the pinned ranking (it updates itself after every draw)
 *  - group, anyone else: shows the current ranking
 *  - private: ranking of every chat together
 */
export function setupWinners(bot: Telegraf<ContextMessageUpdate>) {
  // Count the giveaways already finished (once, in the background)
  backfillWins()
  bot.command('winners', async (ctx) => {
    try {
      if (ctx.chat.type === 'private') {
        return ctx.replyWithHTML(await hallText(ctx.telegram), { disable_web_page_preview: true, reply_markup: hallButtons() } as any)
      }
      const chatId = ctx.chat.id
      const isAdmin = await checkIfAdmin(ctx, false)
      const text = await hallText(ctx.telegram, chatId)
      if (!isAdmin) {
        return ctx.replyWithHTML(text, { disable_web_page_preview: true, reply_markup: hallButtons() } as any)
      }
      const chat = await findChat(chatId)
      const upToDate = '✅ The pinned ranking is up to date. It updates itself after every draw.'
      if (chat.hofMessageId) {
        try {
          await ctx.telegram.editMessageText(chatId, chat.hofMessageId, undefined, text, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
    reply_markup: hallButtons(),
          })
          return ctx.reply(upToDate)
        } catch (err) {
          const msg = `${(err && (err.description || err.message)) || ''}`
          if (/not modified/i.test(msg)) return ctx.reply(upToDate)
          // Deleted or missing: create a new one below
        }
      }
      const sent = await ctx.replyWithHTML(text, { disable_web_page_preview: true, reply_markup: hallButtons() } as any)
      chat.hofMessageId = sent.message_id
      await chat.save()
      try {
        await (ctx.telegram as any).callApi('pinChatMessage', {
          chat_id: chatId,
          message_id: sent.message_id,
          disable_notification: true,
        })
      } catch (err) {
        await ctx.reply('⚠️ I could not pin it. Give me the "Pin messages" admin permission and send /winners again.')
      }
    } catch (err) {
      console.error(err)
    }
  })
}
