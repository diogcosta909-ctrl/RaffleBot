// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { WinnerLogModel } from '../models/winnerLog'

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

/** /winners: last winners of this chat (or of every raffle when used in private) */
export function setupWinners(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('winners', async (ctx) => {
    try {
      const priv = ctx.chat.type === 'private'
      const query: any = priv ? {} : { chatId: ctx.chat.id }
      // First winner of each raffle only (the rest are substitutes)
      const list: any[] = await WinnerLogModel.find({ ...query, position: 1 })
        .sort({ createdAt: -1 })
        .limit(10)
      if (!list.length) {
        return ctx.reply('🏆 No winners yet — the first one could be you!')
      }
      return ctx.replyWithHTML(
        `🏆 <b>Hall of fame</b> · last ${list.length} winners\n\n${list.map(line).join('\n')}`,
        { disable_web_page_preview: true } as any
      )
    } catch (err) {
      console.error(err)
    }
  })
}
