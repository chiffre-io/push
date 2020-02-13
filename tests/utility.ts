import fs from 'fs'
import dotenv from 'dotenv'
import axios, { AxiosInstance } from 'axios'
import { startServer } from 'fastify-micro'
import createServer from '../src/server'
import { App } from '../src/server'
import path from 'path'
import Redis from 'ioredis'

export interface TestContext {
  server: App
  api: AxiosInstance
  redis: Redis.Redis
}

export async function setup(): Promise<TestContext> {
  const envFilePath = path.resolve(__dirname, 'e2e.env')
  dotenv.config({
    path: envFilePath
  })
  const envConfig = dotenv.parse(fs.readFileSync(envFilePath))
  for (const k in envConfig) {
    process.env[k] = envConfig[k]
  }

  const port = parseInt(process.env.PORT!)
  const server = createServer()
  await startServer(server, port)
  const api = axios.create({
    baseURL: process.env.PUSH_URL,
    validateStatus: () => true
  })
  api.defaults.headers.post['Content-Type'] = 'text/plain;charset=UTF-8'
  const redis = new Redis(process.env.REDIS_URI)
  return { server, api, redis }
}
