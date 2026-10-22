// Dependencies
import { prop, Typegoose } from 'typegoose'

// "Boost all giveaways" purchase: the same number of boosts in several giveaways, paid once
export class MultiBoost extends Typegoose {
  @prop({ required: true, index: true })
  userId: number
  // Giveaways chosen when the purchase was prepared
  @prop({ required: true })
  raffleIds: string
  // Boosts in each giveaway
  @prop({ required: true })
  n: number
  // Boost multiplier when the purchase was prepared (the boosts keep this value)
  @prop()
  mult?: number
  // open | done
  @prop({ default: 'open', index: true })
  status?: string
  // Stats (filled when it is paid and applied)
  @prop({ default: 0 })
  payments?: number
  @prop({ default: 0 })
  boostsApplied?: number
  @prop({ default: 0 })
  giveawaysApplied?: number
  // Boosts that could not be applied and went back as credits
  @prop({ default: 0 })
  returned?: number
  // credits | stars | usdt (last payment)
  @prop()
  method?: string
}

export const MultiBoostModel = new MultiBoost().getModelForClass(MultiBoost, {
  schemaOptions: { timestamps: true },
})
