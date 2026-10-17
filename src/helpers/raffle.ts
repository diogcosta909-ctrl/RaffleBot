// Dependencies
import { ContextMessageUpdate, Telegraf } from 'telegraf'
import { addRaffle, getRaffle, Raffle, getRaffleWithoutParticipantIds, RaffleModel } from '../models'
import {
  ExtraEditMessage,
  ChatMember,
  Message,
} from 'telegraf/typings/telegram-types'
import { shuffle } from 'lodash'
import {
  boostButton,
  boostCounts,
  boostNote,
  weightFor,
  weightedIndex,
  BOOST_PRICE,
  BOOST_STEP,
  entriesLabel,
  notifyBoostWin,
  entryValueOf,
  boostValues,
  boostBlock,
  multiplierNote,
} from './boost'
import { checkIfAdmin } from './checkAdmin'
import { topBoostersText } from './odds'
import { updateHallOfFame, recordRaffleWins } from './winners'
import { Chat, findChat } from '../models/chat'
import { loc } from './locale'
import { InstanceType } from 'typegoose'

/**
 * Starting a new raffle
 * @param ctx Context of the message that started
 */
export async function startRaffle(ctx: ContextMessageUpdate) {
  // Get chat
  const chat = await findChat(ctx.chat.id)
  // Add raffle
  const raffle = await addRaffle(ctx.chat.id)
  // Snapshot boost setting and entry value for this raffle
  raffle.boostEnabled = !!chat.boost
  raffle.entryValue = chat.entryValue > 0 ? chat.entryValue : 1
  // Raffles created from now on use the "Boost your odds" layout
  raffle.boostLayout = 2
  await raffle.save()
  // Save raffle message if required
  if (chat.raffleMessage) {
    raffle.raffleMessage = chat.raffleMessage
    await raffle.save()
  }
  if (chat.winnerMessage) {
    raffle.winnerMessage = chat.winnerMessage
    await raffle.save()
  }
  // Add buttons
  const options: ExtraEditMessage = {
    reply_markup: getButtons(raffle, chat.language),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }
  // Send message
  let sent: Message
  if (raffle.raffleMessage) {
    // Work on a copy so the saved template keeps its placeholders
    const raffleMessage: any = JSON.parse(JSON.stringify(raffle.raffleMessage))
    const startBlock = raffle.boostEnabled ? `\n\n${boostBlock(chat.language, 0)}` : ''
    if (raffleMessage.text) {
      raffleMessage.text =
        raffleMessage.text.replace('$numberOfParticipants', '0') + startBlock
    } else {
      raffleMessage.caption =
        raffleMessage.caption.replace('$numberOfParticipants', '0') + startBlock
    }
    sent = await ctx.telegram.sendCopy(ctx.chat.id, raffleMessage, {
      reply_markup: getButtons(raffle, chat.language),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })
  } else {
    sent = await ctx.replyWithHTML(
      `${loc(
        chat.number > 1 ? 'raffle_text_multiple' : 'raffle_text',
        chat.language
      )}${
        raffle.boostEnabled
          ? `\n\n${boostBlock(chat.language, 0)}`
          : ''
      }`,
      options
    )
  }
  // Save sent message id
  raffle.messageId = sent.message_id
  await raffle.save()
}

/**
 * Setting up callback for the raffle participation button
 * @param bot Bot to setup the callback
 */
