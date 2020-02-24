import fp from 'fastify-plugin'
import { StatsD } from 'node-statsd'

export type MetricsDecoration = {
  increment: (stat: Metrics, projectID: string) => void
  time: (stat: Metrics, projectID: string, time: number) => void
  gauge: (stat: Metrics, projectID: string, value: any) => void
  histogram: (stat: Metrics, projectID: string, value: any) => void
}

export enum Metrics {
  invalidProjectConfig = 'invalid_projectConfig',
  invalidOrigin = 'invalid_origin',
  invalidPayload = 'invalid_payload',
  invalidCountry = 'invalid_country',
  overUsageCount = 'overUsage_count',
  overUsageUsage = 'overUsage_usage',
  overUsageRemaining = 'overUsage_remaining',
  processedCount = 'processed_count',
  processedPerf = 'processed_perf',
  processedSize = 'processed_size',
  processedCountry = 'processed_country'
}

export default fp(function metricsPlugin(app, _, next) {
  const client = new StatsD({
    host: process.env.STATSD_HOST || 'localhost',
    port: parseInt(process.env.STATSD_PORT || '8125'),
    mock: process.env.ENABLE_METRICS !== 'true',
    prefix: 'push_',
    global_tags: [
      `release:${process.env.SENTRY_RELEASE || 'dev'}`,
      `inst:${(process.env.INSTANCE_ID || 'local').slice(0, 8)}`
    ]
  })

  const decoration: MetricsDecoration = {
    increment: function increment(metric, projectID) {
      client.increment(metric)
      client.increment(`${metric}_${projectID}`)
    },
    time: function time(metric, projectID, time) {
      client.timing(metric, time)
      client.timing(`${metric}_${projectID}`, time)
    },
    gauge: function gauge(metric, projectID, value) {
      client.gauge(metric, value)
      client.gauge(`${metric}_${projectID}`, value)
    },
    histogram: function gauge(metric, projectID, value) {
      client.histogram(metric, value)
      client.histogram(`${metric}_${projectID}`, value)
    }
  }

  app.decorate('metrics', decoration)
  next()
})
