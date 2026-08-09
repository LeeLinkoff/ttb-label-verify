import React, { useState } from 'react'

// Generic, reusable error display: a plain-language message up front,
// with the real error (message, status code, raw response body,
// whatever the caller has) tucked behind a "Details" toggle. Used
// anywhere a request can fail (health check, and later label upload /
// verify / batch), so the user isn't shown a raw stack trace by
// default but can still get it when they need to report a bug.
//
// `details` accepts a string OR an object; objects are pretty-printed
// as JSON so callers can pass a whole error/response payload without
// stringifying it themselves.
function ErrorMessage({ message, details }) {
  const [showDetails, setShowDetails] = useState(false)

  const detailsText =
    typeof details === 'string'
      ? details
      : details
      ? JSON.stringify(details, null, 2)
      : null

  return (
    <div className="error-message">
      <div className="error-message-row">
        <span>{message}</span>
        {detailsText && (
          <button
            type="button"
            className="btn-details"
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? 'Hide details' : 'Details'}
          </button>
        )}
      </div>
      {showDetails && detailsText && (
        <pre className="error-details">{detailsText}</pre>
      )}
    </div>
  )
}

export default ErrorMessage
