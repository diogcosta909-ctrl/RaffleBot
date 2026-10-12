// Dependencies
import * as mongoose from 'mongoose'

// Connect to mongoose
const mongoUrl =
  process.env.MONGO || process.env.MONGO_URL || process.env.MONGODB_URL
if (!mongoUrl) {
  console.error('Falta la variable MONGO (URL de MongoDB) en Railway')
  process.exit(1)
}
mongoose.connect(mongoUrl, {
  // Railway's MONGO_URL has no database name in the path
  dbName: process.env.MONGO_DB || 'rafflebot',
  useNewUrlParser: true,
  useCreateIndex: true,
  // Small bot: fewer open connections = less memory
  poolSize: 2,
})

// Get models
import { addRaffle, getRaffle, Raffle, getRaffleWithoutParticipantIds, RaffleModel } from './raffle'
// Export models
export { addRaffle, getRaffle, Raffle, getRaffleWithoutParticipantIds, RaffleModel }
