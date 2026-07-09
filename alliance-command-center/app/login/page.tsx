'use client'

import { useActionState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { login, type LoginState } from './actions'

const initialState: LoginState = { error: null }

export default function LoginPage() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/app'
  const [state, formAction, isPending] = useActionState(login, initialState)

  return (
    <main className="flex items-center justify-center min-h-screen">
      <section className="flex flex-col gap-4 p-4 bg-white rounded-lg shadow-md max-w-md w-full">
        <h1 className="text-2xl font-bold text-center text-gray-800">Alliance Command Center</h1>

        {state.error && <p className="text-red-500 text-sm">{state.error}</p>}

        <form className="flex flex-col gap-2 w-full rounded-md border border-gray-300 p-4" action={formAction}>
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <input
            className="p-2 border border-gray-300 rounded-md text-gray-800"
            name="email"
            type="email"
            required
            disabled={isPending}
            autoComplete="email"
            aria-label="Email"
            placeholder="Email"
          />
          <input
            className="p-2 border border-gray-300 rounded-md text-gray-800"
            name="password"
            type="password"
            required
            disabled={isPending}
            autoComplete="current-password"
            aria-label="Password"
            placeholder="Password"
          />

          <button className="p-2 bg-blue-500 text-white w-full rounded-md" type="submit" disabled={isPending}>
            {isPending ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-gray-200">
          <p className="text-sm text-gray-600">
            Have an invitation code?{' '}
            <Link href="/invite" className="text-blue-500 hover:text-blue-700">
              Enter it here
            </Link>
          </p>
        </div>
      </section>
    </main>
  )
}