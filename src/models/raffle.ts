// Dependencies
import { prop, arrayProp, Typegoose } from 'typegoose'
import { Message } from 'telegram-typings'

// Winner class definition
export class Raffle extends Typegoose {
  @prop({ required: true, index: true })
  chatId: number
  @prop({ index: true })
  messageId?: number
  @arrayProp({ required: true, default: [], items: Number })
  participantsIds: number[]

  @prop()
  winners?: string

  // Stars boost: snapshot of the chat setting when the raffle started
  @prop({ default: false })
  boostEnabled?: boolean
  // Snapshot of the chat's entry value when the raffle started
  @prop({ default: 1 })
  entryValue?: number
  // One entry per boost bought (a user id repeated N times = N boosts)
  @arrayProp({ default: [], items: Number })
  boostIds?: number[]
  // Multiplier in force when each boost in boostIds was bought (same order)
  @arrayProp({ default: [], items: Number })
  boostMults?: number[]
  // One entry per boost paid in USDT (user id repeated N times), subset of boostIds
  @arrayProp({ default: [], items: Number })
  cryptoIds?: number[]
  // Raffle message layout: 2 = "Boost your odds" block (raffles created from now on)
  @prop({ default: 1 })
  boostLayout?: number

  @prop()
  raffleMessage?: Message
  @prop()
  winnerMessage?: Message
}

// Get Raffle model
export const RaffleModel = new Raffle().getModelForClass(Raffle)

/**
 * Adding new raffle
 * @param chatId Chat id of the raffle
 * @param messageId Message id of the raffle
 * @returns created raffle
 */
export async function addRaffle(chatId: number) {
  let raffle = new RaffleModel({ chatId })
  return raffle.save()
}

/**
 * Getting existing raffle
 * @param chatId Chat id of the raffle
 * @param messageId Message id of the raffle
 * @returns requested raffle
 */
export async function getRaffle(chatId: number, id: string | number) {
  try {
    const raffle = await RaffleModel.findById(id)
    if (raffle) {
      return raffle
    }
  } catch (err) {
    return RaffleModel.findOne({ chatId, messageId: Number(id) })
  }
}

/**
 * Getting existing raffle without the participant ids
 * @param chatId Chat id of the raffle
 * @param messageId Message id of the raffle
 * @returns requested raffle
 */
export async function getRaffleWithoutParticipantIds(chatId: number, id: string | number) {
  try {
    const raffle = await RaffleModel.findById(id).select('-participantsIds')
    if (raffle) {
      return raffle
    }
  } catch (err) {
    return RaffleModel.findOne({ chatId, messageId: Number(id) })
  }
}
