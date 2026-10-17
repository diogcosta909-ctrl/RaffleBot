// Dependencies
import * as mongoose from 'mongoose'
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { ChatModel } from '../models/chat'
import { RaffleModel } from '../models/raffle'
import { CryptoOrderModel } from '../models/cryptoOrder'
import { PromoCodeModel } from '../models/promoCode'
import { cryptoEnabled, bscEnabled, tonEnabled, getCryptoStatus, getTonStatus, CRYPTO_WALLET, TON_WALLET } from './cryptoPay'

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Last errors printed with console.error (kept in memory, newest last)
const recent: { at: number; text: string }[] = []

function age(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 90) return `${s}s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  if (s < 172800) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} d`
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; value?: T }> {
  const start = Date.now()
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ])
    return { ok: true, ms: Date.now() - start, value: value as T }
  } catch {
    return { ok: false, ms: Date.now() - start }
  }
}

/** /status (owner only): health of the database, Telegram, USDT watcher and settings */
export function setupStatus(bot: Telegraf<ContextMessageUpdate>) {
  const original = console.error
  console.error = (...args: any[]) => {
    try {
      recent.push({
        at: Date.now(),
        text: args
          .map((a) => (a && a.message ? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' ')
          .slice(0, 140),
      })
      if (recent.length > 5) recent.shift()
    } catch {
      // never break logging
    }
    original.apply(console, args)
  }

  bot.command('status', async (ctx: any) => {
    if (ctx.chat.type !== 'private') return
    if (ctx.from.id !== parseInt(process.env.ADMIN, 10)) return
    const now = Date.now()
    const lines: string[] = ['🩺 <b>Estado del bot</b>', '']
    lines.push(`⏱ En marcha desde hace ${age(process.uptime() * 1000)}`)

    const db = await timed(async () => ChatModel.countDocuments({}))
    lines.push(
      db.ok && (mongoose.connection as any).readyState === 1
        ? `✅ Base de datos OK (${db.ms} ms)`
        : '❌ Base de datos NO responde'
    )
    const tg = await timed(() => (bot.telegram as any).getMe())
    lines.push(tg.ok ? `✅ Telegram OK (${tg.ms} ms)` : '❌ Telegram NO responde')

    if (cryptoEnabled()) {
      const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`
      const nets: { name: string; wallet: string; st: any; label: string }[] = []
      if (bscEnabled()) nets.push({ name: 'BSC', wallet: CRYPTO_WALLET, st: getCryptoStatus(), label: 'Red BSC' })
      if (tonEnabled()) nets.push({ name: 'TON', wallet: TON_WALLET, st: getTonStatus(), label: 'Red TON' })
      lines.push('')
      for (const net of nets) {
        lines.push(`🟢 <b>USDT (${net.name})</b> · wallet ${short(net.wallet)}`)
        if (!net.st.lastOkAt) {
          lines.push('⏳ Aún no ha hecho la primera comprobación')
        } else if (now - net.st.lastOkAt > 3 * 60000) {
          lines.push(`❌ Sin comprobar la red hace ${age(now - net.st.lastOkAt)}${net.st.lastError ? ` (${esc(net.st.lastError)})` : ''}`)
        } else {
          lines.push(`✅ ${net.label} OK · última comprobación hace ${age(now - net.st.lastOkAt)}`)
        }
        if (net.name === 'BSC' && net.st.lastLatest && net.st.lastScanned) {
          lines.push(`📦 Bloques por revisar: ${Math.max(0, net.st.lastLatest - net.st.lastScanned)}`)
        }
      }
      const pending: any[] = await CryptoOrderModel.find({ status: 'pending' }).sort({ _id: 1 })
      lines.push(
        pending.length
          ? `🧾 Pedidos pendientes: ${pending.length} (el más antiguo hace ${age(now - new Date((pending[0] as any).createdAt).getTime())})`
          : '🧾 Pedidos pendientes: 0'
      )
    } else {
      lines.push('', '⚪ USDT desactivado (falta CRYPTO_WALLET o CRYPTO_WALLET_TON)')
    }

    const terms = await ChatModel.countDocuments({ termsAccepted: true })
    const credits: any[] = await ChatModel.aggregate([
      { $match: { credits: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$credits' }, people: { $sum: 1 } } },
    ])
    const openRaffles = await RaffleModel.countDocuments({
      boostEnabled: true,
      winners: { $exists: false },
    })
    const codes = await PromoCodeModel.countDocuments({ active: true })
    lines.push('')
    lines.push('📊 <b>Negocio</b>')
    lines.push(`📜 Aceptaron los términos: ${terms}`)
    lines.push(`🚀 Sorteos abiertos con boost: ${openRaffles}`)
    const people = credits[0] ? credits[0].people : 0
    lines.push(`💰 Créditos en circulación: ${credits[0] ? credits[0].total : 0} (${people} ${people === 1 ? 'persona' : 'personas'})`)
    lines.push(`🎁 Códigos activos: ${codes}`)

    lines.push('')
    lines.push('⚙️ <b>Ajustes</b>')
    lines.push(`${process.env.ADMIN ? '✅' : '❌'} ADMIN`)
    lines.push(`${(process.env.BOOST_FEED_CHAT || '').trim() ? '✅' : '⚪'} BOOST_FEED_CHAT (feed de boosts)`)
    lines.push(`${(process.env.SUPPORT_CONTACT || '').trim() ? '✅' : '⚪'} SUPPORT_CONTACT`)

    lines.push('')
    if (recent.length) {
      lines.push('⚠️ <b>Últimos errores</b>')
      recent.slice().reverse().forEach((e) => lines.push(`• hace ${age(now - e.at)}: ${esc(e.text)}`))
    } else {
      lines.push('✅ Sin errores desde que arrancó')
    }
    return ctx.replyWithHTML(lines.join('\n'), { disable_web_page_preview: true })
  })
}
