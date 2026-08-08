export const DEFAULT_MONTO_POR_PUNTO = 1000

export const normalizeMontoPorPunto = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MONTO_POR_PUNTO
}

export const calcularPuntosDesdeMonto = (montoCompra, montoPorPunto = DEFAULT_MONTO_POR_PUNTO) => {
  const monto = Number(montoCompra)
  const valorPunto = normalizeMontoPorPunto(montoPorPunto)

  if (!Number.isFinite(monto) || monto <= 0) {
    return 0
  }

  return Math.floor(monto / valorPunto)
}

export const normalizePrizeRules = (rules = []) =>
  (rules || [])
    .filter((rule) => rule && rule.nombre && Number(rule.umbral) > 0 && Number(rule.puntosCosto) > 0)
    .map((rule) => ({
      id: rule.id || crypto.randomUUID(),
      nombre: rule.nombre,
      descripcion: rule.descripcion || 'Recompensa configurada por umbral de compra.',
      umbral: Number(rule.umbral),
      puntosCosto: Number(rule.puntosCosto),
    }))

export const getAvailablePrizeRules = (rules = [], purchaseAmount = 0) => {
  const normalized = normalizePrizeRules(rules)
  const purchaseValue = Number(purchaseAmount) || 0

  return normalized.map((rule) => ({
    ...rule,
    unlocked: purchaseValue >= rule.umbral,
  }))
}

export const PRIZE_EXPIRATION_DAYS = 30

export const STATUS_PENDIENTE = 'pendiente'
export const STATUS_CANJEADO = 'canjeado'
export const STATUS_VENCIDO = 'premio vencido'

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
 */
export const resolveClientPrizeStatus = (premio, now = new Date()) => {
  const storedStatus = premio?.status || STATUS_PENDIENTE

  if (storedStatus === STATUS_CANJEADO) {
    return STATUS_CANJEADO
  }

  if (
    storedStatus === STATUS_PENDIENTE &&
    getDaysSinceAssignment(premio?.fechaAsignacion, now) > PRIZE_EXPIRATION_DAYS
  ) {
    return STATUS_VENCIDO
  }

  return storedStatus === STATUS_VENCIDO ? STATUS_VENCIDO : STATUS_PENDIENTE
}

export const resolveClientPrizes = (premios = [], now = new Date()) =>
  (Array.isArray(premios) ? premios : []).map((premio) => ({
    ...premio,
    statusEfectivo: resolveClientPrizeStatus(premio, now),
  }))

export const canRedeemAssignedPrize = (premio, now = new Date()) =>
  resolveClientPrizeStatus(premio, now) === STATUS_PENDIENTE
