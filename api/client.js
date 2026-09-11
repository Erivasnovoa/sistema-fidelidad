/* global process, Buffer */
import crypto from 'node:crypto'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const SESSION_COOKIE = 'fidelidad_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 12
const MIN_PASSWORD_LENGTH = 4

const getAdminDb = () => {
  if (!getApps().length) {
    const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    if (!rawCredentials) {
      throw new Error('Falta configurar FIREBASE_SERVICE_ACCOUNT_JSON.')
    }

    initializeApp({ credential: cert(JSON.parse(rawCredentials)) })
  }

  return getFirestore()
}

const json = (response, status, body) => {
  response.status(status).json(body)
}

const normalizePhone = (value) => String(value ?? '').replace(/\D/g, '')
const normalizePassword = (value) => String(value ?? '').trim()
const passwordHash = (password) => crypto.createHash('sha256').update(password).digest('hex')

const safeClient = (client) => {
  const safe = { ...(client || {}) }
  delete safe.contraseña
  delete safe.contraseñaHash
  return safe
}

const getCookie = (request, name) => {
  const cookieHeader = request.headers.cookie || ''
  const prefix = `${name}=`
  return cookieHeader.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(prefix))?.slice(prefix.length) || null
}

const signSession = (payload) => {
  const secret = process.env.CLIENT_SESSION_SECRET
  if (!secret) throw new Error('Falta configurar CLIENT_SESSION_SECRET.')

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

const readSession = (request) => {
  const token = getCookie(request, SESSION_COOKIE)
  const secret = process.env.CLIENT_SESSION_SECRET
  if (!token || !secret) return null

  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) return null

  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null
  }

  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    return data?.clientId && data.exp > Date.now() ? data : null
  } catch {
    return null
  }
}

const setSession = (response, clientId) => {
  const expiresAt = Date.now() + SESSION_TTL_MS
  const value = signSession({ clientId, exp: expiresAt })
  response.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${value}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ].join('; '))
}