export function setupCallback(bot: Telegraf<ContextMessageUpdate>) {
  ;(<any>bot).action(async (data: string, ctx: ContextMessageUpdate) => {
    // Get raffle
    const datas = data.split('~')
    // Participation buttons start with the chat id (a number); every other button
    // (boost, credits, codes, broadcast, config...) belongs to another handler
    if (!/^-?\d+$/.test(datas[0])) return
    const chatId = Number(datas[0])
    let raffle = await getRaffleWithoutParticipantIds(chatId, datas[1])
    // Get chat
    const chat = await findChat(ctx.chat.id)
    // Check if raffle is there
    if (!raffle) {
      try {
        await (<any>ctx).answerCbQuery(
          loc('please_retry', chat.language),
          undefined,
          true
        )
      } catch {
        // do nothing
      }
      return
    }
    // Check if raffle is finished
    if (raffle.winners) {
      try {
        await (<any>ctx).answerCbQuery(
          loc('raffle_over', chat.language),
          undefined,
          true
        )
      } catch {
        // do nothing
      }
      return
    }
    // Check if already in
    const raffleWithThisParticipant = await RaffleModel.findOne({
      chatId: raffle.chatId,
      messageId: raffle.messageId,
      participantsIds: ctx.from.id,
    })
    if (raffleWithThisParticipant) {
      try {
        await (<any>ctx).answerCbQuery(
          loc('already_participating', chat.language),
          undefined,
          true
        )
      } catch {
        // do nothing
      }
      return
    }
    // Check if participant subscribed
    if (chat.subscribe) {
      for (const subscribe of chat.subscribe.split(',')) {
        try {
          const member = await ctx.telegram.getChatMember(
            `${!isNaN(+subscribe) ? '' : '@'}${subscribe}`,
            ctx.from.id
          )
          if (
            !member.status ||
            member.status === 'left' ||
            member.status === 'kicked'
          ) {
            throw new Error()
          }
        } catch (err) {
          try {
            await (<any>ctx).answerCbQuery(
              `${loc('check_subscription', chat.language)}${
                !isNaN(+subscribe) ? '' : '@'
              }${subscribe}`,
              undefined,
              true
            )
          } catch {
            // do nothing
          }
          return
        }
      }
    }
    // Add participant atomically: $addToSet never stores the same id twice,
    // even if the button is tapped several times at once
    const added: any = await RaffleModel.updateOne({
      chatId: raffle.chatId,
      messageId: raffle.messageId,
    }, {
      $addToSet: {
        participantsIds: ctx.from.id,
      },
    })
    if (added && added.nModified === 0) {
      try {
        await (<any>ctx).answerCbQuery(
          loc('already_participating', chat.language),
          undefined,
          true
        )
      } catch {
        // do nothing
      }
      return
    }
    // Reply that they are in
    try {
      await (<any>ctx).answerCbQuery(
        loc('participated', chat.language),
        undefined,
        true
      )
    } catch {
      // do nothing
    }
    // Update counters on the raffle message
    try {
      await refreshRaffleMessage(ctx.telegram, raffle, chat)
    } catch (err) {
      // Do nothing
    }
  })
}

/**
 * Re-renders the raffle message with the participants and boosts counters
 */
