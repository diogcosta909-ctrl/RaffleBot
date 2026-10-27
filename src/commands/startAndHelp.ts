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
    return sendStart(ctx)
  })
  bot.command('help', sendHelp)
}

/** Short presentation for everybody who opens the bot (one button: buy boosts) */
async function sendStart(ctx: ContextMessageUpdate) {
  const chat = await findChat(ctx.chat.id)
  return ctx.reply(loc('start_text', chat.language), {
    disable_notification: true,
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: loc('start_boost_btn', chat.language), callback_data: 'r~0' }],
        [{ text: loc('start_boostall_btn', chat.language), callback_data: 'ba~0' }],
        [{ text: '🔁 Auto-Boost', callback_data: 'ab~m' }],
      ],
    },
  } as any)
}

async function sendHelp(ctx: ContextMessageUpdate) {
  // Check if admin
  const isAdmin = await checkIfAdmin(ctx)
  if (!isAdmin) return
  // Get chat
  const chat = await findChat(ctx.chat.id)
  // Reply
  ctx.replyWithMarkdown(loc('public_help_start', chat.language), {
    disable_notification: true,
    disable_web_page_preview: true,
  })
}
