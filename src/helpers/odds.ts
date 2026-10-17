// Dependencies
import { RaffleModel } from '../models'
import { loc } from './locale'

/**
 * Win chances and top boosters of a raffle.
 * The draw weight of a person is base + step × (boost value), so the chance of
 * winning the first prize is weight / sum of all weights (same formula as the draw).
 */

const MEDALS = ['🥇', '🥈', '🥉']

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type Totals = { total: number; participants: number }

/** Sum of all draw weights right now (null if the raffle can't be read) */
export async function raffleTotals(
  raffleId: any,
  base: number,
  step: number
): Promise<Totals | null> {
  try {
    const r: any = (
      await RaffleModel.aggregate([
        { $match: { _id: raffleId } },
        {
          $project: {
            participants: { $size: { $ifNull: ['$participantsIds', []] } },
            boosts: { $size: { $ifNull: ['$boostIds', []] } },
            multCount: { $size: { $ifNull: ['$boostMults', []] } },
            multSum: { $sum: { $ifNull: ['$boostMults', []] } },
          },
        },
      ])
    )[0]
    if (!r) return null
    // Boosts bought before multipliers existed count as x1
    const value = r.boosts - r.multCount + r.multSum
    return { total: r.participants * base + step * value, participants: r.participants }
  } catch (err) {
    return null
  }
}

/** Chance (0..1) of a person with `value` boost value, plus `extra` more value bought */
export function chanceOf(
  totals: Totals,
  value: number,
  base: number,
  step: number,
  extra = 0
) {
  const mine = base + step * (value + extra)
  const all = totals.total + step * extra
  return all > 0 ? Math.min(1, mine / all) : 0
}

/** "4.2%", "12%", "<0.1%" */
export function pct(f: number) {
  const p = f * 100
  if (p < 0.1) return '<0.1%'
  if (p < 10) return `${p.toFixed(1)}%`
  return `${Math.round(p)}%`
}

/** "4.2% (1 in 24)" */
export function pctWithRatio(f: number) {
  return f > 0 && f < 0.5 ? `${pct(f)} (1/${Math.round(1 / f)})` : pct(f)
}

/** Line for the boost menu: current chance */
export function oddsLine(language: string, f: number) {
  return loc('odds_line', language).replace('$pct', pctWithRatio(f))
}

/** Line after buying: "🎯 Your chance: 0.4% → 1.6%" (value = value AFTER buying, added = value just bought) */
export function oddsChangeLine(
  language: string,
  totals: Totals,
  value: number,
  added: number,
  base: number,
  step: number
) {
  const to = chanceOf(totals, value, base, step)
  const before: Totals = { ...totals, total: totals.total - step * added }
  const from = chanceOf(before, value - added, base, step)
  return loc('odds_after', language).replace('$from', pct(from)).replace('$to', pct(to))
}

// Names of boosters (id → display name), cached so the raffle message refreshes fast
const names = new Map<number, string>()

async function nameOf(telegram: any, id: number) {
  const cached = names.get(id)
  if (cached) return cached
  let name = ''
  try {
    const c = await telegram.getChat(id)
    name = c.username
      ? `@${c.username}`
      : `${c.first_name || ''}${c.last_name ? ` ${c.last_name}` : ''}`.trim()
  } catch (err) {
    // user never opened the bot or blocked it
  }
  if (name) names.set(id, name)
  return name || 'Anonymous'
}

/**
 * "\n🏆 Top boosters\n🥇 Ana · 5 boosts…" for the raffle message
 * (starts with a line break; empty when nobody has boosted)
 */
export async function topBoostersText(
  telegram: any,
  raffleId: any,
  language: string,
  step: number
) {
  try {
    const r: any = await RaffleModel.findById(raffleId).select('boostIds boostMults')
    const ids: number[] = (r && r.boostIds) || []
    const mults: number[] = (r && r.boostMults) || []
    // boostMults lines up with the END of boostIds; older boosts count as x1
    const offset = Math.max(0, ids.length - mults.length)
    const values = new Map<number, number>()
    ids.forEach((id, i) => {
      const m = i >= offset ? mults[i - offset] : 1
      values.set(id, (values.get(id) || 0) + (m >= 1 ? m : 1))
    })
    const top = Array.from(values.entries())
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 3)
    if (!top.length) return ''
    const lines: string[] = []
    for (let i = 0; i < top.length; i++) {
      const name = await nameOf(telegram, top[i][0])
      const extra = Math.round(top[i][1] * step)
      lines.push(
        `${MEDALS[i]} ${esc(name)} · ${loc('top_entries', language).replace('$n', `${extra}`)}`
      )
    }
    return `\n${loc('top_boosters', language)}\n${lines.join('\n')}`
  } catch (err) {
    return ''
  }
}