export async function refreshRaffleMessage(
  telegram: any,
  raffle: InstanceType<Raffle>,
  chat: { language: string; number: number }
) {
  const counts = (
    await RaffleModel.aggregate([
      { $match: { chatId: raffle.chatId, messageId: raffle.messageId } },
      {
        $project: {
          participantsIds: { $size: { $setUnion: [{ $ifNull: ['$participantsIds', []] }, []] } },
          boosts: { $size: { $ifNull: ['$boostIds', []] } },
          multCount: { $size: { $ifNull: ['$boostMults', []] } },
          multSum: { $sum: { $ifNull: ['$boostMults', []] } },
        },
      },
    ])
  )[0]
  const participants = counts.participantsIds
  const boosts = counts.boosts
  const options: ExtraEditMessage = {
    reply_markup: getButtons(raffle, chat.language),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }
  // Entries = entry value per participant + extra entries bought with Boost
  const value = entryValueOf(raffle)
  // Shown as whole numbers; the draw itself keeps the exact weights
  // Each boost counts as the multiplier it was bought with (x1 if not saved)
  const extra = Math.round((boosts - counts.multCount + counts.multSum) * BOOST_STEP)
  // $numberOfParticipants = free entries (participants × entry value)
  const entries = Math.round(participants * value)
  const lines: string[] = []
  if (boosts > 0) {
    lines.push(
      loc('boost_count', chat.language).replace('$n', `${extra}`)
    )
  }
  if (raffle.boostEnabled && boosts === 0) {
    lines.push(loc('boost_first', chat.language))
  }
  const boostLine = lines.length ? `\n${lines.join('\n')}` : ''
  // Top 3 boosters of this raffle, right below the boosts counter
  const top = boosts > 0 ? await topBoostersText(telegram, raffle._id, chat.language, BOOST_STEP) : ''
  // Custom raffle messages get the multiplier line too (the default one has it in boostNote)
  const multNote = raffle.boostEnabled ? multiplierNote(raffle, chat.language) : ''
  let text: string
  if (raffle.boostEnabled && raffle.boostLayout === 2) {
    // New layout: text + "Boost your odds" block
    const block = boostBlock(chat.language, extra)
    if (raffle.raffleMessage) {
      const raffleMessage = raffle.raffleMessage
      text = `${(raffleMessage.text || raffleMessage.caption)
        .replace('$numberOfParticipants', `${entries}`)
        .replace('$numberOfBoosts', `${boosts}`)}\n\n${block}${top}`
    } else {
      text = `${loc(
        chat.number > 1 ? 'raffle_text_multiple' : 'raffle_text',
        chat.language
      )}\n\n${loc('participants_number', chat.language)}: ${entries}\n\n${block}${top}`
    }
  } else if (raffle.raffleMessage) {
    const raffleMessage = raffle.raffleMessage
    text = `${(raffleMessage.text || raffleMessage.caption)
      .replace('$numberOfParticipants', `${entries}`)
      .replace('$numberOfBoosts', `${boosts}`)}${
      multNote ? `\n${multNote}` : ''
    }${boostLine}${top}`
  } else {
    text = `${loc(
      chat.number > 1 ? 'raffle_text_multiple' : 'raffle_text',
      chat.language
    )}${boostNote(raffle, chat.language)}\n\n${loc(
      'participants_number',
      chat.language
    )}: ${entries}${boostLine}${top}`
  }
  // Captions are limited to 1024 characters: drop the top boosters before the counters stop updating
  if (raffle.raffleMessage && !raffle.raffleMessage.text && top && text.length > 1024) {
    text = text.slice(0, text.length - top.length)
  }
  if (!raffle.raffleMessage || raffle.raffleMessage.text) {
    await telegram.editMessageText(
      raffle.chatId,
      raffle.messageId,
      undefined,
      text,
      options
    )
  } else {
    await telegram.editMessageCaption(
      raffle.chatId,
      raffle.messageId,
      undefined,
      text,
      options as any
    )
  }
}

/**
 * Setting up listener for the raffle endings
 * @param bot
 */
export function setupListener(bot: Telegraf<ContextMessageUpdate>) {
  bot.use(async (ctx, next) => {
    try {
      const message = ctx.message || ctx.channelPost
      // Check if reply to bot's message
      if (
        !message ||
        !message.reply_to_message ||
        (!message.reply_to_message.text && !message.reply_to_message.caption)
      ) {
        throw new Error('Not checking')
      }
      // Check if admin replied
      const isAdmin = await checkIfAdmin(ctx, false)
      if (!isAdmin) {
        throw new Error('No admin')
      }
      // Get reply message
      const reply = message.reply_to_message
      // Check if there is raffle to the reply message
      const raffle = await getRaffle(reply.chat.id, reply.message_id)
      if (!raffle) {
        throw new Error('No raffle')
      }
      // Check if no winner yet
      if (raffle.winners) {
        throw new Error('No winners')
      }
      // Finish raffle
      await finishRaffle(raffle, ctx)
    } catch (err) {
      // Do nothing
    } finally {
      // Continue
      next()
    }
  })
}

/**
 * Buttons for a raffle
 * @param raffle Raffle to provide buttons to
 * @param language Languageof thebuttons
 * @returns buttons for a raffle
 */
