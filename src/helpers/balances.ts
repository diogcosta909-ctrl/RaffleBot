// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { ChatModel } from '../models/chat'
import { CreditTxModel } from '../models/creditTx'
import { CREDIT_PACKS, bonusFor } from './credits'

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface Row {
  balance: number
  bought: number // credits paid for (Stars / USDT)
  bonus: number // free credits that came with a pack
  codes: number // free credits from codes
  manual: number // given or corrected by the owner (/addcredits) and refunds
  spent: number
  left: number // free credits still in the balance
}

const empty = (): Row => ({ balance: 0, bought: 0, bonus: 0, codes: 0, manual: 0, spent: 0, left: 0 })

/** Free credits inside a topup row: saved with the row, or worked out from the pack size for older rows */
function bonusOfTopup(delta: number, saved: number | undefined) {
  if (typeof saved === 'number') return Math.max(0, Math.min(saved, delta))
  for (const n of CREDIT_PACKS) {
    if (n + bonusFor(n) === delta) return bonusFor(n)
  }
  return 0
}

/** Credits movements of every user, split into paid / free / spent */
async function collect(userId?: number) {
  const rows = new Map<number, Row>()
  const get = (id: number) => {
    let r = rows.get(id)
    if (!r) {
      r = empty()
      rows.set(id, r)
    }
    return r
  }
  const match: any = userId ? { userId } : {}
  const groups: any[] = await CreditTxModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: { userId: '$userId', type: '$type', delta: '$delta', free: '$free' },
        n: { $sum: 1 },
      },
    },
  ])
  for (const g of groups) {
    const { userId: id, type, delta, free } = g._id
    const n = g.n as number
    const r = get(id)
    if (type === 'topup') {
      const bonus = bonusOfTopup(delta, free)
      r.bought += (delta - bonus) * n
      r.bonus += bonus * n
    } else if (type === 'code') {
      r.codes += delta * n
    } else if (type === 'spend') {
      r.spent += -delta * n
    } else {
      r.manual += delta * n
    }
  }
  const chats: any[] = await ChatModel.find(userId ? { chatId: userId } : { chatId: { $gt: 0 }, credits: { $gt: 0 } }).select(
    'chatId credits freeCredits'
  )
  for (const c of chats) {
    const r = get(c.chatId)
    r.balance = c.credits || 0
    r.left = Math.min(c.freeCredits || 0, r.balance)
  }
  return rows
}

async function nameOf(telegram: any, id: number) {
  try {
    const c: any = await telegram.getChat(id)
    const name = c.username ? `@${c.username}` : `${c.first_name || ''}${c.last_name ? ` ${c.last_name}` : ''}`.trim()
    return `<a href="tg://user?id=${id}">${esc(name || `${id}`)}</a>`
  } catch {
    return `<a href="tg://user?id=${id}">${id}</a>`
  }
}

const line = (r: Row) => `💰 ${r.balance} · 🎁 ${r.left} · 💳 ${r.bought} · 🚀 ${r.spent}`

/**
 * /saldos (owner, private): who has credits and where they came from.
 * /saldos USER_ID: the detail of one person.
 */
export function setupBalances(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('saldos', async (ctx: any) => {
    const admin = parseInt(process.env.ADMIN, 10)
    if (!admin || ctx.chat.type !== 'private' || ctx.from.id !== admin) return
    try {
      const arg = (ctx.message.text || '').split(/\s+/)[1]
      if (arg && /^\d+$/.test(arg)) {
        const id = parseInt(arg, 10)
        const r = (await collect(id)).get(id) || empty()
        return ctx.replyWithHTML(`${await nameOf(ctx.telegram, id)}\n${line(r)}`)
      }
      const rows = await collect()
      const list = Array.from(rows.entries())
        .filter(([, r]) => r.balance > 0)
        .sort((a, b) => b[1].balance - a[1].balance)
      if (!list.length) return ctx.reply('Nadie tiene créditos ahora mismo.')
      const total = list.reduce((sum, [, r]) => sum + r.balance, 0)
      const lines: string[] = []
      for (const [id, r] of list.slice(0, 15)) {
        lines.push(`${await nameOf(ctx.telegram, id)}\n${line(r)}`)
      }
      return ctx.replyWithHTML(`💰 <b>Saldos</b> · ${list.length} · ${total}\n\n${lines.join('\n\n')}${list.length > 15 ? `\n\n… +${list.length - 15}` : ''}`)
    } catch (err) {
      console.error('Balances failed', err)
      return ctx.reply('❌ No se pudo calcular los saldos.')
    }
  })
}
