// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { PromoCodeModel } from '../models/promoCode'
import { findChat } from '../models/chat'
import { addCredits } from './credits'
import { loc } from './locale'

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I to avoid typos

function randomCode() {
  let out = ''
  for (let i = 0; i < 8; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

function isAdmin(ctx: any) {
  const admin = parseInt(process.env.ADMIN, 10)
  return !!admin && ctx.from.id === admin && ctx.chat.type === 'private'
}

// Brute-force guard: 5 wrong codes per 10 minutes and user
const fails = new Map<number, number[]>()
function blocked(userId: number) {
  const now = Date.now()
  const list = (fails.get(userId) || []).filter((t) => now - t < 10 * 60000)
  fails.set(userId, list)
  return list.length >= 5
}
function fail(userId: number) {
  const list = fails.get(userId) || []
  list.push(Date.now())
  fails.set(userId, list)
}

/**
 * Credit codes. Owner: /code <credits> [uses] [NAME] [7d] [feed], /codes, /delcode NAME.
 * Users: /redeem CODE.
 */
export function setupCodes(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('code', async (ctx: any) => {
    if (!isAdmin(ctx)) return
    const numbers = (ctx.message.text || '')
      .split(/\s+/)
      .slice(1)
      .filter((p: string) => /^\d+$/.test(p))
      .map((p: string) => parseInt(p, 10))
    const credits = numbers[0]
    if (!credits) {
      return ctx.replyWithHTML(
        '🎁 <b>Códigos de créditos</b>\n\n' +
          '<code>/code 5</code> → 5 créditos para 1 persona\n' +
          '<code>/code 5 5</code> → 5 créditos para cada una de 5 personas\n\n' +
          'Cada persona solo puede canjear un código una vez, y cada canje sale en el feed.\n' +
          '/codes ver los códigos · <code>/delcode CODIGO</code> desactivar'
      )
    }
    const maxUses = numbers[1] || 1
    let code = randomCode()
    let created = false
    for (let tries = 0; tries < 5 && !created; tries++) {
      try {
        await PromoCodeModel.create({ code, credits, maxUses, feed: true })
        created = true
      } catch (err) {
        code = randomCode()
      }
    }
    if (!created) return ctx.reply('❌ No se pudo crear el código, inténtalo otra vez.')
    const bot = process.env.USERNAME
    const share =
      `🎁 Free credits!\n` +
      `Tap to redeem: https://t.me/${bot}?start=redeem_${code}\n` +
      `or send /redeem ${code} to @${bot}`
    return ctx.replyWithHTML(
      `✅ <b>Código creado</b>\n\n<code>${code}</code>\n` +
        `🎁 ${credits} créditos por persona\n` +
        `👥 Hasta ${maxUses} ${maxUses === 1 ? 'persona' : 'personas'}\n\n` +
        `📤 <b>Mensaje para compartir</b> (toca para copiar):\n<code>${esc(share)}</code>`,
      { disable_web_page_preview: true }
    )
  })

  bot.command('codes', async (ctx: any) => {
    if (!isAdmin(ctx)) return
    const list: any[] = await PromoCodeModel.find({}).sort({ createdAt: -1 }).limit(20)
    if (!list.length) return ctx.reply('Aún no hay códigos. Crea uno con /code 10')
    const lines = list.map((c) => {
      const state = !c.active ? '⛔' : c.uses >= c.maxUses ? '✅' : '🟢'
      return `${state} <code>${esc(c.code)}</code> · ${c.credits} créditos · ${c.uses}/${c.maxUses} canjes`
    })
    return ctx.replyWithHTML(
      `🎁 <b>Códigos</b>\n\n${lines.join('\n')}\n\n🟢 activo · ✅ agotado · ⛔ desactivado`
    )
  })

  bot.command('delcode', async (ctx: any) => {
    if (!isAdmin(ctx)) return
    const name = ((ctx.message.text || '').split(/\s+/)[1] || '').toUpperCase()
    if (!name) return ctx.reply('Uso: /delcode NOMBRE')
    const res: any = await PromoCodeModel.updateOne({ code: name }, { active: false })
    return ctx.reply(res && res.nModified ? `⛔ ${name} desactivado.` : `No encontré ${name} (o ya estaba desactivado).`)
  })

  const redeem = async (ctx: any, raw: string) => {
    const userId = ctx.from.id
    const lang = (await findChat(userId)).language
    raw = (raw || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '')
    if (!raw) return ctx.reply(loc('code_usage', lang))
    if (blocked(userId)) return ctx.reply(loc('code_blocked', lang))
    const doc: any = await PromoCodeModel.findOneAndUpdate(
      {
        code: raw,
        active: true,
        redeemedBy: { $ne: userId },
        $expr: { $lt: ['$uses', '$maxUses'] },
      },
      { $inc: { uses: 1 }, $push: { redeemedBy: userId } },
      { new: true }
    )
    if (!doc) {
      fail(userId)
      const c: any = await PromoCodeModel.findOne({ code: raw })
      let key = 'code_invalid'
      if (c && c.active) {
        if ((c.redeemedBy || []).indexOf(userId) >= 0) key = 'code_used'
        else if (c.uses >= c.maxUses) key = 'code_exhausted'
      }
      return ctx.reply(loc(key, lang))
    }
    const balance = await addCredits(userId, doc.credits, { type: 'code', method: 'code', ref: doc.code })
    await ctx.replyWithHTML(
      loc('code_ok', lang).replace('$n', `${doc.credits}`).replace('$bal', `${balance}`)
    )
    const name = ctx.from.username
      ? `@${ctx.from.username}`
      : `${ctx.from.first_name}${ctx.from.last_name ? ` ${ctx.from.last_name}` : ''}`
    const admin = parseInt(process.env.ADMIN, 10)
    if (admin) {
      try {
        await ctx.telegram.sendMessage(
          admin,
          `🎁 <b>Código canjeado</b>\n👤 <a href="tg://user?id=${userId}">${esc(name)}</a>\n` +
            `<code>${esc(doc.code)}</code> · +${doc.credits} créditos\n📊 Canjes: ${doc.uses}/${doc.maxUses}`,
          { parse_mode: 'HTML' }
        )
      } catch (err) {
        console.error('Code owner notice failed', err)
      }
    }
    // Every redemption is announced in the public boost feed
    const feed = (process.env.BOOST_FEED_CHAT || '').trim()
    if (feed) {
      try {
        await ctx.telegram.sendMessage(
          feed,
          `🎁 <b>${esc(name)}</b> redeemed a code · +${doc.credits} credits\n` +
            `🎟 Codes left: ${Math.max(0, doc.maxUses - doc.uses)}\n` +
            `💡 Got a code? Send /redeem YOURCODE to @${process.env.USERNAME}`,
          { parse_mode: 'HTML', disable_notification: true }
        )
      } catch (err) {
        console.error('Code feed notice failed', err)
      }
    }
  }

  bot.command('redeem', async (ctx: any) => {
    if (ctx.chat.type !== 'private') return
    return redeem(ctx, (ctx.message.text || '').split(/\s+/)[1] || '')
  })

  // Deep link from the shared message: /start redeem_<CODE>
  bot.use(async (ctx: any, next: any) => {
    const text = ctx.message && ctx.message.text
    const match = text && /^\/start redeem_([A-Za-z0-9_-]{3,20})$/.exec(text)
    if (!match || ctx.chat.type !== 'private') return next()
    return redeem(ctx, match[1])
  })
}
