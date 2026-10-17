// Dependencies
import { arrayProp, prop, Typegoose } from 'typegoose'

// Redeemable credit codes created by the owner with /code
export class PromoCode extends Typegoose {
  // Always stored in upper case
  @prop({ required: true, unique: true, index: true })
  code: string
  // Credits each redemption gives
  @prop({ required: true })
  credits: number
  // How many different people can redeem it
  @prop({ required: true, default: 1 })
  maxUses: number
  @prop({ required: true, default: 0 })
  uses: number
  @arrayProp({ default: [], items: Number })
  redeemedBy?: number[]
  @prop()
  expiresAt?: Date
  // Announce each redemption in the public boost feed
  @prop({ default: false })
  feed?: boolean
  @prop({ default: true })
  active?: boolean
}

export const PromoCodeModel = new PromoCode().getModelForClass(PromoCode, {
  schemaOptions: { timestamps: true },
})
