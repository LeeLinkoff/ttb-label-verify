import React from 'react'
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'

const FIELD_LABELS = {
  brandName: 'Brand Name',
  classType: 'Class / Type',
  alcoholContent: 'Alcohol Content',
  netContents: 'Net Contents',
  producerName: 'Producer / Bottler Name',
  producerAddress: 'Producer / Bottler Address',
  countryOfOrigin: 'Country of Origin',
  warningStatement: 'Government Warning'
}

// Renders a MatchResult (services/matching.ts's MatchResult shape):
// { overallMatch, fields: { [key]: { match, extracted, applied, needsReview } } }
function MatchResultCard({ result }) {
  const fieldEntries = Object.entries(result.fields || {})
  const anyNeedsReview = fieldEntries.some(([, field]) => field.needsReview)

  return (
    <div className="match-result">
      <div
        className={
          'match-banner ' +
          (result.overallMatch ? 'ok' : anyNeedsReview ? 'review' : 'error')
        }
      >
        {result.overallMatch ? (
          <CheckCircle2 size={18} />
        ) : anyNeedsReview ? (
          <AlertTriangle size={18} />
        ) : (
          <XCircle size={18} />
        )}
        <span>
          {result.overallMatch
            ? 'All fields match'
            : anyNeedsReview
            ? 'Needs human review'
            : 'Mismatch found'}
        </span>
      </div>

      <table className="match-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Extracted</th>
            <th>Applied</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {fieldEntries.map(([key, field]) => (
            <tr key={key}>
              <td>{FIELD_LABELS[key] || key}</td>
              <td className="mono-cell">{field.extracted || 'None'}</td>
              <td className="mono-cell">{field.applied || 'None'}</td>
              <td>
                {field.match ? (
                  <CheckCircle2 size={16} className="status-icon ok" />
                ) : field.needsReview ? (
                  <AlertTriangle size={16} className="status-icon review" />
                ) : (
                  <XCircle size={16} className="status-icon error" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default MatchResultCard
