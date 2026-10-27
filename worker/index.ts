import { handleAuthApi, hasValidSession, type AuthConfig } from '../src/server/auth'
import { handleEntityApi } from '../src/server/entity-api'
import type { CoverKV, D1Database, Fetcher } from './cloudflare-types'
import { handleBookMetadataSearch } from './book-metadata-search'
import { handleCoverSearch } from './cover-search'
import { handlePhotoBookOcr, type PhotoAI } from './photo-book-ocr'
import { handleCoverAssetApi } from './cover-assets'
import { D1AuthRateLimiter } from './d1-auth-rate-limiter'
import { D1EntityStore } from './d1-entity-store'
import { createReadingGoalStore } from './reading-goal-store'
import { createSourceReadingDayStore } from './source-reading-day-store'
import { createReadingPreferencesStore } from './reading-preferences-store'
import { handleNotionPilotApi } from './notion-pilot-api'
import { handleNotionCoverBackfill } from './notion-cover-backfill'
import {
  handleMicrosoftOneDriveCallback,
  handleMicrosoftOneDriveConnect,
  MicrosoftOneDriveTokenProvider
} from './microsoft-onedrive-auth'
import { syncOneDriveMoonBackups } from './onedrive-moon-backup-sync'
import type { AtomicMoonD1Database } from './moon-backup-d1-import'

interface Env {
  GOOGLE_BOOKS_API_KEY?: string
  AI?: PhotoAI
  READING_CENTER_DB?: D1Database
  READING_CENTER_COVERS?: CoverKV
  ASSETS: Fetcher
  API_ENABLED?: string
  AUTH_PASSWORD?: string
  AUTH_SESSION_SECRET?: string
  NOTION_PILOT_ENABLED?: string
  MICROSOFT_CLIENT_ID?: string
  MICROSOFT_CLIENT_SECRET?: string
  MICROSOFT_TENANT_ID?: string
  MICROSOFT_REDIRECT_URI?: string
  MICROSOFT_TOKEN_ENCRYPTION_KEY?: string
  MOON_SYNC_ENABLED?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    const authConfig = readAuthConfig(env)
    if (pathname.startsWith('/api/v1/auth/')) {
      if (pathname === '/api/v1/auth/login' && !env.READING_CENTER_DB) {
        return Response.json(
          { error: { code: 'database_unavailable', message: 'Remote database is not configured' } },
          { status: 503, headers: { 'Cache-Control': 'no-store' } }
        )
      }
      const rateLimiter = env.READING_CENTER_DB ? new D1AuthRateLimiter(env.READING_CENTER_DB) : undefined
      return handleAuthApi(request, authConfig, Date.now(), rateLimiter)
    }

