import React, { useEffect, useState } from 'react'
import './App.css'

// Skeleton app shell. Confirms the frontend can reach the backend
// (via /api/health) and links out to the Swagger docs. The actual
// label upload / matching UI is not built yet.

function App() {
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
        return res.json()
      })
      .then(setHealth)
      .catch((err) => setError(err.message))
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">TTB Label Verification</h1>
        <p className="app-subtitle">
          AI-powered alcohol label verification prototype (skeleton)
        </p>
      </header>

      <div className="card">
        <div className="card-title">Backend Status</div>
        <div className="status-row">
          <span
            className={
              'status-dot ' + (error ? 'error' : health ? 'ok' : '')
            }
          />
          {error && <span>Backend unreachable: {error}</span>}
          {!error && !health && <span>Checking...</span>}
          {!error && health && (
            <span>
              {health.service} is healthy as of{' '}
              {new Date(health.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title">API Docs</div>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 12 }}>
          Full endpoint reference, including planned (not-yet-built) endpoints,
          is documented in Swagger.
        </p>
        <a href="/api/docs" target="_blank" rel="noreferrer">
          <button className="btn-primary">Open API Docs</button>
        </a>
      </div>

      <div className="card">
        <div className="card-title">Next Up</div>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>
          Label upload, field extraction, and match results go here.
        </p>
      </div>
    </div>
  )
}

export default App
