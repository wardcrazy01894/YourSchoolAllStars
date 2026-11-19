/**
 * What any screen needs to know about the optional account (src/lib/account.ts)
 * without App threading it through every component: who is signed in, and how
 * to open the account dialog. `null` outside App (isolated component tests)
 * and when accounts are off (no leaderboard worker) — the entry points then
 * render nothing.
 */
import { createContext, useContext } from 'react'
import type { Account } from './lib/account'

export interface AccountUi {
  /** This device's sign-in, or null when signed out. */
  account: Account | null
  /** Open the account dialog (sign in / create / manage). */
  open: () => void
}

export const AccountContext = createContext<AccountUi | null>(null)

export const useAccountUi = () => useContext(AccountContext)
