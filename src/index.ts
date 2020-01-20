import { Context, onStart, onStop } from 'koishi-core'
import { Server, createServer } from 'http'
import WebhookAPI, { PayloadRepository, WebhookEvent } from '@octokit/webhooks'

declare module 'koishi-core/dist/app' {
  export interface AppOptions {
    githubWebhook?: WebhookConfig
  }
}

export interface WebhookConfig {
  port?: number
  secret?: string
  path?: string
}

export const webhooks: Record<string, WebhookAPI> = {}
export const servers: Record<number, Server> = {}

const defaultOptions: WebhookConfig = {
  port: 12140,
  secret: '',
  path: '/',
}

interface RepositoryPayload {
  repository: PayloadRepository
}

export const name = 'github-webhook'

export function apply (ctx: Context, options: Record<string, number[]> = {}) {
  ctx = ctx.intersect(ctx.app.groups)

  const config = ctx.app.options.githubWebhook = {
    ...defaultOptions,
    ...ctx.app.options.githubWebhook,
  }

  const key = config.path + config.secret + config.port
  if (!webhooks[key]) {
    webhooks[key] = new WebhookAPI(config as any)
  }
  const webhook = webhooks[key]

  if (!servers[config.port]) {
    const server = servers[config.port] = createServer(webhooks[key].middleware)
    onStart(() => server.listen(config.port))
    onStop(() => server.close())
  }

  function wrapHandler <T extends RepositoryPayload> (handler: (event: WebhookEvent<T>) => void | string | Promise<void | string>) {
    return async (event: WebhookEvent<T>) => {
      const { repository } = event.payload
      const groups = options[repository.full_name]
      if (!groups) return

      const message = await handler(event)
      if (!message) return
      for (const id of groups) {
        await ctx.sender.sendGroupMsgAsync(id, message)
      }
    }
  }

  webhook.on('push', wrapHandler<WebhookAPI.WebhookPayloadPush>((event) => {
    const { compare, pusher, commits, repository, ref, after } = event.payload

    // do not show pull request merge
    if (/^0+$/.test(after)) return

    // use short form for tag releases
    if (ref.startsWith('refs/tags')) {
      return `[GitHub] ${repository.full_name} published tag ${ref.slice(10)}`
    }

    return [
      `[GitHub] Push (${repository.full_name})`,
      `Ref: ${ref}`,
      `User: ${pusher.name}`,
      `Compare: ${compare}`,
      ...commits.map(c => c.message.replace(/\n\s*\n/g, '\n')),
    ].join('\n')
  }))
}
