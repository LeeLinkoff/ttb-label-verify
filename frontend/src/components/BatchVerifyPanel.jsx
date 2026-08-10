import React, { useState } from 'react'
import ImageDropzone from './ImageDropzone'
import ApplicationDataForm from './ApplicationDataForm'
import BatchResultsTable from './BatchResultsTable'
import ErrorMessage from './ErrorMessage'
import { verifyBatch } from '../api/client'

const EMPTY_APPLICATION = {
  brandName: '',
  classType: '',
  alcoholContent: '',
  netContents: '',
  producerName: '',
  producerAddress: '',
  countryOfOrigin: ''
}

// Each batch item pairs one uploaded file with its own application
// data, entered inline per row, since /api/verify/batch matches
// labelImages[] to the applications array strictly by position, not
// by filename.
function BatchVerifyPanel() {
  const [items, setItems] = useState([]) // [{ file, applicationData }]
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)

  const handleFilesSelected = (selected) => {
    setItems((prev) => [
      ...prev,
      ...selected.map((file) => ({ file, applicationData: { ...EMPTY_APPLICATION } }))
    ])
    setResults(null)
    setError(null)
  }

  const handleRemove = (index) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleItemDataChange = (index, newData) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, applicationData: newData } : item))
    )
  }

  const handleSubmit = async () => {
    if (items.length === 0) return
    setSubmitting(true)
    setResults(null)
    setError(null)
    try {
      const data = await verifyBatch(items)
      setResults(data.results)
    } catch (err) {
      setError({ message: 'Batch verification failed.', details: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card">
      <div className="card-title">Batch Label Verification</div>

      <ImageDropzone
        files={items.map((item) => item.file)}
        onFilesSelected={handleFilesSelected}
        onRemove={handleRemove}
        multiple={true}
      />

      {items.length > 0 && (
        <div className="batch-items-list">
          {items.map((item, index) => (
            <div key={`${item.file.name}-${index}`} className="batch-item-row">
              <div className="batch-item-filename">{item.file.name}</div>
              <ApplicationDataForm
                value={item.applicationData}
                onChange={(newData) => handleItemDataChange(index, newData)}
                idPrefix={`batch-${index}-`}
              />
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn-primary"
        style={{ marginTop: 16 }}
        disabled={items.length === 0 || submitting}
        onClick={handleSubmit}
      >
        {submitting
          ? 'Verifying...'
          : `Verify ${items.length || ''} Label${items.length === 1 ? '' : 's'}`}
      </button>

      {error && (
        <div style={{ marginTop: 16 }}>
          <ErrorMessage message={error.message} details={error.details} />
        </div>
      )}

      {results && (
        <div style={{ marginTop: 16 }}>
          <BatchResultsTable results={results} fileNames={items.map((item) => item.file.name)} />
        </div>
      )}
    </div>
  )
}

export default BatchVerifyPanel
