import React, { useState } from 'react'
import ImageDropzone from './ImageDropzone'
import ApplicationDataForm from './ApplicationDataForm'
import MatchResultCard from './MatchResultCard'
import ErrorMessage from './ErrorMessage'
import { verifyLabel } from '../api/client'

const EMPTY_APPLICATION = {
  brandName: '',
  classType: '',
  alcoholContent: '',
  netContents: ''
}

function SingleVerifyPanel() {
  const [files, setFiles] = useState([])
  const [applicationData, setApplicationData] = useState(EMPTY_APPLICATION)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleFilesSelected = (selected) => {
    setFiles([selected[0]]) // single mode: newest selection replaces any prior one
    setResult(null)
    setError(null)
  }

  const handleRemove = () => {
    setFiles([])
    setResult(null)
  }

  const handleSubmit = async () => {
    if (files.length === 0) return
    setSubmitting(true)
    setResult(null)
    setError(null)
    try {
      const data = await verifyLabel(files[0], applicationData)
      setResult(data)
    } catch (err) {
      setError({ message: 'Verification failed.', details: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card">
      <div className="card-title">Single Label Verification</div>

      <ImageDropzone
        files={files}
        onFilesSelected={handleFilesSelected}
        onRemove={handleRemove}
        multiple={false}
      />

      <div style={{ marginTop: 16 }}>
        <ApplicationDataForm
          value={applicationData}
          onChange={setApplicationData}
          idPrefix="single-"
        />
      </div>

      <button
        type="button"
        className="btn-primary"
        style={{ marginTop: 16 }}
        disabled={files.length === 0 || submitting}
        onClick={handleSubmit}
      >
        {submitting ? 'Verifying...' : 'Verify Label'}
      </button>

      {error && (
        <div style={{ marginTop: 16 }}>
          <ErrorMessage message={error.message} details={error.details} />
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          <MatchResultCard result={result} />
        </div>
      )}
    </div>
  )
}

export default SingleVerifyPanel
