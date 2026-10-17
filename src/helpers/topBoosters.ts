// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { PaymentModel } from '../models/payment'
import { CryptoOrderModel } from '../models/cryptoOrder'
import { findChat } from '../models/chat'

const TZ = 'Europe/Andorra'
const DAYS = 7
const TOP = 5
const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Top boosters of the last days (Stars and USDT together, counted in boosts) */
export async function topBoosters(days = DAYS) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000)
  const byUser = new Map<number, { name: string; boosts: number }>()
  const add = (id: number, name: string, boosts: number) => {
    const cur = byUser.get(id) || { name, boosts: 0 }
    cur.boosts += boosts
    if (name) cur.name = name
    byUser.set(id, cur)
  }
  const stars: any[] = await PaymentModel.find({
    status: 'applied',
    createdAt: { $gte: since },
  })
  for (const p of stars) add(p.userId, p.userName || '', p.boosts || 1)
  const crypto: any[] = await CryptoOrderModel.find({
    status: 'paid',
    paidAt: { $gte: since },
  })
  for (const o of crypto) {
    const name = o.username
      ? `@${o.username}`
      : `${o.firstName || ''}${o.lastName ? ` ${o.lastName}` : ''}`.trim()
    add(o.userId, name, o.boosts || 1)
  }
  return Array.from(byUser.values())
    .filter((u) => u.boosts > 0)
    .sort((a, b) => b.boosts - a.boosts)
    .slice(0, TOP)
}

function rankingText(list: { name: string; boosts: number }[]) {
  const lines = list.map(
    (u, i) =>
      `${MEDALS[i]} <b>${esc(u.name || 'Anonymous')}</b> · ${u.boosts} ${u.boosts > 1 ? 'boosts' : 'boost'}`
  )
  return `🏆 <b>Top Boosters of the week</b>\n\n${lines.join('\n')}\n\n🚀 Want to be on the list? Boost your odds in the next giveaway!`
}

async function postRanking(telegram: any) {
  const feed = (process.env.BOOST_FEED_CHAT || '').trim()
  const list = await topBoosters()
  if (!list.length) return { posted: false, list }
  if (feed) {
    await telegram.sendMessage(feed, rankingText(list), {
      parse_mode: 'HTML',
      disable_notification: true,
    })
  }
  return { posted: !!feed, list }
}

/** Local day/time in Andorra */
function localNow() {
  const parts: any = {}
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  } as any)
    .formatToParts(new Date())
    .forEach((p) => (parts[p.type] = p.value))
  return {
    weekday: parts.weekday,
    hour: parseInt(parts.hour, 10),
    day: `${parts.year}-${parts.month}-${parts.day}`,
  }
}

/**
 * Weekly "Top Boosters" post in the boost feed (Mondays 12:00 Andorra time) and
 * /top for the owner to post it right away.
 */
export function setupTopBoosters(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('top', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    if (ctx.from.id !== parseInt(process.env.ADMIN, 10)) return
    try {
      const { posted, list } = await postRanking(ctx.telegram)
      if (!list.length) return ctx.reply('Aún no hay boosts en los últimos 7 días.')
      await ctx.replyWithHTML(rankingText(list))
      if (!posted) {
        await ctx.reply('ℹ️ No se publicó en el feed: falta BOOST_FEED_CHAT.')
      }
    } catch (err) {
      console.error('Top boosters failed', err)
      await ctx.reply('❌ No se pudo publicar el ranking.')
    }
  })

  const admin = parseInt(process.env.ADMIN, 10)
  if (!admin || !(process.env.BOOST_FEED_CHAT || '').trim()) return
  setInterval(async () => {
    try {
      const now = localNow()
      if (now.weekday !== 'Mon' || now.hour < 12) return
      const owner = await findChat(admin)
      if ((owner as any).topPostedDay === now.day) return
      // Mark first so a slow or failed run never posts twice
      ;(owner as any).topPostedDay = now.day
      await owner.save()
      await postRanking(bot.telegram)
    } catch (err) {
      console.error('Weekly top boosters failed', err)
    }
  }, 10 * 60 * 1000)
}
