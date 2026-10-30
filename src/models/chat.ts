// Dependencies
import { arrayProp, prop, Typegoose } from 'typegoose'
import { Message } from 'telegram-typings'

export class Chat extends Typegoose {
  @prop({ required: true, index: true })
  chatId: number
  @prop({ required: true, default: 'en' })
  language: string
  @prop({ required: true, default: 1 })
  number: number
  @prop()
  subscribe?: string
  @prop({ required: true, default: false })
  nodelete: boolean
  // Payment terms accepted (stored on the user's private chat)
  @prop({ default: false })
  termsAccepted?: boolean
  @prop()
  termsAcceptedAt?: Date
  // Owner's chat only: /stars stats count from this date (set by /resetstars)
  @prop()
  statsResetAt?: Date
  // Owner's chat only: day (Andorra time) the weekly Top Boosters post was sent
  @prop()
  topPostedDay?: string
  // Owner's chat only: day (Andorra time) the daily summary was sent, and giveaways total at that moment
  @prop()
  reportDay?: string
  @prop()
  reportGiveaways?: number
  // Group chats: pinned /winners message that updates after every draw
  @prop()
  hofMessageId?: number
  // Giveaways finished in this chat (kept forever, for the /winners ranking)
  @prop({ default: 0 })
  giveawaysDone?: number
  @prop({ required: true, default: false })
  boost: boolean
  // Boost credits (private chats): 1 credit = 1 boost
  @prop({ default: 0 })
  credits?: number
  // Part of the credits balance that came free (gift codes, pack bonus); spent first
  @prop({ default: 0 })
  freeCredits?: number
  // Free credits by grant date, so they can expire ({ n, at, warned })
  @arrayProp({ default: [], items: Object })
  freeLots?: any[]
  // Auto-Boost (private chats): Boosts added automatically to every giveaway the person joins (0 = off)
  @prop({ default: 0 })
  autoBoost?: number
  // Daily limit of credits Auto-Boost may spend
  @prop({ default: 10 })
  autoBoostLimit?: number
  // Day (Andorra time) of the counter below and credits spent that day by Auto-Boost
  @prop()
  autoBoostDay?: string
  @prop({ default: 0 })
  autoBoostSpent?: number
  // Giveaways joined in a row without credits (3 turns Auto-Boost off)
  @prop({ default: 0 })
  autoBoostMissed?: number
  // Set when Auto-Boost paused for lack of credits (the "paused" notice is sent once)
  @prop()
  autoBoostPausedAt?: Date
  // Day the "daily limit reached" notice was sent
  @prop()
  autoBoostLimitDay?: string
  // One-time recharge gift offered to a paused person (+1 free credit on their next recharge)
  @prop({ default: false })
  autoBoostGift?: boolean
  // Credits spent by Auto-Boost in total
  @prop({ default: 0 })
  autoBoostTotal?: number
  // Giveaways boosted by Auto-Boost in a row (every 10 = +1 free Boost; resets when it pauses or turns off)
  @prop({ default: 0 })
  autoBoostStreak?: number
  // Giveaways boosted by Auto-Boost in total (tiers: Bronze 10, Silver 50, Gold 100)
  @prop({ default: 0 })
  autoBoostCount?: number
  // Who invited this person (user id) and whether the invite reward was already paid
  @prop({ index: true })
  referredBy?: number
  @prop({ default: false })
  referralRewarded?: boolean
  // Invite commission: 10% of the Boosts bought by invited friends (fractions wait here until they reach 1)
  @prop({ default: 0 })
  refPending?: number
  // Telegram @username in lowercase (saved when the person writes to the bot)
  @prop({ index: true })
  username?: string
  // Value of each entry (1 normally, 1.5 or 2 on special days)
  @prop({ default: 1 })
  entryValue?: number
  // Boost multiplier (1 normally, 2 or 3 on special days)
  @prop({ default: 1 })
  boostMultiplier?: number

  @prop()
  raffleMessage?: Message
  @prop()
  winnerMessage?: Message

  @arrayProp({ required: true, default: [], items: Number })
  adminChatIds: number[]
  @prop()
  editedChatId?: number
}

// Get Chat model
export const ChatModel = new Chat().getModelForClass(Chat)

/**
 * Returns chat, creates one if required
 * @param chatId Chat id of the chat
 * @returns requestedchat
 */
export async function findChat(chatId: number) {
  let chat = await ChatModel.findOne({ chatId })
  if (!chat) {
    chat = new ChatModel({ chatId })
    chat = await chat.save()
  }
  return chat
}
