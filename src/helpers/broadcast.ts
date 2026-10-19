// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { ChatModel } from '../models/chat'
import { PaymentModel } from '../models/payment'
import { CryptoOrderModel } from '../models/cryptoOrder'
import { BoostEventModel } from '../models/boostEvent'

// Pending announcements waiting for the owner's confirmation (one per owner)
type Pending = { segment: string; button?: boolean; at: number } & (
  | { kind: 'copy'; fromChat: number; messageId: number }
  | { kind: 'text'; text: string }
)

// Who receives the announcement (everyone is limited to users who accepted the terms)
const SEGMENTS: { [key: string]: string } = {
  me: 'solo tú (prueba)',
  all: 'todos los que aceptaron los términos',
  everyone: 'todos los que han interactuado con el bot',
  buyers: 'compradores',
  nonbuyers: 'los que nunca compraron',
  credits: 'con créditos',
  inactive: 'inactivos (30 días sin usar Boost)',
}
const pending = new Map<number, Pending>()
let sending = false

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isAdmin(ctx: any) {
  const admin = parseInt(process.env.ADMIN, 10)
  return !!admin && !!ctx.from && ctx.from.id === admin && ctx.chat.type === 'private'
}

/** Private chats of the users who accepted the terms, filtered by segment */
async function recipients(segment = 'all'): Promise<number[]> {
  if (segment === 'me') return [parseInt(process.env.ADMIN, 10)]
  const query: any = { termsAccepted: true, chatId: { $gt: 0 } }
  if (segment === 'everyone') delete query.termsAccepted
  if (segment === 'credits') query.credits = { $gt: 0 }
  const chats: any[] = await ChatModel.find(query).select('chatId')
  let ids = chats.map((c) => c.chatId as number)
  if (segment === 'everyone') {
    // Also anyone who tapped a Boost button, even if they never accepted the terms
    const clicked: number[] = await BoostEventModel.distinct('userId', { userId: { $gt: 0 } })
    ids = Array.from(new Set<number>([...ids, ...clicked]))
  }
  if (segment === 'buyers' || segment === 'nonbuyers') {
    const buyers = new Set<number>([
      ...(await PaymentModel.distinct('userId', { status: 'applied' })),
      ...(await CryptoOrderModel.distinct('userId', { status: 'paid' })),
    ])
    ids = ids.filter((id) => (segment === 'buyers' ? buyers.has(id) : !buyers.has(id)))
  }
  if (segment === 'inactive') {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const active = new Set<number>(await BoostEventModel.distinct('userId', { createdAt: { $gte: since } }))
    ids = ids.filter((id) => !active.has(id))
  }
  return ids
}

/** Optional button under the announcement: opens the recharge screen in the bot */
function buttonOf(p: Pending) {
  return p.button
    ? { inline_keyboard: [[{ text: '🚀 Buy Boosts', callback_data: 'r~0' }]] }
    : undefined
}

async function deliver(telegram: any, to: number, p: Pending) {
  if (p.kind === 'copy') {
    return telegram.callApi('copyMessage', {
      chat_id: to,
      from_chat_id: p.fromChat,
      message_id: p.messageId,
      reply_markup: buttonOf(p),
    })
  }
  return telegram.sendMessage(to, p.text, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: buttonOf(p),
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
    let inline = (ctx.message.text || '').replace(/^\/broadcast(@\w+)?\s*/i, '').trim()
    // Optional first word: segment (all, buyers, nonbuyers, credits, inactive)
    let segment = 'all'
    const first = inline.split(/\s+/)[0].toLowerCase()
    if (SEGMENTS[first]) {
      segment = first
      inline = inline.slice(first.length).trim()
    }
    // Optional next word "boost": adds a "Buy Boosts" button that opens the recharge screen
    let button = false
    if (inline.split(/\s+/)[0].toLowerCase() === 'boost') {
      button = true
      inline = inline.slice(5).trim()
    }
    let p: Pending
    if (reply) {
      p = { segment, button, kind: 'copy', fromChat: ctx.chat.id, messageId: reply.message_id, at: Date.now() }
    } else if (inline) {
      p = { segment, button, kind: 'text', text: inline, at: Date.now() }
    } else {
      return ctx.replyWithHTML(
        '📣 <b>Comunicados</b>\n\nResponde con /broadcast a cualquier mensaje (texto, foto o vídeo) o escribe:\n<code>/broadcast tu texto</code>\n\nPor defecto va a todos los que aceptaron los términos. Para elegir destinatarios pon una palabra después de /broadcast:\n<code>/broadcast buyers tu texto</code>\n\n• <code>me</code> solo tú (para probar)\n• <code>all</code> los que aceptaron los términos (por defecto)\n• <code>everyone</code> todos los que han interactuado con el bot (aunque no aceptaran los términos)\n• <code>buyers</code> compradores\n• <code>nonbuyers</code> los que nunca compraron\n• <code>credits</code> con créditos\n• <code>inactive</code> 30 días sin usar Boost\n\nPara añadir un botón <b>🚀 Buy Boosts</b> (abre la recarga) pon <code>boost</code> después del destinatario:\n<code>/broadcast me boost tu texto</code>\n\nAntes verás una vista previa y el número de usuarios para confirmar.'
      )
    }
    try {
      await deliver(ctx.telegram, ctx.chat.id, p)
    } catch (err) {
      return ctx.reply(`❌ No se puede enviar ese mensaje: ${(err && err.message) || err}`)
    }
    pending.set(ctx.from.id, p)
    const total = (await recipients(segment)).length
    return ctx.reply(`👆 Vista previa. ¿Enviar a ${total} ${total === 1 ? 'usuario' : 'usuarios'} (${SEGMENTS[segment]})?`, {
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
      const ids = await recipients(p.segment)
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
