const MIN_PASSWORD_LENGTH = 4

export const MIN_CLIENT_PASSWORD_LENGTH = MIN_PASSWORD_LENGTH

/** Normaliza la contraseña del cliente (sin espacios extremos). */
export const normalizeClientPassword = (value) => String(value ?? '').trim()

export const validateClientPassword = (value) => {
  const password = normalizeClientPassword(value)

  if (!password) {
    return { ok: false, password: '', error: 'Ingresa una contraseña.' }
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      password: '',
      error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    }
  }

  return { ok: true, password, error: '' }
}

/** Hash SHA-256 en hex (Web Crypto). No guarda la contraseña en texto plano. */
export const hashClientPassword = async (password) => {
  const normalized = normalizeClientPassword(password)
  const data = new TextEncoder().encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const verifyClientPassword = async (password, storedHash) => {
  if (!storedHash) return false
  const incomingHash = await hashClientPassword(password)
  return incomingHash === storedHash
}

/** Quita la contraseña del objeto en memoria (UI / estado). */
export const stripClientPassword = (clienteData = {}) => {
  if (!clienteData || typeof clienteData !== 'object') return clienteData

  const {
    contraseña: _contraseña,
    contraseñaHash: _contraseñaHash,
    ...safeData
  } = clienteData

  return safeData
}
