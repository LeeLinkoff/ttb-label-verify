// api/client.js
//
// All backend communication lives here, not scattered across
// components. Every path is built from API_BASE (BASE_URL + 'api'),
// not hardcoded, since this app is deployed under
// /mvps/label-verify/, not the domain root, see App.jsx for the full
// reasoning on why that matters.

const API_BASE = `${import.meta.env.BASE_URL}api`

async function readErrorBody(res) {
  try {
    const data = await res.json()
    return data.error || JSON.stringify(data)
  } catch {
    try {
      return await res.text()
    } catch {
      return `HTTP ${res.status}`
    }
  }
}

export async function checkHealth() {
  const res = await fetch(`${API_BASE}/health`)
  if (!res.ok) {
    throw new Error(`Health check returned ${res.status}: ${await readErrorBody(res)}`)
  }
  return res.json()
}

// Single-label verify. applicationData: { brandName, classType,
// alcoholContent, netContents }, matches services/matching.ts's
// ApplicationData shape. Empty fields are omitted rather than sent
// as empty strings, so the backend's own defaults apply.
export async function verifyLabel(file, applicationData) {
  const form = new FormData()
  form.append('labelImage', file)
  Object.entries(applicationData).forEach(([key, value]) => {
    if (value) form.append(key, value)
  })

  const res = await fetch(`${API_BASE}/verify`, {
    method: 'POST',
    body: form
  })

  if (!res.ok) {
    throw new Error(await readErrorBody(res))
  }
  return res.json()
}

// Batch verify. items: [{ file, applicationData }]. The backend
// matches labelImages[] to the applications JSON array strictly by
// position, so item order here has to match the order both are
// appended in.
export async function verifyBatch(items) {
  const form = new FormData()
  items.forEach(({ file }) => form.append('labelImages', file))
  form.append('applications', JSON.stringify(items.map((item) => item.applicationData)))

  const res = await fetch(`${API_BASE}/verify/batch`, {
    method: 'POST',
    body: form
  })

  if (!res.ok) {
    throw new Error(await readErrorBody(res))
  }
  return res.json()
}
