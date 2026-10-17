// Dependencies
import { prop, Typegoose } from 'typegoose'

// Pending/paid USDT payment (BSC or TON) for a raffle boost, matched by its exact amount
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
  // Abandoned-payment reminder already sent
  @prop()
  reminded?: boolean
  // Boost multiplier when the order was made (the boost keeps this value)
  @prop()
  mult?: number
  // Credit topups (raffleId = 'topup'): raffle whose boost menu to go back to
  @prop()
  backRaffleId?: string
  // bsc | ton (orders saved before TON existed have none = bsc)
  @prop({ index: true })
  network?: string
  // TON orders: creation time in unix seconds
  @prop()
  startTs?: number
}

export const CryptoOrderModel = new CryptoOrder().getModelForClass(CryptoOrder, {
  schemaOptions: { timestamps: true },
})
