import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
export { dayjs }

dayjs.extend(utc)

export function getNextMidnightUTC(now: number) {
  return dayjs(now).utc().startOf('day').add(1, 'day').valueOf()
}
