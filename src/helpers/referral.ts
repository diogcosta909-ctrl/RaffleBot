// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { ChatModel } from '../models/chat'
import { CreditTxModel } from '../models/creditTx'
import { trackAuto } from '../models/autoBoostEvent'
import { addCredits } from './credits'

// Invite friends: you get 10% of every Boost your friend buys, for life. The friend gets +1 free Boost on buying and turning on Auto-Boost.
// Streak and tiers: every 10 giveaways in a row boosted by Auto-Boost = +1 free Boost.
// Texts are in English (they are sent to the users of the bot).

// Share of the Boosts bought by an invited friend that the person who invited gets (lifetime, in Boosts)
export const REFERRAL_PCT = Math.max(0, parseInt(process.env.REFERRAL_PCT || '10', 10) || 0)
export const STREAK_EVERY = 10

let tg: any = null

const link = (userId: number) => `https://t.me/${process.env.USERNAME}?start=ref_${userId}`

/** Tier by giveaways boosted with Auto-Boost (lifetime) */
export function tierOf(count: number) {
  if (count >= 100) return { icon: '🥇', name: 'Gold' }
  if (count >= 50) return { icon: '🥈', name: 'Silver' }
  if (count >= 10) return { icon: '🥉', name: 'Bronze' }
  return null
}

async function send(userId: number, text: string, keyboard?: any[]) {
  if (!tg) return
  try {
    await tg.sendMessage(userId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
    } as any)
  } catch (err) {
    // blocked the bot
  }
}

/** Called after Auto-Boost boosted a giveaway: counts the streak and pays the reward every 10 */
export async function streakStep(userId: number) {
  try {
    const chat: any = await ChatModel.findOneAndUpdate(
      { chatId: userId },
      { $inc: { autoBoostStreak: 1, autoBoostCount: 1 } },
      { new: true }
    )
    if (!chat) return
    const streak = chat.autoBoostStreak || 0
    const count = chat.autoBoostCount || 0
    if (streak > 0 && streak % STREAK_EVERY === 0) {
      await addCredits(userId, 1, { type: 'code', method: 'auto_streak', free: 1 })
      void trackAuto('streak_reward', userId, { n: streak })
      const t = tierOf(count)
      await send(
        userId,
        `🔥 <b>${streak} giveaways in a row with Auto-Boost!</b>\n\n🎁 <b>+1 free Boost</b> added to your balance` +
          (t ? `\n${t.icon} Your tier: <b>${t.name}</b>` : '') +
          `\n\nKeep the streak going 🚀`
      )
    }
  } catch (err) {
    console.error('Streak failed', err)
  }
}

/** The streak starts again (Auto-Boost paused or turned off) */
export async function streakReset(userId: number) {
  try {
    await ChatModel.updateOne({ chatId: userId, autoBoostStreak: { $gt: 0 } }, { $set: { autoBoostStreak: 0 } })
  } catch (err) {
    console.error(err)
  }
}

/** /start ref_<id>: remembers who invited this person (only new people, never yourself) */
export async function registerReferral(userId: number, payload: string) {
  try {
    const m = /^ref_(\d+)$/.exec(payload || '')
    if (!m) return
    const refId = parseInt(m[1], 10)
    if (!refId || refId === userId) return
    const me: any = await ChatModel.findOne({ chatId: userId }).select('referredBy credits')
    if (me && (me.referredBy || me.credits > 0)) return
    const inviter: any = await ChatModel.findOne({ chatId: refId }).select('chatId')
    if (!inviter) return
    const u: any = await ChatModel.updateOne(
      { chatId: userId, referredBy: { $exists: false } },
      { $set: { referredBy: refId } },
      { upsert: true, setDefaultsOnInsert: true }
    )
    if (u && (u.nModified || u.upserted)) void trackAuto('ref_join', userId, { n: refId })
  } catch (err) {
    console.error('Referral not saved', err)
  }
}

