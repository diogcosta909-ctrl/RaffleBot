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

const dateText = (d?: Date) => (d ? new Date(d).toISOString().slice(0, 10) : '—')

/**
 * Credit codes. Owner: /code <credits> [uses] [NAME] [7d] [feed], /codes, /delcode NAME.
 * Users: /redeem CODE.
 */
export function setupCodes(bot: Telegraf<ContextMessageUpdate>) {
  bot.command('code', async (ctx: any) => {
    if (!isAdmin(ctx)) return
    const parts: string[] = (ctx.message.text || '').split(/\s+/).slice(1).filter(Boolean)
    const numbers = parts.filter((p) => /^\d+$/.test(p)).map((p) => parseInt(p, 10))
    const credits = numbers[0]
    if (!credits) {
      return ctx.replyWithHTML(
        '🎁 <b>Códigos de créditos</b>\n\n' +
          '<code>/code 10</code> → código al azar, 10 créditos, 1 persona\n' +
          '<code>/code 10 50</code> → 10 créditos, 50 personas distintas\n' +
          '<code>/code 5 100 WELCOME</code> → con nombre propio\n' +
          '<code>/code 5 100 WELCOME 7d</code> → caduca en 7 días\n' +
          '<code>/code 5 100 WELCOME feed</code> → cada canje sale en el feed\n\n' +
          'Cada persona solo puede canjear un código una vez.\n' +
          '/codes ver los códigos · <code>/delcode NOMBRE</code> desactivar'
      )
    }
    const maxUses = numbers[1] || 1
    const expiry = parts.find((p) => /^\d+d$/i.test(p))
    const days = expiry ? parseInt(expiry, 10) : 0
    const feed = parts.some((p) => p.toLowerCase() === 'feed')
    const name = parts.find(
      (p) => !/^\d+$/.test(p) && !/^\d+d$/i.test(p) && p.toLowerCase() !== 'feed'
    )
    const code = (name || randomCode()).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20)
    if (!code) return ctx.reply('Nombre no válido (usa letras y números).')
    try {
      await PromoCodeModel.create({
        code,
        credits,
        maxUses,
        feed,
        expiresAt: days ? new Date(Date.now() + days * 24 * 3600 * 1000) : undefined,
      })
    } catch (err) {
      return ctx.reply(`❌ Ya existe un código llamado ${code}.`)
    }
    return ctx.replyWithHTML(
      `✅ <b>Código creado</b>\n\n<code>${code}</code>\n` +
        `🎁 ${credits} créditos por persona\n` +
        `👥 Hasta ${maxUses} ${maxUses === 1 ? 'persona' : 'personas'}\n` +
        `⏳ Caduca: ${days ? dateText(new Date(Date.now() + days * 24 * 3600 * 1000)) : 'nunca'}\n` +
        `📢 Aviso en el feed: ${feed ? 'sí' : 'no'}\n\n` +
        `Se canjea con:\n<code>/redeem ${code}</code>`
    )
  })

  bot.command('codes', async (ctx: any) => {
    if (!isAdmin(ctx)) return
    const list: any[] = await PromoCodeModel.find({}).sort({ createdAt: -1 }).limit(20)
    if (!list.length) return ctx.reply('Aún no hay códigos. Crea uno con /code 10')
    const lines = list.map((c) => {
      const expired = c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()
      const state = !c.active ? '⛔' : expired ? '⌛' : c.uses >= c.maxUses ? '✅' : '🟢'
      return `${state} <code>${esc(c.code)}</code> · ${c.credits} créditos · ${c.uses}/${c.maxUses} canjes · caduca ${dateText(c.expiresAt)}${c.feed ? ' · feed' : ''}`
    })
    return ctx.replyWithHTML(
      `🎁 <b>Códigos</b>\n\n${lines.join('\n')}\n\n🟢 activo · ✅ agotado · ⌛ caducado · ⛔ desactivado`
    )
  })

  bot.command('delcode', async (ctx: any) => {
    if (!isAdmin(ctx)) return
    const name = ((ctx.message.text || '').split(/\s+/)[1] || '').toUpperCase()
    if (!name) return ctx.reply('Uso: /delcode NOMBRE')
    const res: any = await PromoCodeModel.updateOne({ code: name }, { active: false })
    return ctx.reply(res && res.nModified ? `⛔ ${name} desactivado.` : `No encontré ${name} (o ya estaba desactivado).`)
  })

  bot.command('redeem', async (ctx: any) => {
    if (ctx.chat.type !== 'private') return
    const userId = ctx.from.id
    const lang = (await findChat(userId)).language
    const raw = ((ctx.message.text || '').split(/\s+/)[1] || '').toUpperCase()
    if (!raw) return ctx.reply(loc('code_usage', lang))
    if (blocked(userId)) return ctx.reply(loc('code_blocked', lang))
    const now = new Date()
    // One atomic step: active, not expired, uses left and not redeemed by this person yet
    const doc: any = await PromoCodeModel.findOneAndUpdate(
      {
        code: raw,
        active: true,
        redeemedBy: { $ne: userId },
        $and: [
          { $expr: { $lt: ['$uses', '$maxUses'] } },
          { $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }] },
        ],
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
        else if (c.expiresAt && new Date(c.expiresAt).getTime() < now.getTime()) key = 'code_expired'
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
    const feed = (process.env.BOOST_FEED_CHAT || '').trim()
    if (doc.feed && feed) {
      try {
        await ctx.telegram.sendMessage(
          feed,
          `🎁 <b>${esc(name)}</b> redeemed a code · +${doc.credits} credits\n🎟 Codes left: ${Math.max(0, doc.maxUses - doc.uses)}`,
          { parse_mode: 'HTML', disable_notification: true }
        )
      } catch (err) {
        console.error('Code feed notice failed', err)
      }
    }
  })
}
