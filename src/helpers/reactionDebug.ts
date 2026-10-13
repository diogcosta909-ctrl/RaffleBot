// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'

/**
 * Temporary test: forwards raw reaction updates (message_reaction and
 * message_reaction_count) to the bot owner so we can see what Telegram sends
 * for paid (⭐) reactions in channels.
 */
export function setupReactionDebug(bot: Telegraf<ContextMessageUpdate>) {
  bot.use(async (ctx, next) => {
    const update: any = ctx.update
    const key = update.message_reaction
      ? 'message_reaction'
      : update.message_reaction_count
      ? 'message_reaction_count'
      : undefined
    if (key) {
      try {
        const text = `🧪 ${key}\n${JSON.stringify(update[key], null, 1)}`
        await ctx.telegram.sendMessage(
          parseInt(process.env.ADMIN, 10),
          text.slice(0, 3900)
        )
      } catch (err) {
        console.error('Reaction debug failed', err)
      }
      return
    }
    return next()
  })
}
