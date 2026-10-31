// Dependencies
import { prop, Typegoose } from 'typegoose'

// Every daily spin (prize 0 = no prize), for the owner's /ruleta numbers
export class WheelSpin extends Typegoose {
  @prop({ required: true, index: true })
  userId: number
  // Boosts won (0 = nothing)
  @prop({ required: true })
  prize: number
  // Days in a row at the moment of the spin
  @prop()
  streak?: number
  // Day (Andorra time) of the spin
  @prop({ index: true })
  day?: string
}

export const WheelSpinModel = new WheelSpin().getModelForClass(WheelSpin, {
  schemaOptions: { timestamps: true },
})
