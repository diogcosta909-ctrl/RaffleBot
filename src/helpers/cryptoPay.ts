// Dependencies
import * as https from 'https'
import * as http from 'http'
import { URL } from 'url'
import { CryptoOrderModel } from '../models/cryptoOrder'

// USDT (BEP20) payments straight to your own wallet, detected on the BNB Smart Chain.
// No memo exists on BSC, so every order gets an exact amount with a unique cents tail.
export const CRYPTO_WALLET = (process.env.CRYPTO_WALLET || '').trim().toLowerCase()
// USDT price of each ⭐ (default 0.02)
export const CRYPTO_PRICE =
  parseFloat((process.env.CRYPTO_PRICE || '0.02').replace(',', '.')) || 0.02
export const CRYPTO_EXPIRY_MIN = 45
const USDT_BSC = '0x55d398326f99059ff775485246999027b3197955'
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const RPCS = (
  process.env.CRYPTO_RPC ||
  'https://bsc-dataseed.binance.org,https://bsc-dataseed1.defibit.io,https://bsc-rpc.publicnode.com'
)
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean)

export function cryptoEnabled() {
  return /^0x[a-f0-9]{40}$/.test(CRYPTO_WALLET)
}

/** Units of 0.0001 USDT for a pack of n boosts (without the unique tail) */
const CRYPTO_TAILS = 15

function unitsFor(n: number) {
  return Math.round(n * CRYPTO_PRICE * 10000)
}

export function formatUnits(units: number) {
  return (units / 10000).toFixed(4)
}

/** Short price label for the pack button, e.g. "0.10" */
export function cryptoPriceLabel(n: number) {
  return (unitsFor(n) / 10000).toFixed(2)
}

function post(url: string, body: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib: any = u.protocol === 'http:' ? http : https
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res: any) => {
        let data = ''
        res.on('data', (d: any) => (data += d))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (err) {
            reject(err)
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.write(body)
    req.end()
  })
}

/** JSON-RPC call, trying each RPC endpoint until one answers */
async function rpc(method: string, params: any[]) {
  let lastErr: any
  for (const url of RPCS) {
    try {
      const r = await post(url, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }))
      if (r.error) throw new Error(r.error.message || 'rpc error')
      return r.result
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

let lastScanned = 0
let lastLatest = 0

/** Creates (or reuses) the pending order for this user, raffle and pack */
export async function createOrder(info: {
  userId: number
  username?: string
  firstName?: string
  lastName?: string
  raffleId: string
  boosts: number
}) {
  const now = new Date()
  const existing: any = await CryptoOrderModel.findOne({
    userId: info.userId,
    raffleId: info.raffleId,
    boosts: info.boosts,
    status: 'pending',
    expiresAt: { $gt: now },
  })
  if (existing) return existing
  const base = unitsFor(info.boosts)
  // Pack price + a small tail (0.0001 to 0.0015). No limit on pending orders: a free tail is
  // used when there is one, otherwise the least used tail is shared (oldest order matches first)
  const grace = new Date(now.getTime() - 10 * 60000)
  const taken = (
    await CryptoOrderModel.find({ status: 'pending', expiresAt: { $gt: grace } }).select('amountUnits')
  ).map((o: any) => o.amountUnits)
  const used = (u: number) => taken.filter((x: number) => x === u).length
  let best = 0
  const options: number[] = []
  for (let t = 1; t <= CRYPTO_TAILS; t++) {
    const c = used(base + t)
    if (!options.length || c < best) {
      best = c
      options.length = 0
    }
    if (c === best) options.push(base + t)
  }
  const units = options[Math.floor(Math.random() * options.length)]
  return CryptoOrderModel.create({
    ...info,
    amountUnits: units,
    startBlock: lastLatest,
    expiresAt: new Date(now.getTime() + CRYPTO_EXPIRY_MIN * 60000),
  } as any)
}

async function handleLog(
  log: any,
  pending: any[],
  onPaid: (order: any, txHash: string) => Promise<void>
) {
  const txHash = `${log.transactionHash}`.toLowerCase()
  const units = Math.round(parseInt(log.data, 16) / 1e14)
  const block = parseInt(log.blockNumber, 16)
  const order = pending.find(
    (o) =>
      o.status === 'pending' &&
      o.amountUnits === units &&
      block >= (o.startBlock || 0) - 10
  )
  if (!order) return
  if (await CryptoOrderModel.countDocuments({ txHash })) return
  const updated = await CryptoOrderModel.findOneAndUpdate(
    { _id: order._id, status: 'pending' },
    { status: 'paid', txHash, paidAt: new Date() },
    { new: true }
  )
  if (!updated) return
  order.status = 'paid'
  try {
    await onPaid(updated, txHash)
  } catch (err) {
    console.error('Crypto payment apply failed', txHash, err)
  }
}

async function scan(onPaid: (order: any, txHash: string) => Promise<void>) {
  const now = Date.now()
  // Orders stay matchable 10 more minutes after their expiry (late transfers)
  await CryptoOrderModel.updateMany(
    { status: 'pending', expiresAt: { $lt: new Date(now - 10 * 60000) } },
    { status: 'expired' }
  )
  const latest = parseInt(await rpc('eth_blockNumber', []), 16)
  lastLatest = latest
  const safe = latest - 1
  if (!lastScanned) lastScanned = latest - 3000
  const pending = await CryptoOrderModel.find({ status: 'pending' }).sort({ _id: 1 })
  if (!pending.length) {
    lastScanned = Math.max(lastScanned, safe)
    return
  }
  const wallet = `0x${'0'.repeat(24)}${CRYPTO_WALLET.slice(2)}`
  let from = lastScanned + 1
  for (let chunk = 0; from <= safe && chunk < 6; chunk++) {
    const to = Math.min(safe, from + 1999)
    const logs = await rpc('eth_getLogs', [
      {
        address: USDT_BSC,
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${to.toString(16)}`,
        topics: [TRANSFER_TOPIC, null, wallet],
      },
    ])
    for (const log of logs || []) {
      await handleLog(log, pending, onPaid)
    }
    lastScanned = to
    from = to + 1
  }
}

/** Checks the chain every 30 seconds and calls onPaid for each matched order */
export function startCryptoWatcher(
  onPaid: (order: any, txHash: string) => Promise<void>
) {
  if (!cryptoEnabled()) {
    console.log('Crypto payments off (set CRYPTO_WALLET to enable)')
    return
  }
  console.log('Crypto payments on: USDT BEP20')
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      await scan(onPaid)
    } catch (err) {
      console.error('Crypto scan failed', err && err.message)
    }
    busy = false
  }
  setInterval(tick, 30000)
  setTimeout(tick, 5000)
}
