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

  function wrapHandler <T extends RepositoryPayload> (handler: (event: T) => void | string | Promise<void | string>) {
    return async (event: WebhookEvent<T>) => {
      const { repository } = event.payload
      const groups = options[repository.full_name]
      if (!groups) return

      const message = await handler(event.payload)
      if (!message) return
      for (const id of groups) {
        await ctx.sender.sendGroupMsgAsync(id, message)
      }
    }
  }

  webhook.on('push', wrapHandler<WebhookAPI.WebhookPayloadPush>(({ compare, pusher, commits, repository, ref, after }) => {
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

  webhook.on('commit_comment.created', wrapHandler<WebhookAPI.WebhookPayloadCommitComment>(({ repository, comment }) => {
    return [
      `[GitHub] Commit Comment (${repository.full_name})`,
      `User: ${comment.user.login}`,
      `URL: ${comment.html_url}`,
      comment.body.replace(/\n\s*\n/g, '\n'),
    ].join('\n')
  }))

  webhook.on('issues.opened', wrapHandler<WebhookAPI.WebhookPayloadIssues>(({ repository, issue }) => {
    return [
      `[GitHub] Issue Opened (${repository.full_name}#${issue.number})`,
      `Title: ${issue.title}`,
      `User: ${issue.user.login}`,
      `URL: ${issue.html_url}`,
      issue.body.replace(/\n\s*\n/g, '\n'),
    ].join('\n')
  }))

  webhook.on('issue_comment.created', wrapHandler<WebhookAPI.WebhookPayloadIssueComment>(({ comment, issue, repository }) => {
    return [
      `[GitHub] ${issue['pull_request'] ? 'Pull Request' : 'Issue'} Comment (${repository.full_name}#${issue.number})`,
      `User: ${comment.user.login}`,
      `URL: ${comment.html_url}`,
      comment.body.replace(/\n\s*\n/g, '\n'),
    ].join('\n')
  }))

  webhook.on('pull_request.opened', wrapHandler<WebhookAPI.WebhookPayloadPullRequest>(({ repository, pull_request }) => {
    return [
      `[GitHub] Pull Request Opened (${repository.full_name}#${pull_request.id})`,
      `${pull_request.base.label} <- ${pull_request.head.label}`,
      `User: ${pull_request.user.login}`,
      `URL: ${pull_request.html_url}`,
      pull_request.body.replace(/\n\s*\n/g, '\n'),
    ].join('\n')
  }))

  webhook.on('pull_request_review.submitted', wrapHandler<WebhookAPI.WebhookPayloadPullRequestReview>(({ repository, review, pull_request }) => {
    if (!review.body) return
    return [
      `[GitHub] Pull Request Review (${repository.full_name}#${pull_request.id})`,
      `User: ${review.user.login}`,
      `URL: ${review.html_url}`,
      // @ts-ignore
      review.body.replace(/\n\s*\n/g, '\n'),
    ].join('\n')
  }))

  webhook.on('pull_request_review_comment.created', wrapHandler<WebhookAPI.WebhookPayloadPullRequestReviewComment>(({ repository, comment, pull_request }) => {
    return [
      `[GitHub] Pull Request Review (${repository.full_name}#${pull_request.id})`,
      `Path: ${comment.path}`,
      `User: ${comment.user.login}`,
      `URL: ${comment.html_url}`,
      comment.body.replace(/\n\s*\n/g, '\n'),
    ].join('\n')
  }))
}
