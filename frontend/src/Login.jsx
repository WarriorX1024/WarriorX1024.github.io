import React from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_BASE || ''

export default function Login({ onLogin, notice }) {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await axios.post(`${API}/api/login`, { email, password })
      if (res.data?.token) {
        onLogin(res.data.token)
      } else {
        setError('Unexpected response from server')
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await axios.post(`${API}/api/register`, { email, password })
      if (res.data?.token) {
        onLogin(res.data.token)
      } else {
        setError('Unexpected response from server')
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Register failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="panel login-panel">
      <div className="neon-card login-card">
        <div className="card-header">
          <p className="eyebrow">Deck Access · Level 03</p>
          <h2>Authenticate Operator</h2>
          <p className="muted">Generate a secure uplink key to enter the orchestration console.</p>
        </div>

        <form className="form-grid" onSubmit={handleLogin}>
          <label className="form-label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="pilot@hyperion.io"
            required
          />

          <label className="form-label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />

          {notice && <div className="alert alert-info">{notice}</div>}
          {error && <div className="alert alert-error">{error}</div>}

          <div className="button-row">
            <button className="button-base solid-button" type="submit" disabled={loading}>
              {loading ? 'Establishing link…' : 'Initiate Login'}
            </button>
            <button className="button-base outline-button" type="button" disabled={loading} onClick={handleRegister}>
              {loading ? 'Provisioning…' : 'Create Access' }
            </button>
          </div>
        </form>
      </div>

      <div className="glass-card login-aside">
        <h3>Mission Briefing</h3>
        <p>Use sandbox credentials to explore the console without touching production nodes.</p>
        <div className="credentials">
          <div>
            <span>Demo email</span>
            <strong>test@example.com</strong>
          </div>
          <div>
            <span>Passphrase</span>
            <strong>password123</strong>
          </div>
        </div>
        <p className="muted">
          Accounts auto-expire every session. Provision your own key via the registration channel for persistent work.
        </p>
      </div>
    </section>
  )
}
