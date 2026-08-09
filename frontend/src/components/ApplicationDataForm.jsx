import React from 'react'

const FIELDS = [
  { key: 'brandName', label: 'Brand Name' },
  { key: 'classType', label: 'Class / Type' },
  { key: 'alcoholContent', label: 'Alcohol Content' },
  { key: 'netContents', label: 'Net Contents' }
]

// Controlled form for the four application fields a label gets
// matched against. value/onChange follow the ApplicationData shape
// the backend expects (services/matching.ts). idPrefix keeps input
// ids unique when multiple copies of this form render at once (the
// batch tab renders one per row).
function ApplicationDataForm({ value, onChange, idPrefix = '' }) {
  const handleFieldChange = (key, fieldValue) => {
    onChange({ ...value, [key]: fieldValue })
  }

  return (
    <div className="app-data-form">
      {FIELDS.map(({ key, label }) => (
        <div key={key} className="form-field">
          <label htmlFor={`${idPrefix}${key}`}>{label}</label>
          <input
            id={`${idPrefix}${key}`}
            type="text"
            value={value[key] || ''}
            onChange={(e) => handleFieldChange(key, e.target.value)}
            placeholder={label}
          />
        </div>
      ))}
    </div>
  )
}

export default ApplicationDataForm
