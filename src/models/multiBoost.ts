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
}

export const MultiBoostModel = new MultiBoost().getModelForClass(MultiBoost, {
  schemaOptions: { timestamps: true },
})
