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

/** Progreso del cliente entre su nivel actual y el siguiente. */
export const obtenerProgresoEntreNiveles = (puntos, levels = DEFAULT_CLIENT_LEVELS) => {
  const puntosActuales = Math.max(0, Number(puntos) || 0)
  const niveles = [...normalizeClientLevels(levels)].sort(
    (a, b) => a.puntosMinimos - b.puntosMinimos,
  )
  const nivelActual = obtenerNivelClienteDetalle(puntosActuales, levels) || niveles[0]
  const indiceActual = Math.max(0, niveles.findIndex((level) => level.id === nivelActual?.id))
  const nivelSiguiente = niveles[indiceActual + 1] || null

  if (!nivelSiguiente) {
    return {
      niveles,
      nivelActual,
      nivelSiguiente: null,
      puntosActuales,
      puntosInicio: nivelActual?.puntosMinimos ?? 0,
      puntosObjetivo: nivelActual?.puntosMinimos ?? puntosActuales,
      puntosFaltantes: 0,
      porcentaje: 100,
      porcentajeGlobal: 100,
      esNivelMaximo: true,
      indiceActual,
    }
  }

  const puntosInicio = nivelActual?.puntosMinimos ?? 0
  const puntosObjetivo = nivelSiguiente.puntosMinimos
  const rango = Math.max(1, puntosObjetivo - puntosInicio)
  const avance = Math.min(rango, Math.max(0, puntosActuales - puntosInicio))
  const porcentaje = Math.round((avance / rango) * 100)

  const topeGlobal = niveles[niveles.length - 1]?.puntosMinimos || 1
  const porcentajeGlobal = Math.min(
    100,
    Math.round((puntosActuales / Math.max(1, topeGlobal)) * 100),
  )

  return {
    niveles,
    nivelActual,
    nivelSiguiente,
    puntosActuales,
    puntosInicio,
    puntosObjetivo,
    puntosFaltantes: Math.max(0, puntosObjetivo - puntosActuales),
    porcentaje,
    porcentajeGlobal,
    esNivelMaximo: false,
    indiceActual,
  }
}