function getButtons(raffle: InstanceType<Raffle>, language: string) {
  const keyboard = [
    [
      {
        text: loc('participate_button', language),
        callback_data: `${raffle.chatId}~${raffle.id}`,
      },
    ],
  ]
  if (raffle.boostEnabled) {
    keyboard.push(boostButton(raffle, language))
  }
  return { inline_keyboard: keyboard }
}

/**
 * Finishing raffle
 * @param raffle Raffle to finish
 * @param ctx Context of message that finished raffle
 */
/** How the winner paid most of their boosts: Stars (default on ties), USDT or credits */
function paidWith(raffle: any, userId: number, n: number) {
  const count = (list?: number[]) => (list || []).filter((id) => id === userId).length
  const usdt = count(raffle.cryptoIds)
  const credits = count(raffle.creditIds)
  const stars = Math.max(0, n - usdt - credits)
  if (usdt > stars && usdt >= credits) return { crypto: true, credits: false }
  if (credits > stars && credits > usdt) return { crypto: false, credits: true }
  return { crypto: false, credits: false }
}

/** Runs a Telegram call again after the wait Telegram asks for when it answers "Too Many Requests" */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (err) {
      const wait = err && err.parameters && err.parameters.retry_after
      if (!wait || i >= 6) throw err
      await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000))
    }
  }
}

