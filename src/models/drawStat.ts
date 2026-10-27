// Dependencies
import { prop, Typegoose } from 'typegoose'

// One row per finished giveaway with Boosts (raffles are deleted 1 hour after the draw):
// whether the first winner used Boost, and how many participants did
export class DrawStat extends Typegoose {
  @prop({ required: true, index: true })
  chatId: number
  @prop({ required: true, index: true })
  at: Date
  @prop({ default: false })
  winnerBoosted: boolean
  @prop({ default: 0 })
  participants: number
  @prop({ default: 0 })
  boostedParticipants: number
}

export const DrawStatModel = new DrawStat().getModelForClass(DrawStat)
