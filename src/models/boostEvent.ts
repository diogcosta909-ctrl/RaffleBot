// Dependencies
import { prop, Typegoose } from 'typegoose'

// Funnel event for the Stars boost (click → menu → invoice)
export class BoostEvent extends Typegoose {
  // click | menu | invoice
  @prop({ required: true, index: true })
  type: string
  @prop({ required: true, index: true })
  userId: number
  @prop({ index: true })
  raffleId?: string
  @prop()
  boosts?: number
  // false when the click was rejected (not joined, raffle over, max reached)
  @prop({ default: true })
  ok?: boolean
}

export const BoostEventModel = new BoostEvent().getModelForClass(BoostEvent, {
  schemaOptions: { timestamps: true },
})

/** Saves a funnel event without ever breaking the bot flow */
export async function trackBoost(event: Partial<BoostEvent>) {
  try {
    await BoostEventModel.create(event)
  } catch (err) {
    console.error('Boost event not saved', err)
  }
}
