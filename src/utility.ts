import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
export { dayjs }

dayjs.extend(utc)

export function getNextMidnightUTC(now: number) {
  return dayjs(now)
    .utc()
    .set('h', 0)
    .set('m', 0)
    .set('s', 0)
    .set('ms', 0)
    .add(1, 'day')
    .valueOf()
}
