/**
 * The way into the account dialog: "👤 Sign in" when signed out, the display
 * name when signed in. Renders nothing when accounts are off (no leaderboard
 * worker) or outside App. `quiet` is the footer's text-link form; the default
 * is a top-bar pill.
 */
import { useAccountUi } from './account-context'

export function AccountButton({ quiet = false }: { quiet?: boolean }) {
  const ui = useAccountUi()
  if (!ui) return null
  const label = ui.account ? `👤 ${ui.account.name}` : '👤 Sign in'
  return (
    <button
      type="button"
      className={quiet ? 'link-btn' : 'btn ghost account-btn'}
      onClick={ui.open}
      title={
        ui.account
          ? 'Your account'
          : 'Sign in or create an account to keep your streaks on every device'
      }
    >
      {quiet && !ui.account ? '👤 Sign in / create account' : label}
    </button>
  )
}