export async function finishRaffle(raffle: Raffle, ctx: ContextMessageUpdate, defaultChat?: Chat) {
  console.log(`Finishing raffle for chat ${raffle.chatId}`)
  // Telegram calls wait and retry when Telegram says "Too Many Requests"
  const tg: any = {}
  ;['getChatMember', 'editMessageText', 'editMessageCaption', 'sendMessage'].forEach((m) => {
    tg[m] = (...args: any[]) => withRetry(() => (<any>ctx.telegram)[m](...args))
  })
  // Get participants ids
  // One entry per person (also cleans duplicates saved by older versions)
  let ids = Array.from(new Set(raffle.participantsIds))
  const idsOriginalLength = ids.length
  // Get chat
  const chat = defaultChat || await findChat(ctx.chat.id)
  const nodelete = chat.nodelete
  // Check if there were participants
  if (ids.length <= 0) {
    const text = loc('no_participants', chat.language)
    if (!nodelete) {
      if (!raffle.raffleMessage || raffle.raffleMessage.text) {
        await tg.editMessageText(
          raffle.chatId,
          raffle.messageId,
          undefined,
          text,
          { disable_web_page_preview: true, parse_mode: 'HTML' }
        )
      } else {
        await tg.editMessageCaption(
          raffle.chatId,
          raffle.messageId,
          undefined,
          text,
          { disable_web_page_preview: true, parse_mode: 'HTML' } as any
        )
      }
    } else {
      await tg.sendMessage(raffle.chatId, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })
    }
    return
  }
  // Get winners
  ids = shuffle(ids)
  // Weights: 1 for everybody, +BOOST_STEP per Stars boost bought
  const counts = raffle.boostEnabled ? boostCounts(raffle) : new Map<number, number>()
  const base = entryValueOf(raffle)
  const values = raffle.boostEnabled ? boostValues(raffle) : new Map<number, number>()
  const weights = ids.map((id) => weightFor(values, id, base))
  let winners: {
    name: string
    winner: ChatMember
  }[] = []
  while (winners.length < chat.number) {
    // Check if not enough participants
    if (ids.length + winners.length < chat.number) {
      const text = loc('not_enough_participants', chat.language)
      if (!nodelete) {
        if (!raffle.raffleMessage || raffle.raffleMessage.text) {
          await tg.editMessageText(
            raffle.chatId,
            raffle.messageId,
            undefined,
            text,
            { disable_web_page_preview: true, parse_mode: 'HTML' }
          )
        } else {
          await tg.editMessageCaption(
            raffle.chatId,
            raffle.messageId,
            undefined,
            text,
            { disable_web_page_preview: true, parse_mode: 'HTML' } as any
          )
        }
      } else {
        await tg.sendMessage(raffle.chatId, text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        })
      }
      return
    }
    const winnerIndex = weightedIndex(weights)
    const winnerId = ids.splice(winnerIndex, 1)[0]
    weights.splice(winnerIndex, 1)
    try {
      const winner = await tg.getChatMember(raffle.chatId, winnerId)
      if (
        !['administrator', 'creator', 'member', 'restricted'].includes(
          winner.status
        )
      ) {
        continue
      }
      const name = winner.user.username
        ? `@${winner.user.username}`
        : `${winner.user.first_name}${
            winner.user.last_name ? ` ${winner.user.last_name}` : ''
          }`
      if (winners.map((w) => w.winner.user.id).indexOf(winner.user.id) < 0) {
        winners.push({ name, winner })
      }
    } catch (err) {
      // Do nothing
    }
  }
  winners = shuffle(winners)
  console.log(
    `Finishing raffle for chat ${raffle.chatId}, winners length: ${winners.length}`
  )
  // Save winners
  raffle.winners = winners.map((w) => w.winner.user.id).join(',')
  await (<any>raffle).save()
  // The winners are saved, so the participants and boosts are no longer needed
  await RaffleModel.updateOne(
    { _id: (<any>raffle)._id },
    { $set: { participantsIds: [], boostIds: [], cryptoIds: [], creditIds: [] } }
  )
  // Everything below only runs once the winners are announced: if the announcement fails the
  // draw is retried with new winners, and the wins and the feed notice must belong to the final draw
  const firstWinner = winners.length > 0 ? winners[0] : undefined
  const afterAnnounce = async () => {
    // Wins are counted forever (raffles are deleted after 18 days); then the pinned ranking updates
    await recordRaffleWins(raffle)
    await updateHallOfFame(ctx.telegram, raffle.chatId)
    // Tell the public boost feed when the (first) winner had bought a Boost
    if (raffle.boostEnabled && firstWinner) {
      const w = firstWinner.winner.user
      const n = counts.get(w.id) || 0
      if (n > 0) {
        notifyBoostWin(
          ctx.telegram,
          raffle,
          {
            id: w.id,
            username: w.username,
            name: `${w.first_name}${w.last_name ? ` ${w.last_name}` : ''}`,
          },
          {
            stars: n * BOOST_PRICE,
            boosts: n,
            entries: Math.round(weightFor(values, w.id, base)),
            ...paidWith(raffle, w.id, n),
          }
        ).catch(() => undefined)
      }
    }
  }
  // Several winners: the first one is the real winner and the rest are substitutes,
  // so the Boost note only talks about winner #1
  const boostedMark = (_id: number) => ''
  let boostSummary = ''
  if (raffle.boostEnabled && winners.length > 1) {
    const firstId = winners[0].winner.user.id
    const n = counts.get(firstId) || 0
    boostSummary = `\n\n${
      n > 0
        ? loc('winner_boosted', chat.language)
            .replace('$n', `${n}`)
            .replace('$mult', entriesLabel(weightFor(values, firstId, base), chat.language))
        : loc('winner_free', chat.language)
    }`
  }
  // Announce winner
  if (winners.length == 1) {
    const winner = winners[0].winner
    const name = winners[0].name.replace('<', '').replace('>', '')
    let text: string
    if (raffle.winnerMessage) {
      text = raffle.winnerMessage.text
        .replace(
          '$winner',
          `<a href="tg://user?id=${winner.user.id}">${name}</a>`
        )
        .replace('$numberOfParticipants', `${Math.round(idsOriginalLength * base)}`)
    } else {
      text = `🎉 ${loc('winner', chat.language)} — <a href="tg://user?id=${
        winner.user.id
      }">${name}</a>! ${loc('congratulations', chat.language)}!\n\n${loc(
        'participants_number',
        chat.language
      )} — ${Math.round(idsOriginalLength * base)}.`
    }
    if (raffle.boostEnabled) {
      const n = counts.get(winner.user.id) || 0
      text = `${text}\n\n${
        n > 0
          ? loc('winner_boosted', chat.language)
              .replace('$n', `${n}`)
              .replace('$mult', entriesLabel(weightFor(values, winner.user.id, base), chat.language))
          : loc('winner_free', chat.language)
      }`
    }
    if (!nodelete) {
      if (!raffle.raffleMessage || raffle.raffleMessage.text) {
        await tg.editMessageText(
          raffle.chatId,
          raffle.messageId,
          undefined,
          text,
          {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }
        )
      } else {
        await tg.editMessageCaption(
          raffle.chatId,
          raffle.messageId,
          undefined,
          text,
          {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          } as any
        )
      }
    } else {
      await tg.sendMessage(raffle.chatId, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })
    }
  } else {
    const names = winners.map((w) => w.name.replace('<', '').replace('>', ''))
    if (names.length <= 50 || raffle.winnerMessage) {
      let text: string
      if (raffle.winnerMessage) {
        text = raffle.winnerMessage.text
          .replace(
            '$winner',
            names
              .map(
                (name, i) =>
                  `<a href="tg://user?id=${winners[i].winner.user.id}">${name}</a>`
              )
              .join(', ')
          )
          .replace('$numberOfParticipants', `${Math.round(idsOriginalLength * base)}`)
        text = `${text}${boostSummary}`
      } else {
        text = `🎉 ${loc('winners', chat.language)}:\n`
        for (let i = 0; i < names.length; i++) {
          text = `${text}\n${i + 1}. <a href="tg://user?id=${
            winners[i].winner.user.id
          }">${names[i]}</a>${boostedMark(winners[i].winner.user.id)}`
        }
        text = `${text}\n\n${loc('congratulations', chat.language)}!\n\n${loc(
          'participants_number',
          chat.language
        )} — ${Math.round(idsOriginalLength * base)}.${boostSummary}`
      }
      if (!nodelete) {
        if (!raffle.raffleMessage || raffle.raffleMessage.text) {
          await tg.editMessageText(
            raffle.chatId,
            raffle.messageId,
            undefined,
            text,
            {
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }
          )
        } else {
          await tg.editMessageCaption(
            raffle.chatId,
            raffle.messageId,
            undefined,
            text,
            {
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            } as any
          )
        }
      } else {
        await tg.sendMessage(raffle.chatId, text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        })
      }
    } else {
      let commonI = 0
      let text = `🎉 ${loc('winners', chat.language)}:\n`
      const firstNames = names.splice(0, 50)
      const firstWinners = winners.splice(0, 50)
      for (let i = 0; i < firstNames.length; i++) {
        commonI++
        text = `${text}\n${commonI}. <a href="tg://user?id=${firstWinners[i].winner.user.id}">${firstNames[i]}</a>${boostedMark(firstWinners[i].winner.user.id)}`
      }
      text = `${text}\n\n${loc('congratulations', chat.language)}!\n\n${loc(
        'participants_number',
        chat.language
      )} — ${Math.round(idsOriginalLength * base)}.${boostSummary}`
      console.log(`Announcing winners for ${raffle.chatId}`, raffle.messageId)
      if (!nodelete) {
        if (!raffle.raffleMessage || raffle.raffleMessage.text) {
          await tg.editMessageText(
            raffle.chatId,
            raffle.messageId,
            undefined,
            text,
            {
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }
          )
        } else {
          await tg.editMessageCaption(
            raffle.chatId,
            raffle.messageId,
            undefined,
            text,
            {
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            } as any
          )
        }
      } else {
        await tg.sendMessage(raffle.chatId, text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        })
      }
      while (names.length > 0) {
        let text = ``
        const nextNames = names.splice(0, 50)
        const nextWinners = winners.splice(0, 50)
        for (let i = 0; i < nextNames.length; i++) {
          commonI++
          text = `${text}\n${commonI}. <a href="tg://user?id=${nextWinners[i].winner.user.id}">${nextNames[i]}</a>${boostedMark(nextWinners[i].winner.user.id)}`
        }
        await tg.sendMessage(raffle.chatId, text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        })
      }
    }
  }
  await afterAnnounce()
}
