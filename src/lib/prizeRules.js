import { clienteAlcanzaNivel, obtenerNivelPorId } from './clientLevels'

export const DEFAULT_MONTO_POR_PUNTO = 1000

export const normalizeMontoPorPunto = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MONTO_POR_PUNTO
}

/**
 * Interpreta montos exactos de compra (₡ / $).
 * Acepta: 5000 | 5,000.50 | 5.000,50 | 5000.5
 */
export const parseMontoCompra = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  if (value === null || value === undefined) return 0

  let raw = String(value).trim().replace(/[^\d.,-]/g, '')
  if (!raw || raw === '-' || raw === '.' || raw === ',') return 0

  const hasComma = raw.includes(',')
  const hasDot = raw.includes('.')

  if (hasComma && hasDot) {
    // El separador decimal es el que aparece al final.
    if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
      raw = raw.replace(/\./g, '').replace(',', '.')
    } else {
      raw = raw.replace(/,/g, '')
    }
  } else if (hasComma) {
    const parts = raw.split(',')
    raw = parts.length === 2 && parts[1].length <= 2
      ? `${parts[0].replace(/\./g, '')}.${parts[1]}`
      : raw.replace(/,/g, '')
  } else if (hasDot) {
    const parts = raw.split('.')
    // "5.000" / "1.250.000" → miles; "5.5" → decimal
    raw = parts.length > 2 || (parts.length === 2 && parts[1].length === 3)
      ? raw.replace(/\./g, '')
      : raw
  }

  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export const normalizeMontoPendiente = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Suma el monto exacto de la compra + sobrante previo, asigna puntos enteros
 * y conserva el remanente para la siguiente compra.
 */
export const calcularAsignacionDesdeMonto = (
  montoCompra,
  montoPorPunto = DEFAULT_MONTO_POR_PUNTO,
  montoPendiente = 0,
) => {
  const compra = parseMontoCompra(montoCompra)
  const pendiente = normalizeMontoPendiente(montoPendiente)
  const valorPunto = normalizeMontoPorPunto(montoPorPunto)
  const totalAcumulado = compra + pendiente

  if (totalAcumulado <= 0) {
    return {
      montoCompra: 0,
      montoPendienteAnterior: pendiente,
      totalAcumulado: 0,
      puntos: 0,
      montoPendienteNuevo: pendiente,
      valorPunto,
    }
  }

  const puntos = Math.floor(totalAcumulado / valorPunto)
  const montoPendienteNuevo = Number((totalAcumulado - (puntos * valorPunto)).toFixed(2))

  return {
    montoCompra: compra,
    montoPendienteAnterior: pendiente,
    totalAcumulado: Number(totalAcumulado.toFixed(2)),
    puntos,
    montoPendienteNuevo,
    valorPunto,
  }
}

export const calcularPuntosDesdeMonto = (
  montoCompra,
  montoPorPunto = DEFAULT_MONTO_POR_PUNTO,
  montoPendiente = 0,
) => calcularAsignacionDesdeMonto(montoCompra, montoPorPunto, montoPendiente).puntos

const VALID_NIVEL_IDS = new Set(['bronce', 'plata', 'oro'])

export const normalizePrizeNivelId = (nivelId) => (
  VALID_NIVEL_IDS.has(nivelId) ? nivelId : 'bronce'
)

export const normalizePrizeRules = (rules = []) =>
  (rules || [])
    .filter((rule) => rule && rule.nombre && Number(rule.umbral) > 0 && Number(rule.puntosCosto) > 0)
    .map((rule) => ({
      id: rule.id || crypto.randomUUID(),
      nombre: rule.nombre,
      descripcion: rule.descripcion || 'Recompensa configurada por umbral de compra.',
      umbral: Number(rule.umbral),
      puntosCosto: Number(rule.puntosCosto),
      nivelId: normalizePrizeNivelId(rule.nivelId),
    }))

export const getAvailablePrizeRules = (
  rules = [],
  purchaseAmount = 0,
  { puntosCliente = null, levels = [] } = {},
) => {
  const normalized = normalizePrizeRules(rules)
  const purchaseValue = Number(purchaseAmount) || 0
  const evaluarNivel = puntosCliente !== null && puntosCliente !== undefined

  return normalized.map((rule) => {
    const unlockedByPurchase = purchaseValue >= rule.umbral
    const unlockedByLevel = evaluarNivel
      ? clienteAlcanzaNivel(puntosCliente, rule.nivelId, levels)
      : true

    return {
      ...rule,
      unlocked: unlockedByPurchase && unlockedByLevel,
      nivelAlcanzado: unlockedByLevel,
      nivelNombre: obtenerNivelPorId(rule.nivelId, levels).nombre,
    }
  })
}

export const PRIZE_EXPIRATION_DAYS = 30

export const STATUS_PENDIENTE = 'pendiente'
export const STATUS_EN_SOLICITUD = 'en_solicitud'
export const STATUS_CANJEADO = 'canjeado'
export const STATUS_VENCIDO = 'premio vencido'

export const SOLICITUD_PENDIENTE = 'pendiente'
export const SOLICITUD_APROBADA = 'aprobada'
export const SOLICITUD_RECHAZADA = 'rechazada'

/** Diferencia en días completos entre una fecha ISO y ahora (o `now`). */
export const getDaysSinceAssignment = (fechaAsignacion, now = new Date()) => {
  if (!fechaAsignacion) return 0

  const assignedAt = new Date(fechaAsignacion)
  if (Number.isNaN(assignedAt.getTime())) return 0

  const diffMs = now.getTime() - assignedAt.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * Recorre premios del cliente y, si llevan más de 30 días en 'pendiente',
 * expone el estatus visual 'premio vencido' (sin mutar Firebase).
 * Mientras hay una solicitud de canje abierta se conserva 'en_solicitud'.
 */
export const resolveClientPrizeStatus = (premio, now = new Date()) => {
  const storedStatus = premio?.status || STATUS_PENDIENTE

  if (storedStatus === STATUS_CANJEADO) {
    return STATUS_CANJEADO
  }

  if (storedStatus === STATUS_EN_SOLICITUD) {
    return STATUS_EN_SOLICITUD
  }

  if (
    storedStatus === STATUS_PENDIENTE &&
    getDaysSinceAssignment(premio?.fechaAsignacion, now) > PRIZE_EXPIRATION_DAYS
  ) {
    return STATUS_VENCIDO
  }

  return storedStatus === STATUS_VENCIDO ? STATUS_VENCIDO : STATUS_PENDIENTE
}

/** Normaliza el arreglo de premios del documento cliente (array u objeto map). */
export const normalizeClientPremios = (premios) => {
  if (Array.isArray(premios)) {
    return premios.filter((premio) => premio && typeof premio === 'object')
  }

  if (premios && typeof premios === 'object') {
    return Object.values(premios).filter((premio) => premio && typeof premio === 'object')
  }

  return []
}

export const resolveClientPrizes = (premios = [], now = new Date()) =>
  normalizeClientPremios(premios).map((premio, index) => ({
    ...premio,
    id: premio.id || premio.premioId || `premio-${index}-${premio.nombre || 'item'}`,
    nombre: premio.nombre || 'Premio',
    statusEfectivo: resolveClientPrizeStatus(premio, now),
  }))

export const canRedeemAssignedPrize = (premio, now = new Date()) =>
  resolveClientPrizeStatus(premio, now) === STATUS_PENDIENTE

export const ORIGEN_PREMIO_ASIGNADO = 'asignado'
export const ORIGEN_PREMIO_CATALOGO = 'catalogo'
