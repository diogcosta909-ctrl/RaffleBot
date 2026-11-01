import { cryptoEnabled } from './cryptoPay'

/**
 * Payment options shown to users.
 * STARS_ENABLED="0" hides Stars everywhere and leaves USDT only (ignored when USDT is not set up, so people can always pay).
 */
export function starsEnabled() {
  return process.env.STARS_ENABLED !== '0' || !cryptoEnabled()
}

/** TERMS_REQUIRED="0": nobody has to accept the terms before buying or using a feature */
export function termsRequired() {
  return process.env.TERMS_REQUIRED !== '0'
}
