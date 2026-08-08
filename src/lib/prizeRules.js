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
