// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { checkIfAdmin } from '../helpers/checkAdmin'
import { startRaffle } from '../helpers/raffle'
import { findChat } from '../models/chat'
import { loc, START_COMMAND } from '../helpers/locale'

/**
 * Setting up the command that starts a raffle (/start)
 * @param bot Bot to setup the command
 */
export function setupStartRaffle(bot: Telegraf<ContextMessageUpdate>) {
  bot.command(START_COMMAND, async ctx => {
    // Check if admin
    const isAdmin = await checkIfAdmin(ctx)
    if (!isAdmin) return
    // Reply
    if (ctx.chat.type === 'private') {
      const chat = await findChat(ctx.chat.id)
      ctx.reply(loc('no_work_private', chat.language))
      return
    } else {
      startRaffle(ctx)
      try {
        await ctx.deleteMessage()
      } catch (err) {
        // Do nothing
      }
    }
  })
}
