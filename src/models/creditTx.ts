// Dependencies
import { prop, Typegoose } from 'typegoose'

// Every change of a user's credit balance (topup, spend, admin correction), for auditing
export class CreditTx extends Typegoose {
  @prop({ required: true, index: true })
  userId: number
  // Positive = credits added, negative = credits spent
  @prop({ required: true })
  delta: number
  // topup | spend | admin | refund
  @prop({ required: true, index: true })
  type: string
  // stars | usdt | credits | admin
  @prop()
  method?: string
  @prop({ index: true })
  raffleId?: string
  // Chat of the giveaway (set when credits are spent; raffles are deleted 1 hour after the draw)
  @prop({ index: true })
  chatId?: number
  // Stars chargeId or USDT txHash that produced the topup
  @prop()
  ref?: string
  // Display name when credits are spent (used by rankings)
  @prop()
  name?: string
  // How many of the added credits were free (pack bonus). Rows saved before this field have none
  @prop()
  free?: number
  @prop()
  balanceAfter?: number
}

export const CreditTxModel = new CreditTx().getModelForClass(CreditTx, {
  schemaOptions: { timestamps: true },
})
