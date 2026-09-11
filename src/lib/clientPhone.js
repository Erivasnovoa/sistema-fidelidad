import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from './firebase'
import { normalizeClientPhone } from './phone'

export { normalizeClientPhone }

/**
 * Busca si ya existe un cliente con ese teléfono (exacto o mismo número normalizado).
 * Retorna el cliente encontrado o null.
 */
export const findClienteByTelefono = async (telefonoInput) => {
  const raw = String(telefonoInput ?? '').trim()
  const normalized = normalizeClientPhone(raw)

  if (!normalized) return null

  const clientesRef = collection(db, 'clientes')
  const candidatos = [...new Set([raw, normalized].filter(Boolean))]

  for (const candidato of candidatos) {
    const snapshot = await getDocs(query(clientesRef, where('telefono', '==', candidato)))
    if (!snapshot.empty) {
      const clienteDoc = snapshot.docs[0]
      return { id: clienteDoc.id, ...clienteDoc.data() }
    }
  }

  // Respaldo: formatos legados (espacios, guiones, etc.).
  const allSnap = await getDocs(clientesRef)
  const match = allSnap.docs.find(
    (clienteDoc) => normalizeClientPhone(clienteDoc.data()?.telefono) === normalized,
  )

  return match ? { id: match.id, ...match.data() } : null
}

export const MSG_TELEFONO_YA_REGISTRADO =
  'Ese número ya fue registrado. Inicia sesión con tu teléfono y contraseña.'

export const MSG_TELEFONO_YA_REGISTRADO_ADMIN =
  'Ese número ya fue registrado. No se puede crear otra cuenta con el mismo teléfono.'
