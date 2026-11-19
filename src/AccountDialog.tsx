/**
 * AccountDialog — create an account, sign in, change the display name or the
 * password, sign out. A thin shell over src/lib/account.ts (ported from
 * CampusPin Showdown's AccountDialog); rendered by App as a full-screen
 * overlay, so the game underneath stays mounted (a draft in progress
 * survives opening it).
 *
 * An account is a username + password + display name. The sign-up form says
 * plainly that the username is NOT an email (people type one by habit), and
 * the form refuses one before anything is sent.
 */

import { useEffect, useState } from 'react'
import {
  type Account,
  changePassword,
  friendlyError,
  login,
  passwordProblem,
  register,
  setDisplayName,
  usernameProblem,
} from './lib/account'

export interface AccountDialogProps {
  /** This device's sign-in, or null when signed out. */
  account: Account | null
  /** Signed in or renamed. App persists it. */
  onChange: (next: Account) => void
  /**
   * Sign this device out (App: save progress to the account, end the
   * session, reset the device's progress). Resolves 'unsaved' — and does NOT sign out —
   * when the server could not be reached to save progress first and `force`
   * is false; the dialog then asks once more.
   */
  onSignOut?: (force: boolean) => Promise<'done' | 'unsaved'>
  onClose: () => void
}

type Form = 'none' | 'register' | 'login'

