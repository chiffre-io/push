import { App } from '../server'
import { Metrics } from '../plugins/metrics'

export default async function projectIDRoutes(app: App) {
  app.get(
    '*',
    {
      logLevel: 'warn'
    },
    (_req, res) => {
      app.metrics.raw.increment(Metrics.catchAll)
      res.status(204).send()
    }
  )
}
