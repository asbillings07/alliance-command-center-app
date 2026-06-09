'use client'

import { useActionState } from 'react'
import { login, type LoginState } from './actions'

const initialState: LoginState = { error: null }

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(login, initialState)

  return (
    <main className="flex items-center justify-center min-h-screen">
      <section className="flex flex-col gap-4 p-4 bg-gray rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-center">Alliance Command Center</h1>

        {state.error && <p className="text-red-500 text-sm">{state.error}</p>}

        <form className="flex flex-col gap-2" action={formAction}>
          <input
            className="p-2 border border-gray-300 rounded-md"
            name="email"
            type="email"
            required
            disabled={isPending}
            autoComplete="email"
            aria-label="Email"
            placeholder="Email"
          />
          <input
            className="p-2 border border-gray-300 rounded-md"
            name="password"
            type="password"
            required
            disabled={isPending}
            autoComplete="password"
            aria-label="Password"
            placeholder="Password"
          />

          <button className="p-2 bg-blue-500 text-white rounded-md" type="submit" disabled={isPending}>
            {isPending ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </section>
    </main>
  )
}