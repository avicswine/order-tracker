import express from 'express'
import cors from 'cors'
import carriersRouter from './routes/carriers'
import ordersRouter from './routes/orders'
import blingRouter from './routes/bling'
import trackingRouter from './routes/tracking'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }))
app.use(express.json())

app.use('/api/carriers', carriersRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/bling', blingRouter)
app.use('/api/tracking', trackingRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

export default app
