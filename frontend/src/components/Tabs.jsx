import React from 'react'

// Minimal tab switcher. tabs: [{ id, label }].
function Tabs({ tabs, activeId, onChange }) {
  return (
    <div className="tabs-row" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          className={'tab-button' + (tab.id === activeId ? ' active' : '')}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export default Tabs
