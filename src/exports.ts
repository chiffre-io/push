/**
 * The data format serialized to JSON and sent to the Redis queue
 */
export interface SerializedMessage {
  /**
   * Encrypted payload
   */
  payload: string

  /**
   * Timestamp of reception, for internal performance metrics
   */
  received: number

  /**
   * Time spent by the client for serializing and encrypting the
   * payload, for internal performance metrics
   */
  perf: number

  /**
   * Country code of origin of the message
   */
  country?: string
}

// --

export interface ProjectConfig {
  /**
   * A list of origins to allow messages from (spam protection)
   */
  origins: string[]

  /**
   * Limit the ingress per rolling 24h to a given number of messages
   */
  dailyLimit?: number
}

export enum KeyIDs {
  config = 'config',
  data = 'data',
  count = 'count'
}

export function getProjectKey(projectID: string, keyID: KeyIDs) {
  return `${projectID}.${keyID}`
}

export function getProjectIDFromKey(key: string) {
  return key.split('.')[0]
}

// --

export enum PubSubChannels {
  newDataAvailable = 'push:new-data-available',
  overLimit = 'push:over-limit'
}

export interface OverLimitStats {
  projectID: string
  usage: number
  overUsage: number
  currentTime: number
  remainingTime: number
}
