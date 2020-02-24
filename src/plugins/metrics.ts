import fp from 'fastify-plugin'
import { StatsD } from 'node-statsd'

export type MetricsDecoration = {
  increment: (stat: Metrics, projectID: string) => void
  time: (stat: Metrics, projectID: string, time: number) => void
  gauge: (stat: Metrics, projectID: string, value: any) => void
  histogram: (stat: Metrics, projectID: string, value: any) => void
}

export enum Metrics {
  invalidProjectConfig = 'invalid.projectConfig',
  invalidOrigin = 'invalid.origin',
  invalidPayload = 'invalid.payload',
  invalidCountry = 'invalid.country',
  overUsageCount = 'overUsage.count',
  overUsageUsage = 'overUsage.usage',
  overUsageRemaining = 'overUsage.remaining',
  processedCount = 'processed.count',
  processedPerf = 'processed.perf',
  processedSize = 'processed.size',
  processedCountry = 'processed.country'
}

export default fp(function metricsPlugin(app, _, next) {
  const client = new StatsD({
    host: process.env.STATSD_HOST || 'localhost',
    port: parseInt(process.env.STATSD_PORT || '8125'),
    mock: process.env.ENABLE_METRICS !== 'true',
    prefix: 'push',
    global_tags: [
      `release:${process.env.SENTRY_RELEASE || 'dev'}`,
      `inst:${(process.env.INSTANCE_ID || 'local').slice(0, 8)}`
    ]
  })

  const decoration: MetricsDecoration = {
    increment: function increment(metric, projectID) {
      client.increment(metric)
      client.increment(`${metric}.${projectID}`)
    },
    time: function time(metric, projectID, time) {
      client.timing(metric, time)
      client.timing(`${metric}.${projectID}`, time)
    },
    gauge: function gauge(metric, projectID, value) {
      client.gauge(metric, value)
      client.gauge(`${metric}.${projectID}`, value)
    },
    histogram: function gauge(metric, projectID, value) {
      client.histogram(metric, value)
      client.histogram(`${metric}.${projectID}`, value)
    }
  }

  app.decorate('metrics', decoration)
  next()
})
