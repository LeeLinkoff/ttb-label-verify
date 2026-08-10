import React, { useState } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import MatchResultCard from './MatchResultCard'
import ErrorMessage from './ErrorMessage'

// Renders the results array from POST /api/verify/batch:
// [{ index, ok, result?, error? }]. fileNames is the client-side
// list of original file names in upload order, the backend only
// returns index, not filenames, so the UI supplies that mapping.
function BatchResultsTable({ results, fileNames }) {
  const [expandedIndex, setExpandedIndex] = useState(null)

  return (
    <table className="batch-table">
      <thead>
        <tr>
          <th></th>
          <th>File</th>
          <th>Status</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {results.map((item) => {
          const isExpanded = expandedIndex === item.index
          return (
            <React.Fragment key={item.index}>
              <tr
                className="batch-row"
                onClick={() => setExpandedIndex(isExpanded ? null : item.index)}
              >
                <td>
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </td>
                <td>{fileNames[item.index] || `Item ${item.index + 1}`}</td>
                <td>
                  {!item.ok ? (
                    <XCircle size={16} className="status-icon error" />
                  ) : item.result?.overallMatch ? (
                    <CheckCircle2 size={16} className="status-icon ok" />
                  ) : (
                    <AlertTriangle size={16} className="status-icon review" />
                  )}
                </td>
                <td>
                  {item.ok
                    ? item.result?.overallMatch
                      ? 'All fields match'
                      : 'Needs review / mismatch'
                    : 'Failed'}
                </td>
              </tr>
              {isExpanded && (
                <tr className="batch-detail-row">
                  <td colSpan={4}>
                    {item.ok ? (
                      <MatchResultCard result={item.result} />
                    ) : (
                      <ErrorMessage
                        message="This label could not be processed."
                        details={item.error}
                      />
                    )}
                  </td>
                </tr>
              )}
            </React.Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

export default BatchResultsTable
