// Dependencies
import { ChatModel } from '../models/chat'
import { CreditTxModel } from '../models/creditTx'
import { FREE_DAYS } from './credits'

const DAY = 24 * 60 * 60 * 1000

async function dm(telegram: any, userId: number, text: string, keyboard: any[]) {
  try {
    await telegram.sendMessage(userId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: keyboard },
    })
  } catch {
    // blocked the bot or never opened it: nothing to do
  }
}

const plural = (n: number) => `${n} free ${n === 1 ? 'Boost' : 'Boosts'}`

/**
 * Free credits (gifts, pack bonus) last FREE_DAYS days; bought credits never expire.
 * Lots remember when free credits arrived. The balance stays the truth: lots are trimmed or
 * completed to match it (older balances without a date start counting from now).
 */
export async function expireFreeCredits(telegram: any) {
  if (FREE_DAYS <= 0) return
  const now = Date.now()
  const chats: any[] = await ChatModel.find({
    chatId: { $gt: 0 },
    $or: [{ freeCredits: { $gt: 0 } }, { 'freeLots.0': { $exists: true } }],
  })
  for (const c of chats) {
    try {
      const free = Math.max(0, Math.min(c.freeCredits || 0, c.credits || 0))
      let lots: any[] = (c.freeLots || [])
        .map((l: any) => ({ n: l.n, at: new Date(l.at), warned: !!l.warned }))
        .sort((a: any, b: any) => +a.at - +b.at)
      let sum = lots.reduce((a, l) => a + l.n, 0)
      // Spent free credits leave the oldest lots first
      while (sum > free && lots.length) {
        const extra = sum - free
        if (lots[0].n <= extra) {
          sum -= lots[0].n
          lots.shift()
        } else {
          lots[0].n -= extra
          sum = free
        }
      }
      if (sum < free) lots.push({ n: free - sum, at: new Date(), warned: false })
      // Expired lots
      const limit = now - FREE_DAYS * DAY
      const expired = lots.filter((l) => +l.at <= limit)
      const keep = lots.filter((l) => +l.at > limit)
      const expireN = expired.reduce((a, l) => a + l.n, 0)
      // Heads-up one day before
      const warnLimit = now - (FREE_DAYS - 1) * DAY
      const toWarn = keep.filter((l) => +l.at <= warnLimit && !l.warned)
      const warnN = toWarn.reduce((a, l) => a + l.n, 0)
      toWarn.forEach((l) => (l.warned = true))
      if (expireN > 0) {
        const ok: any = await ChatModel.findOneAndUpdate(
          { chatId: c.chatId, credits: { $gte: expireN }, freeCredits: { $gte: expireN } },
          { $inc: { credits: -expireN, freeCredits: -expireN }, $set: { freeLots: keep } },
          { new: true }
        )
        if (!ok) continue // balance moved meanwhile; try again next round
        try {
          await CreditTxModel.create({
            userId: c.chatId,
            delta: -expireN,
            balanceAfter: ok.credits || 0,
            type: 'expire',
            method: 'expire',
          })
        } catch (err) {
          console.error('Expiry not logged', err)
        }
        await dm(
          telegram,
          c.chatId,
          `⏳ <b>${plural(expireN)} expired</b>\n\nFree Boosts last ${FREE_DAYS} days. The Boosts you buy never expire.`,
          [[{ text: 'Buy Boosts', callback_data: 'r~0' }]]
        )
        if (warnN > 0) {
          // those warned lots were not expired; save the flag
          await ChatModel.updateOne({ chatId: c.chatId }, { $set: { freeLots: keep } })
        }
      } else {
        await ChatModel.updateOne({ chatId: c.chatId }, { $set: { freeLots: keep } })
      }
      if (warnN > 0) {
        await dm(
          telegram,
          c.chatId,
          `⏳ <b>${plural(warnN)} expire tomorrow</b>\n\nUse them before they are gone 👇`,
          [
            [{ text: '🎯 Boost active giveaways', callback_data: 'ba~0' }],
            [{ text: '🔁 Auto-Boost', callback_data: 'ab~m' }],
          ]
        )
      }
    } catch (err) {
      console.error('Free credits expiry failed for', c.chatId, err)
    }
  }
}
