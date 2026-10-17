// Dependencies
import { prop, Typegoose } from 'typegoose'

// Giveaways won by a person in a chat, kept forever (raffles are deleted after 18 days)
export class WinCount extends Typegoose {
  @prop({ required: true, index: true })
  chatId: number
  @prop({ required: true, index: true })
  userId: number
  @prop({ required: true, default: 0 })
  wins: number
}

export const WinCountModel = new WinCount().getModelForClass(WinCount, {
  schemaOptions: { timestamps: true },
})
