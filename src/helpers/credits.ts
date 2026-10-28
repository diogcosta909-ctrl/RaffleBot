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

/** Largest pack that comes with free bonus credits (null when no pack has a bonus) */
export function bestBonus() {
  let best: { pack: number; bonus: number } = null
  for (const pack of CREDIT_PACKS) {
    const bonus = BONUS[pack] || 0
    if (bonus > 0 && (!best || pack > best.pack)) best = { pack, bonus }
  }
  return best
}

/** Pack marked as popular in RECHARGE (CREDIT_POPULAR, default 10; 0 = none) */
export const CREDIT_POPULAR = parseInt(process.env.CREDIT_POPULAR || '10', 10)

/** Days free credits (gifts, pack bonus) last; credits you buy never expire. 0 = free credits never expire */
export const FREE_DAYS = Math.max(0, parseInt(process.env.CREDIT_FREE_DAYS || '7', 10) || 0)

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
  tx: { type: string; method?: string; ref?: string; raffleId?: string; free?: number }
) {
  const freeN = tx.free && tx.free > 0 ? tx.free : 0
  const update: any = { $inc: { credits: n, freeCredits: freeN } }
  // Remember when the free credits arrived so they can expire
  if (freeN > 0) update.$push = { freeLots: { n: freeN, at: new Date(), warned: false } }
  const chat: any = await ChatModel.findOneAndUpdate({ chatId: userId }, update, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  })
  const balance = chat.credits || 0
  await log(userId, n, balance, tx)
  // Auto-Boost: a recharge resumes it (and gives the one-time gift if it was offered)
  if (n > 0 && (tx.type === 'topup' || tx.type === 'code') && chat.autoBoost > 0) {
    try {
      require('./autoBoost').afterCredit(userId, tx.type)
    } catch (err) {
      console.error('Auto-Boost resume failed', err)
    }
  }
  return balance
}

/**
 * Owner: takes Boosts off a balance (manual refund). Never goes below 0: removes what is there.
 * Bought Boosts go first, free ones last. Returns how many were removed and the new balance.
 */
export async function removeCredits(userId: number, n: number) {
  const chat: any = await ChatModel.findOne({ chatId: userId }).select('credits freeCredits')
  const balance = (chat && chat.credits) || 0
  const take = Math.max(0, Math.min(n, balance))
  if (take <= 0) return { removed: 0, balance }
  const free = Math.max(0, Math.min((chat && chat.freeCredits) || 0, balance))
  const bought = balance - free
  const freeTake = Math.max(0, take - bought)
  const upd: any = await ChatModel.findOneAndUpdate(
    { chatId: userId, credits: { $gte: take } },
    { $inc: { credits: -take, freeCredits: -freeTake } },
    { new: true }
  )
  if (!upd) return { removed: 0, balance }
  const after = upd.credits || 0
  await log(userId, -take, after, { type: 'admin', method: 'admin_remove' })
  return { removed: take, balance: after }
}

/** Spends credits atomically, free (gift) credits first. Returns the new balance (-1 when there are not enough) and how many were free */
export async function spendCreditsSplit(
  userId: number,
  n: number,
  tx: { raffleId?: string; method?: string; name?: string; chatId?: number }
) {
  const old: any = await ChatModel.findOneAndUpdate(
    { chatId: userId, credits: { $gte: n } },
    { $inc: { credits: -n } },
    { new: false }
  )
  if (!old) return { balance: -1, free: 0 }
  const free = Math.max(0, Math.min(old.freeCredits || 0, n))
  if (free > 0) await ChatModel.updateOne({ chatId: userId }, { $inc: { freeCredits: -free } })
  const balance = (old.credits || 0) - n
  await log(userId, -n, balance, { type: 'spend', method: 'credits', ...tx })
  return { balance, free }
}

/** Same as spendCreditsSplit, returning only the balance */
export async function spendCredits(
  userId: number,
  n: number,
  tx: { raffleId?: string; method?: string; name?: string; chatId?: number }
) {
  return (await spendCreditsSplit(userId, n, tx)).balance
}
