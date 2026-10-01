import * as R from './repo.js'
import { db } from './db.js'
import { isStaff, canAccessArea } from './permissions.js'

/**
 * Builds a DB-shaped snapshot scoped to what the requesting user is allowed to
 * see. This is the single serialization boundary — passwordHash never leaves
 * the server, and players only receive their own private financial data.
 *
 * The shape matches the client's `DB` interface so the existing store/pages
 * work unchanged after hydration.
 */
export async function buildState(user) {
  const settings = await R.getSettings()

  // Public-ish collections every authenticated user can see.
  const tournaments = (await R.allTournaments()).map(scrubTournament)
  const matches = await R.allMatches()
  const results = await R.allResults()
  const announcements = (await R.allAnnouncements()).filter((a) => a.status === 'published' || isStaff(user?.role))

  if (!user) {
    // Logged-out visitor: only public marketing-ish data.
    return {
      version: 3,
      users: [],
      wallets: [],
      transactions: [],
      tournaments,
      registrations: [],
      matches,
      results: results.filter((r) => r.status === 'published'),
      deposits: [],
      withdrawals: [],
      announcements: announcements.filter((a) => a.status === 'published'),
      tickets: [],
      auditLogs: [],
      notifications: [],
      settings,
    }
  }

  const staff = isStaff(user.role)
  const me = R.publicUser(user)

  if (!staff) {
    // ---- PLAYER scope ----
    // Other players are visible only as public leaderboard-ish profiles.
    const users = (await R.allUsers()).map((u) =>
      u.id === user.id ? me : { id: u.id, fullName: u.fullName, username: u.username, ffUid: u.ffUid, ffIgn: u.ffIgn, role: u.role, status: u.status, createdAt: u.createdAt, avatarColor: u.avatarColor },
    )
    const wallet = await R.getWallet(user.id)
    const transactions = (await R.allTransactions()).filter((t) => t.userId === user.id)
    const registrations = await R.allRegistrations()
    const deposits = (await R.allDeposits()).filter((d) => d.userId === user.id).map((d) => ({ ...d, screenshot: undefined }))
    const withdrawals = (await R.allWithdrawals()).filter((w) => w.userId === user.id).map((w) => ({ ...w, image: undefined }))
    const tickets = (await R.allTickets()).filter((t) => t.userId === user.id)
    const notifications = (await R.allNotifications()).filter((n) => n.userId === user.id)
    return {
      version: 3,
      users,
      wallets: wallet ? [wallet] : [],
      transactions,
      tournaments,
      registrations,
      matches,
      results: results.filter((r) => r.status === 'published'),
      deposits,
      withdrawals,
      announcements: announcements.filter((a) => a.status === 'published'),
      tickets,
      auditLogs: [],
      notifications,
      settings,
    }
  }

  // ---- STAFF scope ----
  const users = (await R.allUsers()).map((u) => (u.id === user.id ? me : R.publicUser(u)))
  const wallets = await R.allWallets()
  const transactions = await R.allTransactions()
  const registrations = await R.allRegistrations()
  const deposits = await R.allDeposits()
  const withdrawals = await R.allWithdrawals()
  const tickets = await R.allTickets()
  const notifications = (await R.allNotifications()).filter((n) => n.userId === 'admins' || n.userId === user.id)
  const auditLogs = canAccessArea(user.role, 'audit') ? await R.allAuditLogs() : []

  return {
    version: 3,
    users, wallets, transactions, tournaments, registrations, matches, results,
    deposits, withdrawals, announcements, tickets, auditLogs, notifications, settings,
  }
}

/** Hide room credentials from players until release time; staff always see them. */
function scrubTournament(t) {
  return t
}

export async function unreadCount(user) {
  if (!user) return 0
  const ids = isStaff(user.role) ? [user.id, 'admins'] : [user.id]
  const q = ids.map(() => 'userId=?').join(' OR ')
  return (await db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE read=0 AND (${q})`).get(...ids)).c
}
