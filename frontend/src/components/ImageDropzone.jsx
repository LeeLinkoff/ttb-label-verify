import React, { useRef } from 'react'
import { Upload, X } from 'lucide-react'

// File picker for label images. The parent owns the actual file
// list (files prop), this component only reports selection/removal
// events, staying a controlled input like the rest of the form
// pieces here. multiple=false still expects the parent to replace
// rather than append on selection.
function ImageDropzone({ files, onFilesSelected, onRemove, multiple = false, label }) {
  const inputRef = useRef(null)

  const handleChange = (e) => {
    const selected = Array.from(e.target.files || [])
    if (selected.length > 0) onFilesSelected(selected)
    e.target.value = '' // allow re-selecting the same file name
  }

  return (
    <div className="dropzone-wrap">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        className="dropzone-button"
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={16} />
        {label || (multiple ? 'Add label images' : 'Choose label image')}
      </button>

      {files.length > 0 && (
        <ul className="file-list">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="file-list-item">
              <span className="file-list-name">{file.name}</span>
              <button
                type="button"
                className="file-remove-btn"
                onClick={() => onRemove(i)}
                aria-label={`Remove ${file.name}`}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ImageDropzone
