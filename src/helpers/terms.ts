// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { findChat } from '../models/chat'
import { PaymentModel } from '../models/payment'
import { loc } from './locale'

/** Who users should contact: SUPPORT_CONTACT (e.g. @mysupport) or the bot owner */
export function supportContact() {
  const contact = (process.env.SUPPORT_CONTACT || '').trim()
  if (contact) return contact.startsWith('@') ? contact : `@${contact}`
  const admin = parseInt(process.env.ADMIN, 10)
  return admin ? `<a href="tg://user?id=${admin}">admin</a>` : 'admin'
}

/** Full terms text in the given language */
export function termsText(language: string) {
  return loc('terms_text', language).replace('$contact', supportContact())
}

/** Has this user accepted the terms (stored on their private chat) */
export async function hasAcceptedTerms(userId: number) {
  const chat = await findChat(userId)
  return !!chat.termsAccepted
}

/** Marks the terms as accepted for this user */
export async function acceptTerms(userId: number) {
  const chat = await findChat(userId)
  chat.termsAccepted = true
  chat.termsAcceptedAt = new Date()
  await chat.save()
}

/**
 * /terms, /support and /paysupport, required by Telegram for bots
 * that sell digital goods with Stars
 * @param bot Bot to setup
 */
export function setupTerms(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('terms', async (ctx) => {
    const chat = await findChat(ctx.chat.id)
    return ctx.replyWithHTML(termsText(chat.language), {
      disable_web_page_preview: true,
    })
  })

  bot.command('support', async (ctx) => {
    const chat = await findChat(ctx.chat.id)
    return ctx.replyWithHTML(
      loc('support_text', chat.language).replace('$contact', supportContact()),
      { disable_web_page_preview: true }
    )
  })

  bot.command('paysupport', async (ctx) => {
    const chat = await findChat(ctx.chat.id)
    let list = ''
    if (ctx.chat.type === 'private') {
      const payments = await PaymentModel.find({ userId: ctx.from.id })
        .sort({ createdAt: -1 })
        .limit(5)
      list = payments
        .map((p: any) => {
          const date = p.createdAt
            ? new Date(p.createdAt).toISOString().slice(0, 16).replace('T', ' ')
            : ''
          return `• ${date} · ${p.stars}⭐ · ${p.status} · <code>${p.chargeId}</code>`
        })
        .join('\n')
    }
    return ctx.replyWithHTML(
      `${loc('paysupport_text', chat.language).replace(
        '$contact',
        supportContact()
      )}${
        list
          ? `\n\n${loc('paysupport_list', chat.language)}\n${list}`
          : ''
      }`,
      { disable_web_page_preview: true }
    )
  })
}
