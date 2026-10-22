// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { ChatModel } from '../models/chat'
import { CreditTxModel } from '../models/creditTx'
import { PaymentModel } from '../models/payment'
import { CryptoOrderModel } from '../models/cryptoOrder'

const seen = new Map<number, string>()

/** Remembers the @username of everybody who writes to the bot in private (so the owner can use @names) */
export function setupUserLookup(bot: Telegraf<ContextMessageUpdate>) {
  bot.use(async (ctx: any, next: any) => {
    try {
      const u = ctx.from
      if (u && u.username && ctx.chat && ctx.chat.type === 'private') {
        const name = `${u.username}`.toLowerCase()
        if (seen.get(u.id) !== name) {
          seen.set(u.id, name)
          ChatModel.updateOne({ chatId: u.id }, { username: name })
            .then((r: any) => {
              if (!r || !r.n) seen.delete(u.id)
            })
            .catch(() => seen.delete(u.id))
        }
      }
    } catch {
      // never block the update
    }
    return next()
  })
}

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** User id from "@username" or a plain id (undefined when the person is not known to the bot) */
export async function resolveUser(arg: string): Promise<number | undefined> {
  const value = `${arg || ''}`.trim()
  if (/^\d+$/.test(value)) return parseInt(value, 10)
  const name = value.replace(/^@/, '')
  if (!/^[A-Za-z0-9_]{3,}$/.test(name)) return undefined
  const chat: any = await ChatModel.findOne({ username: name.toLowerCase() }).select('chatId')
  if (chat) return chat.chatId
  // People who used the bot before usernames were saved: look in their payments and credit movements
  const re = new RegExp(`^@?${esc(name)}$`, 'i')
  const tx: any = await CreditTxModel.findOne({ name: re }).select('userId')
  if (tx) return tx.userId
  const pay: any = await PaymentModel.findOne({ userName: re }).select('userId')
  if (pay) return pay.userId
  const order: any = await CryptoOrderModel.findOne({ username: re }).select('userId')
  if (order) return order.userId
  return undefined
}
