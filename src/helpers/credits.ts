// Dependencies
import { ChatModel } from '../models/chat'
import { CreditTxModel } from '../models/creditTx'

/** Credit packs shown in RECHARGE (1 credit = 1 boost) */
export const CREDIT_PACKS = (process.env.CREDIT_PACKS || '5,10,20')
  .split(',')
  .map((x) => parseInt(x.trim(), 10))
  .filter((x) => x > 0)

/** Free credits added on top of a pack, e.g. CREDIT_BONUS=10:1,20:3 (pack:bonus) */
const BONUS: { [pack: number]: number } = {}
;(process.env.CREDIT_BONUS === undefined ? '10:1,20:3' : process.env.CREDIT_BONUS)
  .split(',')
  .forEach((pair) => {
    const [pack, bonus] = pair.split(':').map((x) => parseInt(x.trim(), 10))
    if (pack > 0 && bonus > 0) BONUS[pack] = bonus
  })

export function bonusFor(pack: number) {
  return BONUS[pack] || 0
}

/** Pack marked as popular in RECHARGE (CREDIT_POPULAR, default 10; 0 = none) */
export const CREDIT_POPULAR = parseInt(process.env.CREDIT_POPULAR || '10', 10)

/** Current balance of a user (stored on their private chat) */
export async function getCredits(userId: number) {
  const chat: any = await ChatModel.findOne({ chatId: userId }).select('credits')
  return (chat && chat.credits) || 0
}

async function log(userId: number, delta: number, balance: number, tx: any) {
  try {
    await CreditTxModel.create({ userId, delta, balanceAfter: balance, ...tx })
  } catch (err) {
    console.error('Credit movement not logged', err)
  }
}

/** Adds credits (topup, refund, admin) and returns the new balance */
export async function addCredits(
  userId: number,
  n: number,
  tx: { type: string; method?: string; ref?: string; raffleId?: string }
) {
  const chat: any = await ChatModel.findOneAndUpdate(
    { chatId: userId },
    { $inc: { credits: n } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
  const balance = chat.credits || 0
  await log(userId, n, balance, tx)
  return balance
}

/** Spends credits atomically. Returns the new balance, or -1 when there are not enough */
export async function spendCredits(
  userId: number,
  n: number,
  tx: { raffleId?: string; method?: string; name?: string; chatId?: number }
) {
  const chat: any = await ChatModel.findOneAndUpdate(
    { chatId: userId, credits: { $gte: n } },
    { $inc: { credits: -n } },
    { new: true }
  )
  if (!chat) return -1
  await log(userId, -n, chat.credits, { type: 'spend', method: 'credits', ...tx })
  return chat.credits as number
}
