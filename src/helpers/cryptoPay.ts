// Dependencies
import * as https from 'https'
import * as http from 'http'
import { URL } from 'url'
import { CryptoOrderModel } from '../models/cryptoOrder'

// USDT payments straight to your own wallets, detected on-chain:
//  - BNB Smart Chain (BEP20): CRYPTO_WALLET
//  - TON (USDT jetton): CRYPTO_WALLET_TON
// Every order gets an exact amount with a unique cents tail, which identifies the payer.
export type Network = 'bsc' | 'ton'
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

export const TON_WALLET = (process.env.CRYPTO_WALLET_TON || '').trim()
const TON_API = (process.env.TON_API || 'https://toncenter.com').trim().replace(/\/$/, '')
const TON_KEY = (process.env.TON_API_KEY || '').trim()
const USDT_TON = (
  process.env.TON_USDT_MASTER || 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
).trim()

export function bscEnabled() {
  return /^0x[a-f0-9]{40}$/.test(CRYPTO_WALLET)
}

export function tonEnabled() {
  return /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/.test(TON_WALLET)
}

export function cryptoEnabled() {
  return bscEnabled() || tonEnabled()
}

/** Networks the user can pay on */
export function networks(): Network[] {
  const list: Network[] = []
  if (bscEnabled()) list.push('bsc')
  if (tonEnabled()) list.push('ton')
  return list
}

export function networkLabel(n: Network | string) {
  return n === 'ton' ? 'TON network' : 'BNB Smart Chain (BEP20)'
}

export function networkShort(n: Network | string) {
  return n === 'ton' ? 'TON' : 'BSC'
}

export function walletOf(n: Network | string) {
  return n === 'ton' ? TON_WALLET : CRYPTO_WALLET
}

/** Units of 0.0001 USDT for a pack of n boosts (without the unique tail) */
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

function getJson(url: string, headers: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib: any = u.protocol === 'http:' ? http : https
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: 'GET',
        headers,
        timeout: 10000,
      },
      (res: any) => {
        let data = ''
        res.on('data', (d: any) => (data += d))
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`))
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
let lastOkAt = 0
let lastError = ''
let tonOkAt = 0
let tonError = ''

/** Watcher health for /status (BSC) */
export function getCryptoStatus() {
  return { lastScanned, lastLatest, lastOkAt, lastError }
}

/** Watcher health for /status (TON) */
export function getTonStatus() {
  return { lastOkAt: tonOkAt, lastError: tonError }
}

/** Creates (or reuses) the pending order for this user, raffle and pack */
export async function createOrder(info: {
  userId: number
  username?: string
  firstName?: string
  lastName?: string
  raffleId: string
  boosts: number
  backRaffleId?: string
  network?: Network
}) {
  const now = new Date()
  const network: Network = info.network === 'ton' ? 'ton' : 'bsc'
  // Orders saved before TON existed have no network (= BSC)
  const netMatch: any = network === 'bsc' ? { $in: ['bsc', null] } : 'ton'
  const existing: any = await CryptoOrderModel.findOne({
    network: netMatch,
    userId: info.userId,
    raffleId: info.raffleId,
    boosts: info.boosts,
    status: 'pending',
    expiresAt: { $gt: now },
  })
  if (existing) return existing
  const base = unitsFor(info.boosts)
  // Pack price + the lowest free tail: 0.0201, 0.0202, 0.0203... (grows only when many are open)
  const grace = new Date(now.getTime() - 10 * 60000)
  const taken = (
    await CryptoOrderModel.find({ status: 'pending', network: netMatch, expiresAt: { $gt: grace } }).select('amountUnits')
  ).map((o: any) => o.amountUnits)
  let units = base + 1
  while (taken.indexOf(units) >= 0) units++
  return CryptoOrderModel.create({
    ...info,
    network,
    amountUnits: units,
    startBlock: lastLatest,
    startTs: Math.floor(now.getTime() / 1000),
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
      (o.network || 'bsc') === 'bsc' &&
      o.amountUnits === units &&
      block >= (o.startBlock || 0) - 10
  )
  if (!order) return
  await settle(order, txHash, onPaid)
}

/** Marks the order paid (once per transaction) and applies it */
async function settle(
  order: any,
  txHash: string,
  onPaid: (order: any, txHash: string) => Promise<void>
) {
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
  const latest = parseInt(await rpc('eth_blockNumber', []), 16)
  lastLatest = latest
  const safe = latest - 1
  if (!lastScanned) lastScanned = latest - 3000
  const pending = await CryptoOrderModel.find({
    status: 'pending',
    network: { $in: ['bsc', null] },
  }).sort({ _id: 1 })
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

/** TON: incoming USDT jetton transfers to the wallet, matched by exact amount */
async function scanTon(onPaid: (order: any, txHash: string) => Promise<void>) {
  const pending: any[] = await CryptoOrderModel.find({ status: 'pending', network: 'ton' }).sort({ _id: 1 })
  if (!pending.length) return
  const since =
    Math.floor(Math.min(...pending.map((o) => new Date(o.createdAt).getTime())) / 1000) - 120
  const url =
    `${TON_API}/api/v3/jetton/transfers?owner_address=${encodeURIComponent(TON_WALLET)}` +
    `&direction=in&jetton_master=${encodeURIComponent(USDT_TON)}` +
    `&start_utime=${since}&limit=100&sort=desc`
  const r = await getJson(url, TON_KEY ? { 'X-API-Key': TON_KEY } : {})
  for (const t of r.jetton_transfers || []) {
    if (t.transaction_aborted) continue
    // USDT on TON has 6 decimals; orders use units of 0.0001
    const units = Math.round(Number(t.amount) / 100)
    const txHash = `${t.transaction_hash}`
    const ts = Number(t.transaction_now) || 0
    const order = pending.find(
      (o) =>
        o.status === 'pending' &&
        o.amountUnits === units &&
        ts >= Math.floor(new Date(o.createdAt).getTime() / 1000) - 120
    )
    if (!order) continue
    await settle(order, txHash, onPaid)
    order.status = 'paid'
  }
}

/** Checks the chains every 30 seconds and calls onPaid for each matched order */
export function startCryptoWatcher(
  onPaid: (order: any, txHash: string) => Promise<void>
) {
  if (!cryptoEnabled()) {
    console.log('Crypto payments off (set CRYPTO_WALLET and/or CRYPTO_WALLET_TON to enable)')
    return
  }
  console.log(`Crypto payments on: USDT ${networks().map(networkShort).join(' + ')}`)
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    // Orders stay matchable 10 more minutes after their expiry (late transfers)
    try {
      await CryptoOrderModel.updateMany(
        { status: 'pending', expiresAt: { $lt: new Date(Date.now() - 10 * 60000) } },
        { status: 'expired' }
      )
    } catch (err) {
      console.error('Crypto expiry failed', err && err.message)
    }
    if (bscEnabled()) {
      try {
        await scan(onPaid)
        lastOkAt = Date.now()
        lastError = ''
      } catch (err) {
        lastError = `${(err && err.message) || err}`.slice(0, 120)
        console.error('Crypto scan failed', err && err.message)
      }
    }
    if (tonEnabled()) {
      try {
        await scanTon(onPaid)
        tonOkAt = Date.now()
        tonError = ''
      } catch (err) {
        tonError = `${(err && err.message) || err}`.slice(0, 120)
        console.error('TON scan failed', err && err.message)
      }
    }
    busy = false
  }
  setInterval(tick, 30000)
  setTimeout(tick, 5000)
}
