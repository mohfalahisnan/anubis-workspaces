import cron from 'node-cron'
import type { CronScheduler, ScheduledHandle } from './cron-service.js'

export class NodeCronScheduler implements CronScheduler {
  schedule(expr: string, fn: () => void): ScheduledHandle {
    const task = cron.schedule(expr, fn, { scheduled: false })
    return {
      start: () => task.start(),
      stop: () => task.stop(),
    }
  }
}