export function AccountDialog({
  account,
  onChange,
  onSignOut,
  onClose,
}: AccountDialogProps) {
  // The change-password form (signed in): open?, and its two fields.
  const [pwOpen, setPwOpen] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  // True after a sign-out was held back because progress could not be saved.
  const [unsaved, setUnsaved] = useState(false)
  const [form, setForm] = useState<Form>('none')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState(account?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  // Escape closes the overlay (it has no backdrop to click).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Run one action; it resolves to an error sentence, or nothing on success. */
  async function run(action: () => Promise<string | void>, done: string) {
    setBusy(true)
    setError('')
    setNote('')
    try {
      const problem = await action()
      if (problem) setError(problem)
      else setNote(done)
    } finally {
      setBusy(false)
    }
  }

  const submit = () =>
    run(
      async () => {
        const problem =
          form === 'register'
            ? (usernameProblem(username) ?? passwordProblem(password))
            : !username.trim() || !password
              ? 'Enter your username and password.'
              : null
        if (problem) return problem
        const r =
          form === 'register'
            ? await register(username, password, name)
            : await login(username, password)
        if (!r.ok)
          return form === 'register' && r.status === 409
            ? // Also what a retry sees if the first try did create it.
              `${friendlyError(r)} If it’s yours, use Sign in instead.`
            : friendlyError(r)
        setPassword('')
        setName(r.name)
        setForm('none')
        onChange({ token: r.token, username: r.username, name: r.name })
      },
      form === 'register'
        ? 'Account created. Your streaks come with you.'
        : 'Signed in. Your streaks and today’s results are syncing.',
    )

  const saveName = () =>
    run(async () => {
      if (!account) return
      const r = await setDisplayName(account.token, name)
      if (!r.ok) return friendlyError(r)
      setName(r.name)
      onChange({ ...account, name: r.name })
    }, 'Saved.')

  const savePassword = () =>
    run(async () => {
      if (!account) return
      if (!currentPw) return 'Enter your current password.'
      const problem = passwordProblem(newPw)
      if (problem) return problem
      const r = await changePassword(account, currentPw, newPw)
      if (!r.ok) return friendlyError(r)
      setCurrentPw('')
      setNewPw('')
      setPwOpen(false)
    }, 'Password changed. Your other devices have been signed out.')

  const signOut = () =>
    run(async () => {
      if (!account || !onSignOut) return
      if ((await onSignOut(unsaved)) === 'unsaved') {
        setUnsaved(true)
        return 'Couldn’t reach the server, so this device’s latest progress hasn’t been saved to your account. Try again when you’re online — or sign out anyway and lose it.'
      }
      setUnsaved(false)
      setName('')
    }, 'Signed out.')

  return (
    <main
      className="app account"
      role="dialog"
      aria-modal="true"
      aria-label="Your account"
    >
      <button className="btn ghost" onClick={onClose}>
        ← Back
      </button>
      <h2>👤 Your account</h2>

      {account ? (
        <>
          <p className="muted">
            Signed in as <strong>{account.username}</strong>. Your streaks and
            today’s results follow this account on every device you sign in to.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void saveName()
            }}
          >
            <label className="field">
              <span>Display name</span>
              <span className="field-row">
                <input
                  type="text"
                  value={name}
                  maxLength={20}
                  autoComplete="nickname"
                  onChange={(e) => setName(e.target.value)}
                />
                <button type="submit" disabled={busy} className="btn primary">
                  Save
                </button>
              </span>
              <span className="hint">
                Shown next to your result on the leaderboards. 2 to 20
                characters.
              </span>
            </label>
          </form>
          {pwOpen ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void savePassword()
              }}
            >
              <label className="field">
                <span>Current password</span>
                <input
                  type="password"
                  value={currentPw}
                  autoComplete="current-password"
                  onChange={(e) => setCurrentPw(e.target.value)}
                />
                <span className="hint">
                  If you were sent a temporary password, that’s this one.
                </span>
              </label>
              <label className="field">
                <span>New password</span>
                <input
                  type="password"
                  value={newPw}
                  autoComplete="new-password"
                  onChange={(e) => setNewPw(e.target.value)}
                />
                <span className="hint">At least 8 characters.</span>
              </label>
              <div className="row">
                <button type="submit" disabled={busy} className="btn primary">
                  Save new password
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPwOpen(false)
                    setCurrentPw('')
                    setNewPw('')
                    setError('')
                  }}
                  className="btn"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <p>
              <button
                type="button"
                onClick={() => setPwOpen(true)}
                className="link-btn"
              >
                Change password
              </button>
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={signOut}
            className="btn"
          >
            {unsaved ? 'Sign out anyway' : 'Sign out'}
          </button>
          <p className="hint">
            Signing out returns this device to a fresh anonymous player. Your
            streaks stay with your account and come back when you sign in.
          </p>
        </>
      ) : form === 'none' ? (
        <>
          <p className="muted">
            An account keeps your streaks and today’s results in step across
            your phone and your computer, and puts your name on the
            leaderboards. Already have a streak going? It comes with you — sign
            in on each device and the longest one carries on.
          </p>
          <p className="muted">
            Just a username and a password. <strong>No email</strong> needed.
            Forgot your password? The game’s owner can give you a new one.
          </p>
          <div className="row">
            <button
              type="button"
              onClick={() => setForm('register')}
              className="btn primary"
            >
              Create account
            </button>
            <button
              type="button"
              onClick={() => setForm('login')}
              className="btn"
            >
              Sign in
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <h3>{form === 'register' ? 'Create your account' : 'Sign in'}</h3>
          <label className="field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              maxLength={40}
              placeholder={form === 'register' ? 'e.g. spicy_al' : ''}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setUsername(e.target.value)}
            />
            {form === 'register' && (
              <span className="hint">
                <strong>Not an email.</strong> Make up any username: 3 to 20
                letters, numbers or _. We never ask for an email address, and
                the username is only for signing in.
              </span>
            )}
          </label>
          {form === 'register' && (
            <label className="field">
              <span>Display name (optional)</span>
              <input
                type="text"
                value={name}
                maxLength={20}
                autoComplete="nickname"
                onChange={(e) => setName(e.target.value)}
              />
              <span className="hint">
                Shown on the leaderboards. Leave it blank to use your username;
                you can change it any time.
              </span>
            </label>
          )}
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete={
                form === 'register' ? 'new-password' : 'current-password'
              }
              onChange={(e) => setPassword(e.target.value)}
            />
            {form === 'register' && (
              <span className="hint">At least 8 characters.</span>
            )}
          </label>
          <div className="row">
            <button type="submit" disabled={busy} className="btn primary">
              {busy
                ? 'Working…'
                : form === 'register'
                  ? 'Create account'
                  : 'Sign in'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setForm('none')
                setError('')
              }}
              className="btn"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {note && !error && (
        <p role="status" className="account-note">
          {note}
        </p>
      )}
    </main>
  )
}
