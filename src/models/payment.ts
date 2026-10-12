// Dependencies
import { prop, Typegoose } from 'typegoose'

// Telegram Stars payment for a raffle boost
export class Payment extends Typegoose {
  @prop({ required: true, index: true, unique: true })
  chargeId: string
  @prop({ required: true, index: true })
  userId: number
  @prop({ required: true, index: true })
  raffleId: string
  @prop({ required: true })
  stars: number
  // applied | refunded
  @prop({ required: true, default: 'applied' })
  status: string
}

export const PaymentModel = new Payment().getModelForClass(Payment, {
  schemaOptions: { timestamps: true },
})
