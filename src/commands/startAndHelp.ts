// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { checkIfAdmin } from '../helpers/checkAdmin'
import { findChat } from '../models/chat'
import { loc, START_COMMAND } from '../helpers/locale'

/**
 * Setting up the start and help commands
 * @param bot Bot to setup the commands
 */
export function setupStartAndHelp(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('start', async (ctx, next) => {
    // In groups/channels /start starts a raffle when it is the start command
    if (ctx.chat.type !== 'private' && START_COMMAND === 'start') {
      return next()
    }
    return sendHelp(ctx)
  })
  bot.command('help', sendHelp)
}

async function sendHelp(ctx: ContextMessageUpdate) {
  // Check if admin
  const isAdmin = await checkIfAdmin(ctx)
  if (!isAdmin) return
  // Get chat
  const chat = await findChat(ctx.chat.id)
  // Reply
  const text = `${loc('public_help_start', chat.language)}\n\n${loc(
    'boost_help',
    chat.language
  )}`
  ctx.replyWithMarkdown(text, {
    disable_notification: true,
    disable_web_page_preview: true,
  })
}
