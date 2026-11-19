// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react'

const api = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  setDisplayName: vi.fn(),
  changePassword: vi.fn(),
}))
vi.mock('./lib/account', async (importActual) => ({
  ...(await importActual<typeof import('./lib/account')>()),
  ...api,
}))

import { AccountDialog } from './AccountDialog'

const TOKEN = 'f'.repeat(48)
const AL = { token: TOKEN, username: 'spicy_al', name: 'Spicy Al' }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('AccountDialog — signed out', () => {
  it('explains what an account is for and that it needs no email', () => {
    render(
      <AccountDialog account={null} onChange={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.getByRole('dialog', { name: 'Your account' })).toBeTruthy()
    expect(screen.getByText(/no email/i)).toBeTruthy()
    // A forgotten password can be reset by the owner now: no scare copy.
    expect(document.body.textContent).not.toMatch(/can’t be reset|no reset/i)
    expect(screen.getByText(/streak/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })

  it('the sign-up form says the username is NOT an email', () => {
    render(
      <AccountDialog account={null} onChange={vi.fn()} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByText('Not an email.')).toBeTruthy()
    expect(screen.getByText(/never ask for an email address/i)).toBeTruthy()
    // The field is a plain text field named as a username, not an email one.
    const field = screen.getByLabelText(/^Username/) as HTMLInputElement
    expect(field.type).toBe('text')
    expect(field.autocomplete).toBe('username')
  })

  it('stops an email typed as a username before anything is sent', async () => {
    render(
      <AccountDialog account={null} onChange={vi.fn()} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    type(/^Username/, 'al@umich.edu')
    type(/^Password/, 'correct horse')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /not an email/i,
    )
    expect(api.register).not.toHaveBeenCalled()
  })

  it('stops a short password', async () => {
    render(
      <AccountDialog account={null} onChange={vi.fn()} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    type(/^Username/, 'spicy_al')
    type(/^Password/, 'short')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 8/)
    expect(api.register).not.toHaveBeenCalled()
  })

  it('creates the account with username, password and display name', async () => {
    api.register.mockResolvedValue({ ok: true, ...AL })
    const onChange = vi.fn()
    render(
      <AccountDialog account={null} onChange={onChange} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    type(/^Username/, 'spicy_al')
    type(/^Display name/, 'Spicy Al')
    type(/^Password/, 'correct horse')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(AL))
    expect(api.register).toHaveBeenCalledWith(
      'spicy_al',
      'correct horse',
      'Spicy Al',
    )
  })

  it('signs in, and shows the server’s refusal when it fails', async () => {
    api.login.mockResolvedValueOnce({
      ok: false,
      error: 'wrong username or password',
      status: 401,
    })
    const onChange = vi.fn()
    render(
      <AccountDialog account={null} onChange={onChange} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    // No display-name field and no "not an email" lecture when signing in.
    expect(screen.queryByLabelText(/^Display name/)).toBeNull()
    type(/^Username/, 'spicy_al')
    type(/^Password/, 'wrong horse')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Wrong username or password.',
    )
    expect(onChange).not.toHaveBeenCalled()

    api.login.mockResolvedValueOnce({ ok: true, ...AL })
    type(/^Password/, 'correct horse')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(AL))
  })
})

describe('AccountDialog — signed in', () => {
  it('shows who is signed in and saves a new display name', async () => {
    api.setDisplayName.mockResolvedValue({
      ok: true,
      username: 'spicy_al',
      name: 'Big Al',
    })
    const onChange = vi.fn()
    render(<AccountDialog account={AL} onChange={onChange} onClose={vi.fn()} />)
    expect(screen.getByText('spicy_al')).toBeTruthy()
    const name = screen.getByLabelText(/^Display name/) as HTMLInputElement
    expect(name.value).toBe('Spicy Al')
    type(/^Display name/, 'Big Al')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ ...AL, name: 'Big Al' }),
    )
    expect(api.setDisplayName).toHaveBeenCalledWith(TOKEN, 'Big Al')
  })

  it('signs out through the app, which saves progress to the account first', async () => {
    const onSignOut = vi.fn(async () => 'done' as const)
    render(
      <AccountDialog
        account={AL}
        onChange={vi.fn()}
        onSignOut={onSignOut}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(onSignOut).toHaveBeenCalledWith(false))
  })

  it('warns before discarding progress the account does not have yet, then signs out anyway on request', async () => {
    const onSignOut = vi
      .fn<(force: boolean) => Promise<'done' | 'unsaved'>>()
      .mockResolvedValueOnce('unsaved')
      .mockResolvedValueOnce('done')
    render(
      <AccountDialog
        account={AL}
        onChange={vi.fn()}
        onSignOut={onSignOut}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /hasn’t been saved to your account/,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sign out anyway' }))
    await waitFor(() => expect(onSignOut).toHaveBeenLastCalledWith(true))
  })

  it('points a "username is taken" at Sign in (a retry after a hiccup)', async () => {
    api.register.mockResolvedValue({
      ok: false,
      error: 'that username is taken',
      status: 409,
    })
    render(
      <AccountDialog account={null} onChange={vi.fn()} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    type(/^Username/, 'spicy_al')
    type(/^Password/, 'correct horse')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That username is taken. If it’s yours, use Sign in instead.',
    )
  })

  it('changes the password: current one, a new one of 8+, then a confirmation', async () => {
    api.changePassword.mockResolvedValueOnce({
      ok: false,
      error: 'wrong password',
      status: 401,
    })
    render(<AccountDialog account={AL} onChange={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    type(/^Current password/, 'temp-pass-word')
    type(/^New password/, 'short')
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 8/)
    expect(api.changePassword).not.toHaveBeenCalled()

    type(/^New password/, 'a much better one')
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Wrong password.',
    )

    api.changePassword.mockResolvedValueOnce({ ok: true, ...AL })
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect((await screen.findByRole('status')).textContent).toMatch(
      /Password changed/,
    )
    expect(api.changePassword).toHaveBeenLastCalledWith(
      AL,
      'temp-pass-word',
      'a much better one',
    )
    // The form closes and the fields are not left holding passwords.
    expect(screen.queryByLabelText(/^New password/)).toBeNull()
  })

  it('closes on back and on Escape', () => {
    const onClose = vi.fn()
    render(<AccountDialog account={AL} onChange={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
