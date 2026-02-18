import React from 'react'
import Login from './Login'
import Protected from './Protected'

function App() {
  const [token, setToken] = React.useState(() => localStorage.getItem('token'))
  const [authNotice, setAuthNotice] = React.useState('')
  const isAuthenticated = Boolean(token)

  const heroMetrics = React.useMemo(() => ([
    { label: 'Nodes Online', value: isAuthenticated ? '04' : '00' },
    { label: 'Atmos Cells', value: '128' },
    { label: 'Latency', value: isAuthenticated ? '12ms' : '—' }
  ]), [isAuthenticated])

  const systemCards = React.useMemo(() => ([
    {
      title: 'Propagation Mesh',
      detail: 'Geo-climate uplinks',
      status: isAuthenticated ? 'Optimal' : 'Standby',
      tone: isAuthenticated ? 'good' : 'neutral'
    },
    {
      title: 'Security Shield',
      detail: 'Quantum tunnel cipher',
      status: isAuthenticated ? 'Encrypted' : 'Awaiting key',
      tone: isAuthenticated ? 'good' : 'warn'
    },
    {
      title: 'Telemetry Feed',
      detail: 'Atmos sync stream',
      status: 'Live',
      tone: 'info'
    }
  ]), [isAuthenticated])

  const statusCopy = isAuthenticated ? 'Secure uplink established' : 'Awaiting authentication handshake'
  const brandYear = new Date().getFullYear()

  const onLogin = React.useCallback((newToken) => {
    localStorage.setItem('token', newToken)
    setToken(newToken)
    setAuthNotice('')
  }, [])

  const onLogout = React.useCallback((reason) => {
    localStorage.removeItem('token')
    setToken(null)
    if (reason) {
      setAuthNotice(reason)
    }
  }, [])

  return (
    <div className="app-shell">
      <div className="grid-overlay" aria-hidden="true" />
      <div className="scanlines" aria-hidden="true" />
      <div className="orb orb-left" aria-hidden="true" />
      <div className="orb orb-right" aria-hidden="true" />

      <nav className="command-bar">
        <div className="command-brand">
          <span className="brand-pill">Hyperion · IX</span>
          <strong>Atmos Suite</strong>
        </div>
        <div className="command-meta">
          <span className={`command-chip ${isAuthenticated ? 'success' : 'idle'}`}>
            {isAuthenticated ? 'Shielded uplink' : 'Link dormant'}
          </span>
          <span className="command-chip ghost">Build {brandYear}</span>
        </div>
      </nav>

      <header className="hero">
        <p className="hero-kicker">Hyperion Atmos Suite</p>
        <h1>Atmospheric Orchestration Console</h1>
        <p className="hero-sub">
          Manage distributed climate cells and ESP32 uplinks through a hardened control surface designed for modern labs.
        </p>
        <div className="hero-metrics">
          {heroMetrics.map((metric) => (
            <div key={metric.label} className="metric-chip">
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
        <div className="hero-status">
          <span className={`status-dot ${isAuthenticated ? 'online' : 'offline'}`} />
          <span>{statusCopy}</span>
        </div>
      </header>

      <section className="systems-rail">
        {systemCards.map((card) => (
          <article key={card.title} className={`systems-card tone-${card.tone}`}>
            <p className="systems-label">{card.detail}</p>
            <h4>{card.title}</h4>
            <span className="systems-status">{card.status}</span>
          </article>
        ))}
      </section>

      <main className="content-deck">
        {!isAuthenticated ? (
          <Login onLogin={onLogin} notice={authNotice} />
        ) : (
          <Protected token={token} onLogout={onLogout} />
        )}
      </main>
    </div>
  )
}

export default App
