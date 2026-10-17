// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { ChatModel } from '../models/chat'

// Pending announcements waiting for the owner's confirmation (one per owner)
type Pending =
  | { kind: 'copy'; fromChat: number; messageId: number; at: number }
  | { kind: 'text'; text: string; at: number }
const pending = new Map<number, Pending>()
let sending = false

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isAdmin(ctx: any) {
  const admin = parseInt(process.env.ADMIN, 10)
  return !!admin && !!ctx.from && ctx.from.id === admin && ctx.chat.type === 'private'
}

/** Private chats of the users who accepted the terms */
async function recipients(): Promise<number[]> {
  const chats: any[] = await ChatModel.find({
    termsAccepted: true,
    chatId: { $gt: 0 },
  }).select('chatId')
  return chats.map((c) => c.chatId)
}

async function deliver(telegram: any, to: number, p: Pending) {
  if (p.kind === 'copy') {
    return telegram.callApi('copyMessage', {
      chat_id: to,
      from_chat_id: p.fromChat,
      message_id: p.messageId,
    })
  }
  return telegram.sendMessage(to, p.text, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
}

/**
 * /broadcast (owner only, private chat): sends an announcement to everyone who accepted the terms.
 * Reply /broadcast to any message (text, photo, video... formatting is kept), or write
 * /broadcast your text (HTML allowed). The owner gets a preview and confirms before it is sent.
 */
export function setupBroadcast(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('broadcast', async (ctx: any) => {
    if (!isAdmin(ctx)) return
    const reply = ctx.message.reply_to_message
    const inline = (ctx.message.text || '').replace(/^\/broadcast(@\w+)?\s*/i, '').trim()
    let p: Pending
    if (reply) {
      p = { kind: 'copy', fromChat: ctx.chat.id, messageId: reply.message_id, at: Date.now() }
    } else if (inline) {
      p = { kind: 'text', text: inline, at: Date.now() }
    } else {
      return ctx.replyWithHTML(
        '📣 <b>Comunicados</b>\n\nResponde con /broadcast a cualquier mensaje (texto, foto o vídeo) o escribe:\n<code>/broadcast tu texto</code>\n\nSe envía por privado a todos los que aceptaron los términos. Antes verás una vista previa para confirmar.'
      )
    }
    try {
      await deliver(ctx.telegram, ctx.chat.id, p)
    } catch (err) {
      return ctx.reply(`❌ No se puede enviar ese mensaje: ${(err && err.message) || err}`)
    }
    pending.set(ctx.from.id, p)
    const total = (await recipients()).length
    return ctx.reply(`👆 Vista previa. ¿Enviar a ${total} usuarios?`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: `✅ Enviar a ${total}`, callback_data: 'bc~ok' },
            { text: '❌ Cancelar', callback_data: 'bc~no' },
          ],
        ],
      },
    } as any)
  })

  bot.action(/^bc~(ok|no)$/, async (ctx: any) => {
    try {
      await ctx.answerCbQuery()
    } catch {
      // do nothing
    }
    if (!isAdmin(ctx)) return
    const p = pending.get(ctx.from.id)
    const edit = (text: string) => ctx.editMessageText(text).catch((): any => undefined)
    if (ctx.match[1] === 'no') {
      pending.delete(ctx.from.id)
      return edit('❌ Cancelado.')
    }
    if (!p || Date.now() - p.at > 30 * 60000) {
      pending.delete(ctx.from.id)
      return edit('⌛ La vista previa caducó. Vuelve a usar /broadcast.')
    }
    if (sending) return edit('⏳ Ya hay un envío en curso.')
    pending.delete(ctx.from.id)
    sending = true
    const telegram = ctx.telegram
    const adminId = ctx.from.id
    ;(async () => {
      const ids = await recipients()
      await edit(`📤 Enviando a ${ids.length} usuarios...`)
      let sent = 0
      let failed = 0
      for (const id of ids) {
        try {
          await deliver(telegram, id, p)
          sent++
        } catch (err) {
          const wait429 = err && err.parameters && err.parameters.retry_after
          if (wait429) {
            await wait((wait429 + 1) * 1000)
            try {
              await deliver(telegram, id, p)
              sent++
              continue
            } catch {
              // counted below
            }
          }
          failed++
        }
        await wait(50) // ~20 messages per second, under Telegram's limit
      }
      await telegram.sendMessage(
        adminId,
        `✅ Comunicado enviado\n📬 Recibidos: ${sent}\n🚫 Fallidos (bloquearon el bot o borraron la cuenta): ${failed}`
      )
    })()
      .catch((err) => console.error('Broadcast failed', err))
      .then(() => {
        sending = false
      })
  })
}
