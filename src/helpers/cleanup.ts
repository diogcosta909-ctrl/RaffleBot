// Dependencies
import { Types } from 'mongoose'
import { RaffleModel } from '../models'

// Raffles older than this are deleted whatever their state
const MAX_AGE_DAYS = 14
// A finished giveaway (winners drawn and counted in the ranking) is deleted this long after the draw
const FINISHED_KEEP_MINUTES = 60

/** Deletes finished giveaways 1 hour after the draw, and any giveaway created more than MAX_AGE_DAYS ago */
export async function deleteOldRaffles() {
  try {
    const seconds = Math.floor(Date.now() / 1000) - MAX_AGE_DAYS * 24 * 3600
    const res: any = await RaffleModel.deleteMany({
      _id: { $lt: (Types.ObjectId as any).createFromTime(seconds) },
    })
    if (res && res.deletedCount) {
      console.log(`Deleted ${res.deletedCount} raffles older than ${MAX_AGE_DAYS} days`)
    }
    // Only after the win is in the permanent ranking, so no win is ever lost
    const done: any = await RaffleModel.deleteMany({
      finishedAt: { $lt: new Date(Date.now() - FINISHED_KEEP_MINUTES * 60000) },
      winsRecorded: true,
    })
    if (done && done.deletedCount) {
      console.log(`Deleted ${done.deletedCount} finished raffles (${FINISHED_KEEP_MINUTES} min after the draw)`)
    }
  } catch (err) {
    console.error('Old raffles cleanup failed', err)
  }
}

/** Runs the cleanup now and then every 10 minutes */
export function setupCleanup() {
  deleteOldRaffles()
  setInterval(deleteOldRaffles, 10 * 60 * 1000)
}
