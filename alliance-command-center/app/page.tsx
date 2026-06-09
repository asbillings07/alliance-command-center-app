import { login } from './src/auth'

export default function LoginPage() {
  return (
    <main>
      <section>
        <h1>Alliance Command Center</h1>

        <form action={login}>
          <input
            type="email"
            placeholder="Email"
          />

          <input
            type="password"
            placeholder="Password"
          />

          <button type="submit">
            Sign In
          </button>
        </form>
      </section>
    </main>
  )
}