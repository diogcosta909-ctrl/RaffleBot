// Dependencies
import { Types } from 'mongoose'
import { RaffleModel } from '../models'

// Raffles older than this are deleted whatever their state
const MAX_AGE_DAYS = 18

/** Deletes raffles created more than MAX_AGE_DAYS ago (age taken from the _id) */
export async function deleteOldRaffles() {
  try {
    const seconds = Math.floor(Date.now() / 1000) - MAX_AGE_DAYS * 24 * 3600
    const res: any = await RaffleModel.deleteMany({
      _id: { $lt: (Types.ObjectId as any).createFromTime(seconds) },
    })
    if (res && res.deletedCount) {
      console.log(`Deleted ${res.deletedCount} raffles older than ${MAX_AGE_DAYS} days`)
    }
  } catch (err) {
    console.error('Old raffles cleanup failed', err)
  }
}

/** Runs the cleanup now and then every 6 hours */
export function setupCleanup() {
  deleteOldRaffles()
  setInterval(deleteOldRaffles, 6 * 3600 * 1000)
}
