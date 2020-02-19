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
}

export function getProjectConfigKey(projectID: string) {
  return `${projectID}.config`
}

export function getProjectDataKey(projectID: string) {
  return `${projectID}.data`
}
