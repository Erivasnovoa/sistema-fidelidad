export const DEFAULT_CLIENT_LEVELS = [
  { id: 'bronce', nombre: 'Bronce', puntosMinimos: 0 },
  { id: 'plata', nombre: 'Plata', puntosMinimos: 500 },
  { id: 'oro', nombre: 'Oro', puntosMinimos: 1500 },
]

export const normalizeClientLevels = (levels = []) => {
  const byId = new Map(
    (Array.isArray(levels) ? levels : [])
      .filter((level) => level?.id && level?.nombre)
      .map((level) => [
        level.id,
        {
          id: String(level.id),
          nombre: String(level.nombre),
          puntosMinimos: Math.max(0, Number(level.puntosMinimos) || 0),
        },
      ]),
  )

  return DEFAULT_CLIENT_LEVELS.map((fallback) => (
    byId.get(fallback.id) || { ...fallback }
  ))
}

export const obtenerNivelClienteDetalle = (puntos, levels = DEFAULT_CLIENT_LEVELS) => {
  const puntosActuales = Number(puntos) || 0
  const sortedLevels = [...normalizeClientLevels(levels)].sort(
    (a, b) => b.puntosMinimos - a.puntosMinimos,
  )
  return sortedLevels.find((level) => puntosActuales >= level.puntosMinimos) || null
}

export const obtenerNivelCliente = (puntos, levels = DEFAULT_CLIENT_LEVELS) => (
  obtenerNivelClienteDetalle(puntos, levels)?.nombre ?? 'Sin nivel'
)

export const obtenerNivelPorId = (nivelId, levels = DEFAULT_CLIENT_LEVELS) => {
  const normalized = normalizeClientLevels(levels)
  return normalized.find((level) => level.id === nivelId) || normalized[0]
}

/** El cliente alcanza el nivel mínimo del premio (Bronce ⊂ Plata ⊂ Oro). */
export const clienteAlcanzaNivel = (puntos, nivelMinimoId, levels = DEFAULT_CLIENT_LEVELS) => {
  const nivelCliente = obtenerNivelClienteDetalle(puntos, levels)
  const nivelRequerido = obtenerNivelPorId(nivelMinimoId || 'bronce', levels)

  if (!nivelCliente || !nivelRequerido) return false

  return nivelCliente.puntosMinimos >= nivelRequerido.puntosMinimos
}
