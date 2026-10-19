// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { ChatModel, findChat } from '../models/chat'
import { PaymentModel } from '../models/payment'
import { CryptoOrderModel } from '../models/cryptoOrder'
import { CreditTxModel } from '../models/creditTx'
import { getCryptoStatus, getTonStatus, bscEnabled, tonEnabled } from './cryptoPay'

const TZ = 'Europe/Andorra'
const SUMMARY_AT = 1 // the daily summary is sent from 00:01 (Andorra time): minutes after midnight

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

let telegramRef: any
const lastAlert = new Map<string, number>()

function localNow() {
  const parts: any = {}
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  } as any)
    .formatToParts(new Date())
    .forEach((p) => (parts[p.type] = p.value))
  return {
    minutes: parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10),
    day: `${parts.year}-${parts.month}-${parts.day}`,
  }
}

/**
 * Private alert to the owner. The same problem (key) is only reported once per `everyMs`,
 * so a failure that repeats does not flood the chat. Never throws.
 */
export async function alertOwner(text: string, key: string, everyMs = 30 * 60000) {
  try {
    const admin = parseInt(process.env.ADMIN, 10)
    if (!admin || !telegramRef) return
    const last = lastAlert.get(key) || 0
    if (Date.now() - last < everyMs) return
    lastAlert.set(key, Date.now())
    await telegramRef.sendMessage(admin, `🚨 ${text}`, { parse_mode: 'HTML', disable_web_page_preview: true })
  } catch {
    // alerts must never break the bot
  }
}

interface Totals {
  starsSales: number
  stars: number
  usdtSales: number
  usdt: number
  creditSpends: number
  creditsSpent: number
  boosts: number
  buyers: number
}

/** Sales and boosts since a date (Stars, USDT and credits) */
async function totalsSince(since: Date): Promise<Totals> {
  const payments: any[] = await PaymentModel.find({ status: 'applied', createdAt: { $gte: since } }).select(
    'userId stars raffleId boosts'
  )
  const orders: any[] = await CryptoOrderModel.find({ status: 'paid', paidAt: { $gte: since } }).select(
    'userId amountUnits raffleId boosts'
  )
  const spends: any[] = await CreditTxModel.find({ type: 'spend', createdAt: { $gte: since } }).select('userId delta')
  const buyers = new Set<number>()
  let boosts = 0
  let stars = 0
  let usdtUnits = 0
  for (const p of payments) {
    stars += p.stars || 0
    buyers.add(p.userId)
    if (p.raffleId !== 'topup') boosts += p.boosts || 1
  }
  for (const o of orders) {
    usdtUnits += o.amountUnits || 0
    buyers.add(o.userId)
    if (o.raffleId !== 'topup') boosts += o.boosts || 1
  }
  let creditsSpent = 0
  for (const t of spends) {
    creditsSpent += -(t.delta || 0)
    buyers.add(t.userId)
  }
  boosts += creditsSpent
  return {
    starsSales: payments.length,
    stars,
    usdtSales: orders.length,
    usdt: usdtUnits / 10000,
    creditSpends: spends.length,
    creditsSpent,
    boosts,
    buyers: buyers.size,
  }
}

function block(title: string, t: Totals) {
  return (
    `<b>${title}</b>\n` +
    `⭐ Stars: ${t.stars} (${t.starsSales} ${t.starsSales === 1 ? 'pago' : 'pagos'})\n` +
    `🪙 USDT: ${t.usdt.toFixed(2)} (${t.usdtSales} ${t.usdtSales === 1 ? 'pago' : 'pagos'})\n` +
    `🚀 Boosts: ${t.boosts} · 💰 créditos gastados: ${t.creditsSpent}\n` +
    `👥 Clientes que compraron o gastaron: ${t.buyers}`
  )
}

async function giveawaysTotal() {
  const r: any[] = await ChatModel.aggregate([{ $group: { _id: null, n: { $sum: { $ifNull: ['$giveawaysDone', 0] } } } }])
  return (r[0] && r[0].n) || 0
}

/** Text of the summary: last 24 hours and last 7 days */
async function summaryText(sinceGiveaways: number) {
  const day = await totalsSince(new Date(Date.now() - 24 * 3600 * 1000))
  const week = await totalsSince(new Date(Date.now() - 7 * 24 * 3600 * 1000))
  const total = await giveawaysTotal()
  const done = Math.max(0, total - sinceGiveaways)
  return (
    `📊 <b>Resumen</b>\n\n` +
    `${block('Últimas 24 h', day)}\n🎁 Sorteos terminados: ${done}\n\n` +
    `${block('Últimos 7 días', week)}`
  )
}

async function sendSummary(telegram: any, admin: number, saveMarker: boolean) {
  const owner: any = await findChat(admin)
  const text = await summaryText(owner.reportGiveaways || 0)
  if (saveMarker) {
    owner.reportDay = localNow().day
    owner.reportGiveaways = await giveawaysTotal()
    await owner.save()
  }
  await telegram.sendMessage(admin, text, { parse_mode: 'HTML', disable_notification: true })
}

/**
 * Owner tools: a daily summary (sent every day at 00:01, Andorra time), /resumen to get it now,
 * and alerts when something breaks (USDT/TON watcher down, uncaught errors, giveaways that cannot be finished).
 */
export function setupOwnerReport(bot: Telegraf<ContextMessageUpdate>) {
  telegramRef = bot.telegram
  const admin = parseInt(process.env.ADMIN, 10)

  bot.command('resumen', async (ctx: any) => {
    if (ctx.chat.type !== 'private' || ctx.from.id !== admin) return
    try {
      await sendSummary(ctx.telegram, admin, false)
    } catch (err) {
      console.error('Summary failed', err)
      await ctx.reply('❌ No se pudo generar el resumen.')
    }
  })

  if (!admin) return

  // Daily summary
  setInterval(async () => {
    try {
      const now = localNow()
      if (now.minutes < SUMMARY_AT) return
      const owner: any = await findChat(admin)
      if (owner.reportDay === now.day) return
      // Mark first inside sendSummary's save; a failed send is not retried until tomorrow
      await sendSummary(bot.telegram, admin, true)
    } catch (err) {
      console.error('Daily summary failed', err)
    }
  }, 60 * 1000)

  // USDT / TON watchers failing for a while
  setInterval(() => {
    const check = (name: string, s: { lastOkAt: number; lastError: string }) => {
      if (s.lastError && s.lastOkAt && Date.now() - s.lastOkAt > 15 * 60000) {
        alertOwner(
          `<b>${name}</b>: el vigilante de pagos lleva más de 15 min fallando. Los pagos en USDT no se aplicarán hasta que vuelva.\n<code>${esc(s.lastError)}</code>`,
          `watcher-${name}`,
          3 * 3600 * 1000
        )
      }
    }
    if (bscEnabled()) check('USDT BSC', getCryptoStatus())
    if (tonEnabled()) check('USDT TON', getTonStatus())
  }, 5 * 60 * 1000)
}
