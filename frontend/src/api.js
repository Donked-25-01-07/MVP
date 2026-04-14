const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const MEDIA_BASE = (API_BASE || '').replace(/\/api\/?$/i, '')

export async function api(path, { token, method = 'GET', body, isForm = false } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body && !isForm) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.detail || `Request failed (${response.status})`)
  }
  if (response.status === 204) return null
  return response.json()
}

export function resolveMediaUrl(path) {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  return `${MEDIA_BASE}${path}`
}
