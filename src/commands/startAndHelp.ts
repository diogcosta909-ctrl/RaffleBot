// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { checkIfAdmin } from '../helpers/checkAdmin'
import { findChat } from '../models/chat'
import { loc, START_COMMAND } from '../helpers/locale'
import * as fs from 'fs'
import * as path from 'path'
import { registerReferral } from '../helpers/referral'

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
    // Deep link from the feed: /start spin opens the daily spin
    if (ctx.chat.type === 'private' && /^\/start(?:@\w+)?\s+spin$/.test((ctx.message && ctx.message.text) || '')) {
      return require('../helpers/wheel').spinFromStart(ctx)
    }
    const m = /^\/start(?:@\w+)?\s+(ref_\d+)$/.exec((ctx.message && ctx.message.text) || '')
    if (m) await registerReferral(ctx.from.id, m[1])
    return sendStart(ctx)
  })
  bot.command('help', sendHelp)
}

const START_IMAGE = path.join(__dirname, '..', '..', 'assets', 'start.png')
// Telegram file id after the first upload (the next /start reuses it)
let startPhotoId = ''

/** Presentation photo with the short intro as caption and the main buttons */
async function sendStart(ctx: ContextMessageUpdate) {
  const chat = await findChat(ctx.chat.id)
  const extra: any = {
    parse_mode: 'HTML',
    disable_notification: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: loc('start_boost_btn', chat.language), callback_data: 'r~0' }],
        [{ text: '🔁 Auto-Boost', callback_data: 'ab~m' }],
        [{ text: '🎡 Daily spin · win free Boosts', callback_data: 'wh~' }],
        [{ text: '👥 Invite & earn 10%', callback_data: 'inv~' }],
      ],
    },
  }
  let text = loc('start_text', chat.language)
  const count = await require('../helpers/autoBoost').autoBoostCountLine()
  if (count) {
    const i = text.indexOf('\n\n👇')
    text = i >= 0 ? `${text.slice(0, i)}\n${count}${text.slice(i)}` : `${text}\n\n${count}`
  }
  if (startPhotoId || fs.existsSync(START_IMAGE)) {
    try {
      const sent: any = await ctx.replyWithPhoto(startPhotoId || { source: fs.readFileSync(START_IMAGE) }, Object.assign({ caption: text }, extra))
      if (!startPhotoId && sent && sent.photo && sent.photo.length) startPhotoId = sent.photo[sent.photo.length - 1].file_id
      return sent
    } catch (err) {
      console.error('Start photo failed', err)
      startPhotoId = ''
    }
  }
  return ctx.reply(text, Object.assign({ disable_web_page_preview: true }, extra))
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