const clearSession = (response) => {
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`)
}

const getConfig = async (db) => {
  const snapshot = await db.collection('configuracionPremios').doc('reglas').get()
  const data = snapshot.exists ? snapshot.data() : {}
  return {
    reglas: Array.isArray(data.reglas) ? data.reglas : [],
    niveles: Array.isArray(data.niveles) ? data.niveles : null,
    montoPorPunto: Number(data.montoPorPunto) || 1000,
  }
}

const findClientByPhone = async (db, phone) => {
  const normalized = normalizePhone(phone)
  if (!normalized) return null

  const candidates = [...new Set([String(phone ?? '').trim(), normalized].filter(Boolean))]
  for (const candidate of candidates) {
    const result = await db.collection('clientes').where('telefono', '==', candidate).limit(1).get()
    if (!result.empty) return { id: result.docs[0].id, ...result.docs[0].data() }
  }

  // Compatibilidad con teléfonos legados con espacios o guiones.
  const all = await db.collection('clientes').get()
  const match = all.docs.find((doc) => normalizePhone(doc.data().telefono) === normalized)
  return match ? { id: match.id, ...match.data() } : null
}

const requireClient = async (request, db) => {
  const session = readSession(request)
  if (!session) return null

  const snapshot = await db.collection('clientes').doc(session.clientId).get()
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null
}

const pendingRequestsForClient = async (db, clientId) => {
  const snapshot = await db.collection('solicitudesCanje').where('clienteId', '==', clientId).get()
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((request) => request.status === 'pendiente')
}

const levelFor = (points, levels) => {
  const sorted = [...levels].sort((a, b) => Number(a.puntosMinimos) - Number(b.puntosMinimos))
  return sorted.filter((level) => Number(points) >= Number(level.puntosMinimos)).at(-1) || null
}

const defaultLevels = [
  { id: 'bronce', nombre: 'Bronce', puntosMinimos: 10 },
  { id: 'plata', nombre: 'Plata', puntosMinimos: 30 },
  { id: 'oro', nombre: 'Oro', puntosMinimos: 50 },
]

const handleRedeem = async (request, response, db, body) => {
  const client = await requireClient(request, db)
  if (!client) return json(response, 401, { error: 'Tu sesión venció. Inicia sesión de nuevo.' })

  const config = await getConfig(db)
  const levels = config.niveles || defaultLevels
  const now = new Date().toISOString()
  const prizes = Array.isArray(client.premios) ? client.premios : []
  const claimedLevels = new Set(prizes.filter((item) => item.status === 'canjeado').map((item) => item.nivelId))
  const pendingRequests = await pendingRequestsForClient(db, client.id)
  let requestData
  let nextPrizes = prizes

  if (body.origen === 'asignado') {
    const prize = prizes.find((item) => item.id === body.premioId)
    if (!prize || prize.status !== 'pendiente') {
      return json(response, 400, { error: 'Este premio no está disponible para canje.' })
    }
    if (claimedLevels.has(prize.nivelId)) {
      return json(response, 400, { error: 'Ya canjeaste un premio de este nivel.' })
    }
    const requestRef = db.collection('solicitudesCanje').doc()
    nextPrizes = prizes.map((item) => item.id === prize.id
      ? { ...item, status: 'en_solicitud', solicitudCanjeId: requestRef.id }
      : item)
    requestData = {
      clienteId: client.id,
      clienteNombre: client.nombre || 'Cliente',
      premioId: prize.id,
      premioNombre: prize.nombre,
      puntosCosto: 0,
      nivelId: prize.nivelId || 'bronce',
      origen: 'asignado',
      fecha: now,
      status: 'pendiente',
    }
    await db.runTransaction(async (transaction) => {
      transaction.set(requestRef, requestData)
      transaction.update(db.collection('clientes').doc(client.id), { premios: nextPrizes })
    })
  } else {
    const rule = config.reglas.find((item) => item.id === body.premioId)
    const clientLevel = levelFor(client.puntos || 0, levels)
    if (!rule || !clientLevel || Number(clientLevel.puntosMinimos) < Number(levels.find((item) => item.id === rule.nivelId)?.puntosMinimos)) {
      return json(response, 400, { error: 'Aún no alcanzas el nivel requerido para este premio.' })
    }
    if (claimedLevels.has(rule.nivelId)) {
      return json(response, 400, { error: 'Ya canjeaste el premio de este nivel.' })
    }
    const pendingSamePrize = pendingRequests.some((item) => (
      item.origen === 'catalogo'
      && (item.premioId === rule.id || item.premioCatalogoId === rule.id)
    ))
    if (pendingSamePrize) {
      return json(response, 400, { error: 'Ya tienes una solicitud pendiente para este premio.' })
    }
    const pendingSameLevel = pendingRequests.some((item) => item.nivelId === rule.nivelId)
    if (pendingSameLevel) {
      return json(response, 400, { error: 'Ya tienes una solicitud pendiente para este nivel.' })
    }
    const requestRef = db.collection('solicitudesCanje').doc()
    requestData = {
      clienteId: client.id,
      clienteNombre: client.nombre || 'Cliente',
      premioId: rule.id,
      premioCatalogoId: rule.id,
      premioNombre: rule.nombre,
      premioDescripcion: rule.descripcion || '',
      puntosCosto: 0,
      nivelId: rule.nivelId || 'bronce',
      origen: 'catalogo',
      fecha: now,
      status: 'pendiente',
    }
    await requestRef.set(requestData)
  }

  const updated = await db.collection('clientes').doc(client.id).get()
  return json(response, 200, {
    client: safeClient({ id: updated.id, ...updated.data() }),
    solicitudesPendientes: await pendingRequestsForClient(db, client.id),
  })
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return json(response, 405, { error: 'Método no permitido.' })
  }

  try {
    const db = getAdminDb()
    const body = request.body || {}

    if (body.action === 'config') return json(response, 200, await getConfig(db))

    if (body.action === 'logout') {
      clearSession(response)
      return json(response, 200, { ok: true })
    }

    if (body.action === 'session') {
      const client = await requireClient(request, db)
      if (!client) return json(response, 401, { error: 'Sin sesión.' })
      return json(response, 200, {
        client: safeClient(client),
        config: await getConfig(db),
        solicitudesPendientes: await pendingRequestsForClient(db, client.id),
      })
    }

    if (body.action === 'login') {
      const phone = normalizePhone(body.telefono)
      const password = normalizePassword(body.contraseña)
      if (!phone || password.length < MIN_PASSWORD_LENGTH) {
        return json(response, 400, { error: 'Teléfono o contraseña incorrectos.' })
      }
      const client = await findClientByPhone(db, phone)
      const stored = client?.contraseña || client?.contraseñaHash || ''
      const incoming = passwordHash(password)
      const valid = Boolean(client && stored && stored.length === incoming.length)
        && crypto.timingSafeEqual(Buffer.from(incoming), Buffer.from(stored))
      if (!valid) {
        return json(response, 401, { error: 'Teléfono o contraseña incorrectos.' })
      }
      setSession(response, client.id)
      return json(response, 200, { client: safeClient(client), config: await getConfig(db) })
    }

    if (body.action === 'register') {
      const nombre = String(body.nombre || '').trim()
      const telefono = normalizePhone(body.telefono)
      const contraseña = normalizePassword(body.contraseña)
      if (!nombre || !telefono || contraseña.length < MIN_PASSWORD_LENGTH) {
        return json(response, 400, { error: 'Completa nombre, teléfono y una contraseña de al menos 4 caracteres.' })
      }
      if (await findClientByPhone(db, telefono)) {
        return json(response, 409, { error: 'Ese número ya fue registrado. Inicia sesión con tu teléfono y contraseña.' })
      }
      const ref = await db.collection('clientes').add({
        nombre,
        telefono,
        contraseña: passwordHash(contraseña),
        puntos: 0,
        montoPendientePuntos: 0,
        estado: 'Activo',
        fechaUltimaCompra: new Date().toISOString(),
      })
      const client = { id: ref.id, nombre, telefono, puntos: 0, montoPendientePuntos: 0, estado: 'Activo' }
      setSession(response, ref.id)
      return json(response, 201, { client, config: await getConfig(db) })
    }

    if (body.action === 'updateProfile') {
      const client = await requireClient(request, db)
      if (!client) return json(response, 401, { error: 'Tu sesión venció. Inicia sesión de nuevo.' })
      const nombre = String(body.nombre || '').trim()
      const telefono = normalizePhone(body.telefono)
      const contraseña = normalizePassword(body.contraseña)
      if (!nombre || !telefono || (contraseña && contraseña.length < MIN_PASSWORD_LENGTH)) {
        return json(response, 400, { error: 'Revisa tu nombre, teléfono y contraseña.' })
      }
      const existing = await findClientByPhone(db, telefono)
      if (existing && existing.id !== client.id) {
        return json(response, 409, { error: 'Ese número ya fue registrado. Usa otro número.' })
      }
      const updates = { nombre, telefono }
      if (contraseña) updates.contraseña = passwordHash(contraseña)
      await db.collection('clientes').doc(client.id).update(updates)
      return json(response, 200, { client: safeClient({ ...client, ...updates }) })
    }

    if (body.action === 'redeem') return handleRedeem(request, response, db, body)

    return json(response, 400, { error: 'Acción no válida.' })
  } catch (error) {
    console.error(error)
    return json(response, 500, { error: 'No se pudo procesar la solicitud.' })
  }
}
