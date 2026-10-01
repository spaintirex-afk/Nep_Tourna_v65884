import * as A from './server/actions.js'
import * as R from './server/repo.js'
import { db, configureDatabase, initializeDatabase, nowIso } from './server/db.js'
import { buildState, unreadCount } from './server/state.js'
import { isStaff } from './server/permissions.js'

const COOKIE = 'nt_session'
const SESSION_DAYS_REMEMBER = 30
const SESSION_DAYS_TAB = 1

const ACTIONS = {
  '/api/profile/update': A.updateProfile,
  '/api/password/change': A.changePassword,
  '/api/tournaments/create': A.createTournament,
  '/api/tournaments/update': A.updateTournament,
  '/api/tournaments/status': A.setTournamentStatus,
  '/api/tournaments/cancel': A.cancelTournament,
  '/api/tournaments/delete': A.deleteTournament,
  '/api/tournaments/join': A.joinTournament,
  '/api/tournaments/leave': A.cancelRegistration,
  '/api/deposits/request': A.requestDeposit,
  '/api/deposits/review': A.reviewDeposit,
  '/api/withdrawals/request': A.requestWithdrawal,
  '/api/withdrawals/review': A.reviewWithdrawal,
  '/api/wallet/adjust': A.adjustBalance,
  '/api/players/status': A.setPlayerStatus,
  '/api/players/role': A.setUserRole,
  '/api/matches/save': A.saveMatch,
  '/api/matches/status': A.setMatchStatus,
  '/api/matches/delete': A.deleteMatch,
  '/api/results/draft': A.saveResultDraft,
  '/api/results/status': A.setResultStatus,
  '/api/results/distribute': A.distributePrizes,
  '/api/announcements/save': A.saveAnnouncement,
  '/api/announcements/status': A.setAnnouncementStatus,
  '/api/announcements/delete': A.deleteAnnouncement,
  '/api/tickets/create': A.createTicket,
  '/api/tickets/reply': A.replyTicket,
  '/api/tickets/status': A.setTicketStatus,
  '/api/settings/update': A.updateSettings,
  '/api/notifications/read': A.markNotificationRead,
  '/api/notifications/read-all': A.markAllNotificationsRead,
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  })
}

function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i >= 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function sessionCookie(token, expiresAt, persistent) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${persistent ? maxAge : maxAge}`
}

function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`
}

function newToken() {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
}

async function createSession(userId, remember) {
  const token = newToken()
  const days = remember ? SESSION_DAYS_REMEMBER : SESSION_DAYS_TAB
  const expiresAt = new Date(Date.now() + days * 864e5).toISOString()
  await db.prepare('INSERT INTO sessions (token,userId,createdAt,expiresAt) VALUES (?,?,?,?)').run(token, userId, nowIso(), expiresAt)
  return { token, expiresAt, persistent: remember }
}

async function readSession(request) {
  const token = parseCookies(request.headers.get('Cookie'))[COOKIE]
  if (!token) return null
  const s = await db.prepare('SELECT * FROM sessions WHERE token=?').get(token)
  if (!s) return null
  if (new Date(s.expiresAt).getTime() < Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token=?').run(token)
    return null
  }
  const user = await R.getUser(s.userId)
  if (!user || user.status === 'suspended') return null
  return { token, user }
}

async function destroySession(request) {
  const token = parseCookies(request.headers.get('Cookie'))[COOKIE]
  if (token) await db.prepare('DELETE FROM sessions WHERE token=?').run(token)
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin')
  const allowed = (env.CORS_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean)
  const headers = { 'Access-Control-Allow-Headers': 'Content-Type, Accept', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', Vary: 'Origin' }
  if (origin && (allowed.length === 0 ? origin : allowed.includes(origin))) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Credentials'] = 'true'
  }
  return headers
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(corsHeaders(request, env))) headers.set(k, v)
  return new Response(response.body, { status: response.status, headers })
}

async function body(request) {
  try { return await request.json() } catch { return {} }
}

async function errorResponse(e) {
  if (e instanceof A.AppError) return json({ ok: false, error: e.message }, e.status)
  console.error('[api error]', e)
  return json({ ok: false, error: 'Server error. Please try again.' }, 500)
}

async function api(request, env) {
  const url = new URL(request.url)
  const path = url.pathname

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })

  configureDatabase(env.DB)
  await initializeDatabase()

  if (request.method === 'GET' && path === '/api/state') {
    const session = await readSession(request)
    return json({ ok: true, me: R.publicUser(session?.user || null), state: await buildState(session?.user || null), unread: await unreadCount(session?.user || null) })
  }

  if (request.method === 'GET' && path === '/api/events') {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: hello\ndata: {}\n\n'))
        controller.enqueue(new TextEncoder().encode('event: changed\ndata: {}\n\n'))
        controller.close()
      },
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
  }

  if (request.method !== 'POST') return json({ ok: false, error: 'Not found.' }, 404)
  const input = await body(request)

  if (path === '/api/register') {
    try {
      const { id } = await A.register(input)
      const user = await R.getUser(id)
      const session = await createSession(id, true)
      return json({ ok: true, id, state: await buildState(user), unread: await unreadCount(user), me: R.publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(session.token, session.expiresAt, true) })
    } catch (e) { return await errorResponse(e) }
  }

  if (path === '/api/login') {
    try {
      const { email, password, remember, adminOnly } = input
      const { id } = await A.login({ email, password, adminOnly })
      const user = await R.getUser(id)
      const session = await createSession(id, !!remember)
      return json({ ok: true, id, state: await buildState(user), unread: await unreadCount(user), me: R.publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(session.token, session.expiresAt, !!remember) })
    } catch (e) { return await errorResponse(e) }
  }

  if (path === '/api/logout') {
    try {
      const session = await readSession(request)
      if (session?.user) await R.addAudit(session.user, 'Logout', session.user.username, 'User logged out', 'auth')
      await destroySession(request)
      return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() })
    } catch (e) { return await errorResponse(e) }
  }

  if (path === '/api/reset-password') {
    try { return json({ ok: true, ...(await A.resetPassword(input)) }) } catch (e) { return await errorResponse(e) }
  }

  const fn = ACTIONS[path]
  if (!fn) return json({ ok: false, error: 'Not found.' }, 404)

  const session = await readSession(request)
  if (!session?.user) return json({ ok: false, error: 'You must be logged in.' }, 401)

  try {
    const result = await fn(session.user, input, request)
    return json({ ok: true, ...(result || {}) })
  } catch (e) {
    return await errorResponse(e)
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url)
      let response
      if (url.pathname.startsWith('/api/')) {
        response = await api(request, env)
      } else {
        response = await env.ASSETS.fetch(request)
      }
      return withCors(response, request, env)
    } catch (e) {
      return withCors(await errorResponse(e), request, env)
    }
  },
}
