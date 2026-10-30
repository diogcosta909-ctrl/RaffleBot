// Dependencies
import { prop, Typegoose } from 'typegoose'

// Auto-Boost funnel and usage events, for the owner's /stars numbers
// type: open | open_nobal | activate | pick | off_manual | buy_click | pack_pick | applied | partial |
//       low_warn | paused | off_auto | limit_hit | resumed | gift_sent | gift_claimed | recharge_after_warn |
//       streak_reward | ref_join | ref_reward | ref_commission | invite_open
export class AutoBoostEvent extends Typegoose {
  @prop({ required: true, index: true })
  type: string
  @prop({ required: true, index: true })
  userId: number
  // Boosts per giveaway (activate/pick) or pack size (pack_pick)
  @prop()
  n?: number
  // Boosts spent (applied)
  @prop()
  k?: number
  @prop({ index: true })
  raffleId?: string
}

export const AutoBoostEventModel = new AutoBoostEvent().getModelForClass(AutoBoostEvent, {
  schemaOptions: { timestamps: true },
})

/** Saves an event without ever breaking the bot flow */
export async function trackAuto(type: string, userId: number, extra: Partial<AutoBoostEvent> = {}) {
  try {
    await AutoBoostEventModel.create(Object.assign({ type, userId }, extra))
  } catch (err) {
    console.error('Auto-Boost event not saved', err)
  }
}