    if (env.API_ENABLED !== 'true') {
      return Response.json({ error: { code: 'api_disabled', message: 'Remote data API is not enabled' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    if (!authConfig) {
      return Response.json({ error: { code: 'auth_not_configured', message: 'Authentication is not configured' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    // The callback authenticates Microsoft using the signed OAuth state cookie and PKCE.
    // It must be reachable before the ReadingCenter app-session guard, since the
    // external identity provider redirects back without an app-session cookie.
    if (pathname === '/api/v1/onedrive/callback' && request.method === 'GET') {
      if (!env.READING_CENTER_DB) {
        return Response.json({ error: { code: 'database_unavailable', message: 'Remote database is not configured' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
      }
      const auth = readAuthConfig(env)
      if (!auth) return Response.json({ error: { code: 'auth_not_configured', message: 'Authentication is not configured' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
      return handleMicrosoftOneDriveCallback(request, env.READING_CENTER_DB, readMicrosoftOneDriveConfig(env, auth.sessionSecret))
    }
    if (!(await hasValidSession(request, authConfig.sessionSecret))) {
      return Response.json({ error: { code: 'authentication_required', message: 'Sign in is required' } }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    }
    if (!env.READING_CENTER_DB) {
      return Response.json({ error: { code: 'database_unavailable', message: 'Remote database is not configured' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    if (pathname === '/api/v1/onedrive/connect' && request.method === 'GET') {
      const auth = readAuthConfig(env)
      if (!auth) return Response.json({ error: { code: 'auth_not_configured', message: 'Authentication is not configured' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
      return handleMicrosoftOneDriveConnect(readMicrosoftOneDriveConfig(env, auth.sessionSecret))
    }
    if (pathname === '/api/v1/import/photo/book') return handlePhotoBookOcr(request, env.READING_CENTER_DB, env.AI)
    if (pathname === '/api/v1/import/notion/pilot' || pathname === '/api/v1/import/notion/batch' || pathname === '/api/v1/import/notion/cover') {
      if (env.NOTION_PILOT_ENABLED !== 'true') {
        return Response.json({ error: { code: 'import_disabled', message: 'Notion pilot import is not enabled' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
      }
      if (pathname.endsWith('/cover')) return handleNotionCoverBackfill(request, new D1EntityStore(env.READING_CENTER_DB), env.READING_CENTER_COVERS)
      return handleNotionPilotApi(request, env.READING_CENTER_DB, env.READING_CENTER_COVERS, pathname.endsWith('/batch'))
    }
    if (pathname === '/api/v1/books/metadata' || pathname === '/api/v1/books/metadata/cover') return handleBookMetadataSearch(request, env.GOOGLE_BOOKS_API_KEY)
    if (pathname === '/api/v1/covers/search' || pathname.startsWith('/api/v1/covers/search/image/')) return handleCoverSearch(request, env.READING_CENTER_COVERS)
    if (pathname.startsWith('/api/v1/covers/')) return handleCoverAssetApi(request, env.READING_CENTER_COVERS, env.NOTION_PILOT_ENABLED === 'true')
    if (pathname === '/api/v1/entities/sourceReadingDay' || pathname.startsWith('/api/v1/entities/sourceReadingDay/')) {
      try { return await handleEntityApi(request, await createSourceReadingDayStore(env.READING_CENTER_DB)) } catch {
        return Response.json({ error: { code: 'source_storage_unavailable', message: 'Unable to initialize source reading storage' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
      }
    }
    if (pathname === '/api/v1/entities/readingPreferences' || pathname.startsWith('/api/v1/entities/readingPreferences/')) {
      try { return await handleEntityApi(request, await createReadingPreferencesStore(env.READING_CENTER_DB)) } catch {
        return Response.json({ error: { code: 'preferences_storage_unavailable', message: 'Unable to initialize reading preferences storage' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
      }
    }
    if (pathname === '/api/v1/entities/readingGoal' || pathname.startsWith('/api/v1/entities/readingGoal/')) {
      try { return await handleEntityApi(request, await createReadingGoalStore(env.READING_CENTER_DB)) } catch {
        return Response.json({ error: { code: 'goal_storage_unavailable', message: 'Unable to initialize reading goal storage' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
      }
    }
    return handleEntityApi(request, new D1EntityStore(env.READING_CENTER_DB))
  },

  async scheduled(
    _event: { cron: string },
    env: Env,
    controller: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<void> {
    if (env.MOON_SYNC_ENABLED !== 'true') return
    if (!env.READING_CENTER_DB) {
      console.error('Moon+ OneDrive sync skipped: D1 is not configured')
      return
    }
    const auth = readAuthConfig(env)
    if (!auth) {
      console.error('Moon+ OneDrive sync skipped: Reading Center auth is not configured')
      return
    }
    const tokenProvider = new MicrosoftOneDriveTokenProvider(
      env.READING_CENTER_DB,
      readMicrosoftOneDriveConfig(env, auth.sessionSecret)
    )
    controller.waitUntil(syncOneDriveMoonBackups({
      database: env.READING_CENTER_DB as AtomicMoonD1Database,
      tokenProvider
    }).then(result => {
      console.log('Moon+ OneDrive sync completed', JSON.stringify(result))
    }).catch(error => {
      console.error('Moon+ OneDrive sync failed', error instanceof Error ? error.message : 'unknown error')
    }))
  }
}

function readMicrosoftOneDriveConfig(env: Env, sessionSecret: string) {
  return {
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
    tenantId: env.MICROSOFT_TENANT_ID,
    redirectUri: env.MICROSOFT_REDIRECT_URI,
    tokenEncryptionKey: env.MICROSOFT_TOKEN_ENCRYPTION_KEY,
    sessionSecret
  }
}

function readAuthConfig(env: Env): AuthConfig | undefined {
  if (!env.AUTH_PASSWORD || !env.AUTH_SESSION_SECRET) return undefined
  return { password: env.AUTH_PASSWORD, sessionSecret: env.AUTH_SESSION_SECRET }
}


