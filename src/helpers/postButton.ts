// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { checkIfAdmin } from './checkAdmin'

/**
 * /postbutton (admins, in the group or channel): the bot re-posts a message with a button under it.
 * Reply /postbutton to your post (or write /postbutton your text):
 *   /postbutton        → 🎯 Boost All
 *   /postbutton both   → 🎯 Boost All + 🚀 Buy Boosts
 *   /postbutton boost  → 🚀 Buy Boosts
 *   /postbutton spin   → 🎡 Spin the wheel (daily spin)
 * The original post and the command are deleted when the bot is allowed to.
 */
export function setupPostButton(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('postbutton', async (ctx: any) => {
    if (ctx.chat.type === 'private') return
    if (!(await checkIfAdmin(ctx, false))) return
    const msg = ctx.message || ctx.channelPost
    if (!msg) return
    const body = ((msg.text || '') as string).replace(/^\/postbutton(@\w+)?\s*/i, '')
    const first = body.split(/\s+/)[0].toLowerCase()
    const kind = ['both', 'boost', 'all', 'spin'].indexOf(first) >= 0 ? first : 'all'
    const text = ['both', 'boost', 'all', 'spin'].indexOf(first) >= 0 ? body.slice(first.length).trim() : body.trim()
    const bot_ = process.env.USERNAME
    const all = { text: '🎯 Boost All', url: `https://t.me/${bot_}?start=boostall` }
    const buy = { text: '🚀 Buy Boosts', url: `https://t.me/${bot_}?start=recharge` }
    const spin = { text: '🎡 Spin the wheel', url: `https://t.me/${bot_}?start=spin` }
    const rows = kind === 'spin' ? [[spin]] : kind === 'boost' ? [[buy]] : kind === 'both' ? [[all], [buy]] : [[all]]
    const reply_markup = { inline_keyboard: rows }
    const reply = msg.reply_to_message
    try {
      if (reply) {
        await ctx.telegram.callApi('copyMessage', {
          chat_id: ctx.chat.id,
          from_chat_id: ctx.chat.id,
          message_id: reply.message_id,
          reply_markup,
        })
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, reply.message_id)
        } catch {
          // no permission to delete: the original stays
        }
      } else if (text) {
        await ctx.telegram.sendMessage(ctx.chat.id, text, { parse_mode: 'HTML', reply_markup, disable_web_page_preview: true } as any)
      } else {
        return ctx.reply(
          'Reply /postbutton to your post, or write /postbutton your text.\n/postbutton both adds Buy Boosts too.',
          { disable_notification: true }
        )
      }
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id)
      } catch {
        // do nothing
      }
    } catch (err) {
      console.error('postbutton failed', err)
    }
  })
}
