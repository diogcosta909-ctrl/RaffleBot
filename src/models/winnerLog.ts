// Dependencies
import { prop, Typegoose } from 'typegoose'

// One row per raffle winner, for the /winners hall of fame
export class WinnerLog extends Typegoose {
  @prop({ required: true, index: true })
  chatId: number
  @prop({ index: true })
  raffleId?: string
  @prop({ required: true })
  userId: number
  @prop()
  name?: string
  // Position in the draw (1 = first winner)
  @prop()
  position?: number
  // Entries the winner had in the draw
  @prop()
  entries?: number
  // Boosts the winner had bought (0 = free entry)
  @prop()
  boosts?: number
  // stars | usdt | credits (how most of the boosts were paid)
  @prop()
  method?: string
  @prop()
  participants?: number
}

export const WinnerLogModel = new WinnerLog().getModelForClass(WinnerLog, {
  schemaOptions: { timestamps: true },
})