/** Checks if the friend bought a pack and has Auto-Boost on: both get +1 free Boost, once */
export async function checkReferral(userId: number) {
  try {
    const chat: any = await ChatModel.findOne({ chatId: userId }).select('referredBy referralRewarded autoBoost')
    if (!chat || !chat.referredBy || chat.referralRewarded || !(chat.autoBoost > 0)) return
    const bought = await CreditTxModel.findOne({ userId, type: 'topup' } as any).select('_id')
    if (!bought) return
    const refId = chat.referredBy
    // Claim the reward first so it is never paid twice
    const claim: any = await ChatModel.updateOne(
      { chatId: userId, referralRewarded: { $ne: true } },
      { $set: { referralRewarded: true } }
    )
    if (!claim || !claim.nModified) return
    await addCredits(userId, 1, { type: 'code', method: 'invite_friend', free: 1 })
    void trackAuto('ref_reward', userId, { n: refId })
    await send(userId, `🎁 <b>Welcome gift</b>\n\nYou bought Boosts and turned on Auto-Boost, so you get <b>+1 free Boost</b> 🚀`)
  } catch (err) {
    console.error('Referral reward failed', err)
  }
}

/** A friend bought a pack: the person who invited gets 10% of those Boosts (fractions add up until 1) */
export async function inviteCommission(userId: number, boosts: number) {
  try {
    if (!REFERRAL_PCT || !(boosts > 0)) return
    const me: any = await ChatModel.findOne({ chatId: userId }).select('referredBy')
    if (!me || !me.referredBy) return
    const refId = me.referredBy
    const inv: any = await ChatModel.findOneAndUpdate(
      { chatId: refId },
      { $inc: { refPending: (boosts * REFERRAL_PCT) / 100 } },
      { new: true }
    )
    if (!inv) return
    const pay = Math.floor(Math.round((inv.refPending || 0) * 1000) / 1000)
    if (pay < 1) return
    const took: any = await ChatModel.updateOne({ chatId: refId, refPending: { $gte: pay } }, { $inc: { refPending: -pay } })
    if (!took || !took.nModified) return
    await addCredits(refId, pay, { type: 'code', method: 'invite_commission', ref: `${userId}` })
    void trackAuto('ref_commission', refId, { k: pay, n: userId })
    await send(
      refId,
      `🎉 <b>Your friend bought Boosts</b>\n\n💰 <b>+${pay} ${pay === 1 ? 'Boost' : 'Boosts'}</b> for you · ${REFERRAL_PCT}% of every purchase, for life`,
      [[{ text: '👥 Invite more friends', callback_data: 'inv~' }]]
    )
  } catch (err) {
    console.error('Invite commission failed', err)
  }
}

export function inviteText(userId: number, invited: number, buyers: number, earned: number) {
  return (
    `👥 <b>Invite friends</b>\n\n` +
    `Share your link and get <b>${REFERRAL_PCT}% of every Boost your friends buy, for life</b>. Paid in Boosts, never expire.\n` +
    `Your friend gets <b>+1 free Boost</b> when they buy and turn on Auto-Boost.\n\n` +
    `🔗 <code>${link(userId)}</code>\n\n` +
    `👆 Joined: <b>${invited}</b>\n🛒 Bought: <b>${buyers}</b>\n💰 Boosts earned: <b>${earned}</b>`
  )
}

export function setupReferral(bot: Telegraf<ContextMessageUpdate>) {
  tg = bot.telegram
  const show = async (ctx: any) => {
    const userId = ctx.from.id
    const invited = await ChatModel.countDocuments({ referredBy: userId })
    const ids: any[] = await ChatModel.find({ referredBy: userId }).select('chatId')
    const paid: any[] = ids.length
      ? await CreditTxModel.distinct('userId', { userId: { $in: ids.map((c) => c.chatId) }, type: 'topup' } as any)
      : []
    const earn: any[] = await CreditTxModel.aggregate([
      { $match: { userId, method: 'invite_commission' } },
      { $group: { _id: null, n: { $sum: '$delta' } } },
    ])
    void trackAuto('invite_open', userId)
    const share = `https://t.me/share/url?url=${encodeURIComponent(link(userId))}&text=${encodeURIComponent('Boost your chances in giveaways 🚀')}`
    await ctx.replyWithHTML(inviteText(userId, invited, paid.length, (earn[0] && earn[0].n) || 0), {
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: '📤 Share link', url: share }]] },
    } as any)
  }
  bot.command('invite', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    try {
      await show(ctx)
    } catch (err) {
      console.error(err)
    }
  })
  bot.action('inv~', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    try {
      await show(ctx)
    } catch (err) {
      console.error(err)
    }
  })
}
