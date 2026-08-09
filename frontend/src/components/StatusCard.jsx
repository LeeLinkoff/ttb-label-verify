import React, { useState } from 'react'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

// Backend status card. Shows a single check/x (or a spinner while the
// request is in flight) rather than the raw JSON, since that's the
// only thing a non-technical user needs at a glance. The actual
// response (or error) is available behind "Technical Details" for
// anyone who wants it, without cluttering the default view.
//
// status: 'checking' | 'ok' | 'error'
// health: the parsed /api/health response body, when status === 'ok'
// error: { message, details } when status === 'error'
function StatusCard({ status, health, error }) {
  const [showDetails, setShowDetails] = useState(false)

  const detailsText =
    status === 'ok'
      ? JSON.stringify(health, null, 2)
      : status === 'error'
      ? error?.details || error?.message || 'No further details available.'
      : null

  return (
    <div className="card">
      <div className="card-title">Backend Status</div>

      <div className="status-row">
        {status === 'checking' && (
          <Loader2 size={20} className="status-icon spin" />
        )}
        {status === 'ok' && (
          <CheckCircle2 size={20} className="status-icon ok" />
        )}
        {status === 'error' && (
          <XCircle size={20} className="status-icon error" />
        )}

        <span>
          {status === 'checking' && 'Checking backend...'}
          {status === 'ok' && 'Backend is online'}
          {status === 'error' && 'Backend is unreachable'}
        </span>

        {detailsText && (
          <button
            type="button"
            className="btn-details"
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? 'Hide Technical Details' : 'Technical Details'}
          </button>
        )}
      </div>

      {showDetails && detailsText && (
        <pre className="error-details">{detailsText}</pre>
      )}
    </div>
  )
}

export default StatusCard
