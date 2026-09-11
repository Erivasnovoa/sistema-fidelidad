export const callClientApi = async (action, payload = {}) => {
  const response = await fetch('/api/client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || 'No se pudo completar la solicitud.')
  }

  return data
}
