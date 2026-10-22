// Get environment variables
import * as dotenv from 'dotenv'
dotenv.config({ path: `${__dirname}/../.env` })

// Dependencies
import { Telegraf, ContextMessageUpdate } from 'telegraf'
import { setupStartAndHelp } from './commands/startAndHelp'
import { setupStartRaffle } from './commands/startRaffle'
import { finishRaffle, setupCallback, setupListener, withRetry, setupTestWin } from './helpers/raffle'
import { setupLanguage, setupLanguageCallback } from './commands/language'
import { setupNumberCallback, setupNumber } from './commands/number'
import { setupTestLocale } from './commands/testLocales'
import { setupSubscribe } from './commands/subscribe'
import { setupNosubscribe } from './commands/nosubscribe'
import { setupRaffleMessage } from './commands/raffleMessage'
import { setupWinnerMessage } from './commands/winnerMessage'
import { setupNodelete } from './commands/nodelete'
import { setupListenForForwards } from './helpers/listenForForwards'
import { setupConfigRaffle } from './commands/configRaffle'
import { setupAddChat } from './commands/addChat'
import { setupId } from './commands/id'
import { setupDebug } from './commands/debug'
import { setupBoost } from './helpers/boost'
import { setupTerms } from './helpers/terms'
import { setupBroadcast } from './helpers/broadcast'
import { setupTopBoosters } from './helpers/topBoosters'
import { setupClientStats } from './helpers/clientStats'
import { setupCodes } from './helpers/codes'
import { setupStatus } from './helpers/status'
import { setupWinners } from './helpers/winners'
import { setupOwnerReport, alertOwner } from './helpers/ownerReport'
import { setupBalances } from './helpers/balances'
import { setupCleanup } from './helpers/cleanup'
import { RaffleModel } from './models'
import { findChat } from './models/chat'
const telegraf = require('telegraf')

// Setup the bot
const bot: Telegraf<ContextMessageUpdate> = new telegraf(process.env.TOKEN, {
  username: process.env.USERNAME,
  channelMode: true,
})
bot.startPolling()
console.log('Bot is up and running · build boostall-2 · ' + (require('./helpers/locale').localizations.multi_pick_one ? 'locale OK' : 'locale OLD'))

// Setup callback
setupCallback(bot)
// Setup listeners
setupListener(bot)
setupListenForForwards(bot)

// Setup Stars boost (before /start so boost deep links are handled first)
setupBoost(bot)
setupTerms(bot)
setupBroadcast(bot)
setupTopBoosters(bot)
setupClientStats(bot)
setupCodes(bot)
setupStatus(bot)
setupWinners(bot)
setupTestWin(bot)
setupOwnerReport(bot)
setupBalances(bot)
setupCleanup()

// Setup commands
setupStartAndHelp(bot)
setupStartRaffle(bot)
setupLanguage(bot)
setupNumber(bot)
setupTestLocale(bot)
setupSubscribe(bot)
setupNosubscribe(bot)
setupRaffleMessage(bot)
setupWinnerMessage(bot)
setupNodelete(bot)
setupConfigRaffle(bot)
setupAddChat(bot)
setupId(bot)
setupDebug(bot)
// Giveaways forwarded at the same time are finished a few at a time (Telegram rate limits)
const finishing = new Set<string>()
const MAX_AT_ONCE = 3
let running = 0
const waiting: (() => void)[] = []
async function takeSlot() {
  if (running < MAX_AT_ONCE) {
    running++
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
}
function releaseSlot() {
  const next = waiting.shift()
  if (next) next()
  else running--
}

bot.on('message', async (ctx) => {
  if (
    !ctx.chat ||
    !ctx.chat.type ||
    ctx.chat.type !== 'private' ||
    !ctx.message ||
    !ctx.message.forward_from_chat
  ) {
    return
  }
  if (ctx.from.id !== parseInt(process.env.ADMIN, 10)) {
    const chatMember = await ctx.telegram.getChatMember(
      ctx.message.forward_from_chat.id,
      ctx.from.id
    )
    if (
      chatMember.status !== 'creator' &&
      chatMember.status !== 'administrator'
    ) {
      return
    }
  }
  const raffle = await RaffleModel.findOne({
    chatId: ctx.message.forward_from_chat.id,
    messageId: ctx.message.forward_from_message_id,
  })
  if (!raffle) {
    return
  }
  const key = `${raffle._id}`
  const reply = (text: string) =>
    withRetry(() => ctx.reply(text, { reply_to_message_id: ctx.message.message_id })).catch(
      () => undefined
    )
  // Being finished right now, or finished by an older version that did not keep the participants
  // (nothing to draw from): leave it as it is. Otherwise a finished giveaway is drawn again.
  if (finishing.has(key) || ((raffle as any).winners && !((raffle as any).participantsIds || []).length)) {
    await reply('👍')
    return
  }
  finishing.add(key)
  try {
    await takeSlot()
  } catch (e) {
    // never happens
  }
  try {
    let numberOfTries = 0
    let succeeded = false
    while (numberOfTries < 100 && !succeeded) {
      try {
        await finishRaffle(
          raffle,
          ctx,
          await findChat(ctx.message.forward_from_chat.id)
        )
        succeeded = true
      } catch (e) {
        console.log(e)
        numberOfTries++
        if (numberOfTries === 5) {
          alertOwner(
            `Un sorteo no se puede terminar (5 intentos fallidos, sigue reintentando).\nChat: <code>${raffle.chatId}</code>\n<code>${`${(e && e.message) || e}`.slice(0, 200).replace(/</g, '&lt;')}</code>`,
            `finish-${key}`,
            3600 * 1000
          )
        }
        await new Promise((resolve) => setTimeout(resolve, 3000))
        if (numberOfTries === 100) {
          alertOwner(
            `Un sorteo NO se pudo terminar tras 100 intentos.\nChat: <code>${raffle.chatId}</code>\n<code>${`${(e && e.message) || e}`.slice(0, 200).replace(/</g, '&lt;')}</code>`,
            `finish-failed-${key}`,
            3600 * 1000
          )
          throw e
        }
      }
    }
    await reply('👍')
  } catch (err) {
    console.error(err)
    await reply('👎 try again')
  } finally {
    finishing.delete(key)
    releaseSlot()
  }
})

// Setup callbacks
setupLanguageCallback(bot)
setupNumberCallback(bot)

bot.catch(console.error)

process.on('unhandledRejection', (reason) => {
  console.log('Unhandled Rejection at:', reason)
  alertOwner(
    `Error sin controlar (unhandledRejection):\n<code>${`${(reason && (<any>reason).message) || reason}`.slice(0, 300).replace(/</g, '&lt;')}</code>`,
    'unhandled',
    30 * 60000
  )
})

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception:', err)
  alertOwner(
    `Excepción no controlada:\n<code>${`${(err && err.message) || err}`.slice(0, 300).replace(/</g, '&lt;')}</code>`,
    'uncaught',
    30 * 60000
  )
})
