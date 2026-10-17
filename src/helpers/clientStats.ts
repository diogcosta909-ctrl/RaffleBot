// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { PaymentModel } from '../models/payment'
import { CryptoOrderModel } from '../models/cryptoOrder'
import { RaffleModel } from '../models/raffle'
import { CreditTxModel } from '../models/creditTx'
import { findChat } from '../models/chat'
import { formatUnits } from './cryptoPay'

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface Buyer {
  name: string
  purchases: number
  boosts: number
  stars: number
  usdtUnits: number
}

/** Owner only: who buys, who comes back and which raffles sell the most boosts */
export function setupClientStats(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('clientes', async (ctx: any) => {
    if (ctx.chat.type !== 'private') return
    if (ctx.from.id !== parseInt(process.env.ADMIN, 10)) return
    try {
      const owner = await findChat(ctx.from.id)
      const since = owner.statsResetAt
      const payQuery: any = { status: 'applied' }
      const cryQuery: any = { status: 'paid' }
      if (since) {
        payQuery.createdAt = { $gte: since }
        cryQuery.paidAt = { $gte: since }
      }
      const payments: any[] = await PaymentModel.find(payQuery)
      const orders: any[] = await CryptoOrderModel.find(cryQuery)

      const buyers = new Map<number, Buyer>()
      const raffles = new Map<string, { boosts: number; buyers: Set<number> }>()
      const touch = (id: number, name: string) => {
        const b = buyers.get(id) || { name, purchases: 0, boosts: 0, stars: 0, usdtUnits: 0 }
        if (name) b.name = name
        buyers.set(id, b)
        return b
      }
      const raffle = (raffleId: string, userId: number, boosts: number) => {
        const r = raffles.get(raffleId) || { boosts: 0, buyers: new Set<number>() }
        r.boosts += boosts
        r.buyers.add(userId)
        raffles.set(raffleId, r)
      }
      for (const p of payments) {
        const b = touch(p.userId, p.userName || '')
        b.purchases++
        b.stars += p.stars || 0
        // Credit recharges are revenue; their boosts are counted when the credits are spent
        if (p.raffleId !== 'topup') {
          b.boosts += p.boosts || 1
          raffle(p.raffleId, p.userId, p.boosts || 1)
        }
      }
      for (const o of orders) {
        const name = o.username
          ? `@${o.username}`
          : `${o.firstName || ''}${o.lastName ? ` ${o.lastName}` : ''}`.trim()
        const b = touch(o.userId, name)
        b.purchases++
        b.usdtUnits += o.amountUnits || 0
        if (o.raffleId !== 'topup') {
          b.boosts += o.boosts || 1
          raffle(o.raffleId, o.userId, o.boosts || 1)
        }
      }
      const spendQuery: any = { type: 'spend' }
      if (since) spendQuery.createdAt = { $gte: since }
      const spends: any[] = await CreditTxModel.find(spendQuery)
      for (const t of spends) {
        const b = touch(t.userId, t.name || '')
        b.boosts += -t.delta
        if (t.raffleId) raffle(t.raffleId, t.userId, -t.delta)
      }

      const list = Array.from(buyers.values())
      if (!list.length) return ctx.reply('Aún no hay compradores.')
      const total = list.length
      const repeat = list.filter((b) => b.purchases >= 2).length
      const purchases = list.reduce((a, b) => a + b.purchases, 0)
      const boosts = list.reduce((a, b) => a + b.boosts, 0)
      const stars = list.reduce((a, b) => a + b.stars, 0)
      const usdt = list.reduce((a, b) => a + b.usdtUnits, 0)
      const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
      const f1 = (n: number) => (Math.round(n * 10) / 10).toString()

      // Raffles that sold the most boosts, with the chat they belong to
      const top = Array.from(raffles.entries())
        .sort((a, b) => b[1].boosts - a[1].boosts)
        .slice(0, 5)
      const topLines: string[] = []
      for (let i = 0; i < top.length; i++) {
        const [raffleId, r] = top[i]
        let title = `Sorteo ${raffleId.slice(-4)}`
        try {
          const doc: any = await RaffleModel.findById(raffleId).select('chatId')
          if (doc) {
            const c: any = await ctx.telegram.getChat(doc.chatId)
            title = c.title || (c.username ? `@${c.username}` : title)
          }
        } catch {
          // keep the short id
        }
        topLines.push(`${i + 1}. ${esc(title)} · ${pl(r.boosts, 'boost', 'boosts')} · ${pl(r.buyers.size, 'comprador', 'compradores')}`)
      }

      const best = list
        .sort((a, b) => b.boosts - a.boosts)
        .slice(0, 3)
        .map((b) => `• ${esc(b.name || 'Sin nombre')} · ${pl(b.boosts, 'boost', 'boosts')} · ${pl(b.purchases, 'compra', 'compras')}`)

      const sinceTxt = since ? ` (desde ${since.toISOString().slice(0, 10)})` : ''
      return ctx.replyWithHTML(
        `👥 <b>Clientes</b>${sinceTxt}\n\n` +
          `🛒 Compradores: <b>${total}</b>\n` +
          `🔁 Repiten: <b>${repeat}</b> (${f1((repeat / total) * 100)}%)\n` +
          `📦 Compras por comprador: <b>${f1(purchases / total)}</b>\n` +
          `🚀 Boosts por comprador: <b>${f1(boosts / total)}</b>\n` +
          `💰 Gasto medio: <b>${f1(stars / total)}⭐</b>` +
          (usdt ? ` + <b>${formatUnits(Math.round(usdt / total))} USDT</b>` : '') +
          `\n\n🔝 <b>Sorteos con más boosts</b>\n${topLines.join('\n')}` +
          `\n\n🏅 <b>Mejores compradores</b>\n${best.join('\n')}`,
        { disable_web_page_preview: true }
      )
    } catch (err) {
      console.error('Client stats failed', err)
      return ctx.reply('❌ No se pudieron calcular las estadísticas.')
    }
  })
}
