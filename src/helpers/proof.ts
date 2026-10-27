// Dependencies
import { DrawStatModel } from '../models/drawStat'

let cache: { at: number; line: string } = { at: 0, line: '' }

/**
 * "🏆 62% of winners this month used Boost" - real data from finished giveaways.
 * Shown only when there are at least 10 draws and winners boosted clearly more often
 * than participants in general (1.5x), so the line is always true and never misleading.
 */
export async function winnersBoostLine() {
  if (Date.now() - cache.at < 60 * 60 * 1000) return cache.line
  let line = ''
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const rows: any[] = await DrawStatModel.find({ at: { $gte: since } }).select(
      'winnerBoosted participants boostedParticipants'
    )
    if (rows.length >= 10) {
      const winnersBoosted = rows.filter((r) => r.winnerBoosted).length / rows.length
      const people = rows.reduce((a, r) => a + (r.participants || 0), 0)
      const boosted = rows.reduce((a, r) => a + (r.boostedParticipants || 0), 0)
      const share = people > 0 ? boosted / people : 0
      if (winnersBoosted >= 0.25 && winnersBoosted >= share * 1.5) {
        line = `🏆 ${Math.round(winnersBoosted * 100)}% of winners this month used Boost`
      }
    }
  } catch (err) {
    console.error('Winners stat failed', err)
  }
  cache = { at: Date.now(), line }
  return line
}
