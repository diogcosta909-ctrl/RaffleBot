// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { WinnerLogModel } from '../models/winnerLog'
import { findChat } from '../models/chat'
import { checkIfAdmin } from './checkAdmin'

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Saves the winners of a finished raffle (never breaks the draw) */
export async function logWinners(
  raffle: any,
  winners: { id: number; name: string; entries: number; boosts: number; method: string }[],
  participants: number
) {
  try {
    await WinnerLogModel.insertMany(
      winners.map((w, i) => ({
        chatId: raffle.chatId,
        raffleId: `${raffle._id}`,
        userId: w.id,
        name: w.name,
        position: i + 1,
        entries: w.entries,
        boosts: w.boosts,
        method: w.method,
        participants,
      }))
    )
  } catch (err) {
    console.error('Winners not logged', err)
  }
}

function line(w: any, i: number) {
  const d = new Date(w.createdAt)
  const when = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
  const how =
    w.boosts > 0
      ? `🚀 ${w.method === 'usdt' ? 'USDT' : w.method === 'credits' ? 'credits' : '⭐'} boost`
      : '🍀 free entry'
  return `${i + 1}. <b>${esc(w.name || 'Anonymous')}</b> · ${w.entries} ${w.entries === 1 ? "entry" : "entries"} · ${how} · ${w.participants} players · ${when}`
}

async function hallText(query: any) {
  // First winner of each raffle only (the rest are substitutes)
  const list: any[] = await WinnerLogModel.find({ ...query, position: 1 })
    .sort({ createdAt: -1 })
    .limit(10)
  if (!list.length) {
    return '🏆 <b>Hall of fame</b>\n\nThe first winner will appear here after the next draw.'
  }
  return `🏆 <b>Hall of fame</b> · last ${list.length} winners\n\n${list.map(line).join('\n')}`
}

/** Refreshes the pinned hall of fame of a chat (called after every draw) */
export async function updateHallOfFame(telegram: any, chatId: number) {
  try {
    const chat = await findChat(chatId)
    if (!chat.hofMessageId) return
    try {
      await telegram.editMessageText(chatId, chat.hofMessageId, undefined, await hallText({ chatId }), {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })
    } catch (err) {
      const msg = `${(err && (err.description || err.message)) || ''}`
      if (/not modified/i.test(msg)) return
      // The message was deleted: stop updating it (/winners creates a new one)
      if (/not found|MESSAGE_ID_INVALID|can't be edited/i.test(msg)) {
        chat.hofMessageId = undefined
        await chat.save()
        return
      }
      console.error('Hall of fame not updated', msg)
    }
  } catch (err) {
    console.error('Hall of fame failed', err)
  }
}

/**
 * /winners
 *  - group, admin: creates the pinned hall of fame (it updates itself after every draw)
 *  - group, anyone else: shows the current list
 *  - private: last winners of every raffle
 */
export function setupWinners(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('winners', async (ctx) => {
    try {
      if (ctx.chat.type === 'private') {
        return ctx.replyWithHTML(await hallText({}), { disable_web_page_preview: true } as any)
      }
      const chatId = ctx.chat.id
      const isAdmin = await checkIfAdmin(ctx, false)
      if (!isAdmin) {
        return ctx.replyWithHTML(await hallText({ chatId }), { disable_web_page_preview: true } as any)
      }
      const chat = await findChat(chatId)
      const text = await hallText({ chatId })
      if (chat.hofMessageId) {
        try {
          await ctx.telegram.editMessageText(chatId, chat.hofMessageId, undefined, text, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          })
          return ctx.reply('✅ The pinned hall of fame is up to date. It updates itself after every draw.')
        } catch (err) {
          const msg = `${(err && (err.description || err.message)) || ''}`
          if (/not modified/i.test(msg)) {
            return ctx.reply('✅ The pinned hall of fame is up to date. It updates itself after every draw.')
          }
          // Deleted or missing: create a new one below
        }
      }
      const sent = await ctx.replyWithHTML(text, { disable_web_page_preview: true } as any)
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
