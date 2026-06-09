'use client'

import { useActionState } from 'react'
import { login, type LoginState } from './actions'

const initialState: LoginState = { error: null }

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(login, initialState)

  return (
    <main>
      <section>
        <h1>Alliance Command Center and you&apos;re not logged in</h1>

        {state.error && <p style={{ color: 'red' }}>{state.error}</p>}

        <form action={formAction}>
          <input
            name="email"
            type="email"
            placeholder="Email"
          />

          <input
            name="password"
            type="password"
            placeholder="Password"
          />

          <button type="submit" disabled={isPending}>
            {isPending ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </section>
    </main>
  )
}