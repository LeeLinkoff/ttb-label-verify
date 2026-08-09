import React, { useEffect, useState } from 'react'
import './App.css'
import StatusCard from './components/StatusCard'
import Tabs from './components/Tabs'
import SingleVerifyPanel from './components/SingleVerifyPanel'
import BatchVerifyPanel from './components/BatchVerifyPanel'
import { checkHealth } from './api/client'

const TABS = [
  { id: 'single', label: 'Single Label' },
  { id: 'batch', label: 'Batch' }
]

function App() {
  const [health, setHealth] = useState(null)
  const [status, setStatus] = useState('checking') // 'checking' | 'ok' | 'error'
  const [healthError, setHealthError] = useState(null) // { message, details }
  const [activeTab, setActiveTab] = useState('single')

  useEffect(() => {
    checkHealth()
      .then((data) => {
        setHealth(data)
        setStatus('ok')
      })
      .catch((err) => {
        setHealthError({
          message: 'Could not reach the backend health check.',
          details: err.message
        })
        setStatus('error')
      })
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">TTB Label Verification</h1>
        <p className="app-subtitle">
          AI-powered alcohol label verification prototype
        </p>
      </header>

      <StatusCard status={status} health={health} error={healthError} />

      <Tabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {activeTab === 'single' && <SingleVerifyPanel />}
      {activeTab === 'batch' && <BatchVerifyPanel />}
    </div>
  )
}

export default App
