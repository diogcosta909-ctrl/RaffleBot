// Dependencies
import { prop, Typegoose } from 'typegoose'

// Pending/paid USDT (BEP20) payment for a raffle boost, matched by its exact amount
export class CryptoOrder extends Typegoose {
  @prop({ required: true, index: true })
  userId: number
  @prop()
  username?: string
  @prop()
  firstName?: string
  @prop()
  lastName?: string
  @prop({ required: true, index: true })
  raffleId: string
  @prop({ required: true })
  boosts: number
  // Exact amount to pay in units of 0.0001 USDT (the last digits identify the order)
  @prop({ required: true, index: true })
  amountUnits: number
  // Block number when the order was created (older transfers are ignored)
  @prop()
  startBlock?: number
  // pending | paid | failed | expired
  @prop({ required: true, index: true, default: 'pending' })
  status: string
  @prop({ index: true })
  txHash?: string
  @prop()
  chatId?: number
  @prop({ required: true })
  expiresAt: Date
  @prop()
  paidAt?: Date
}

export const CryptoOrderModel = new CryptoOrder().getModelForClass(CryptoOrder, {
  schemaOptions: { timestamps: true },
})
