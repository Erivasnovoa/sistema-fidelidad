export const DEFAULT_CLIENT_LEVELS = [
  { id: 'bronce', nombre: 'Bronce', puntosMinimos: 10 },
  { id: 'plata', nombre: 'Plata', puntosMinimos: 30 },
  { id: 'oro', nombre: 'Oro', puntosMinimos: 50 },
]

/**
 * Normaliza Bronce/Plata/Oro y asegura umbrales crecientes:
 * Bronce < Plata < Oro.
 */
export const normalizeClientLevels = (levels = []) => {
  const byId = new Map(
    (Array.isArray(levels) ? levels : [])
      .filter((level) => level?.id && level?.nombre)
      .map((level) => [
        String(level.id).toLowerCase(),
        {
          id: String(level.id).toLowerCase(),
          nombre: String(level.nombre),
          puntosMinimos: Math.max(0, Number(level.puntosMinimos) || 0),
        },
      ]),
  )

  const normalized = DEFAULT_CLIENT_LEVELS.map((fallback) => {
    const incoming = byId.get(fallback.id)
    return {
      id: fallback.id,
      nombre: incoming?.nombre || fallback.nombre,
      puntosMinimos: incoming
        ? Math.max(0, Number(incoming.puntosMinimos) || 0)
        : fallback.puntosMinimos,
    }
  })

  // Mantener orden estricto de trayectoria.
  for (let index = 1; index < normalized.length; index += 1) {
    const previo = normalized[index - 1].puntosMinimos
    if (normalized[index].puntosMinimos <= previo) {
      normalized[index].puntosMinimos = previo + 1
    }
  }

  return normalized
}

export const obtenerNivelClienteDetalle = (puntos, levels = DEFAULT_CLIENT_LEVELS) => {
  const puntosActuales = Math.max(0, Number(puntos) || 0)
  const sortedLevels = [...normalizeClientLevels(levels)].sort(
    (a, b) => b.puntosMinimos - a.puntosMinimos,
  )

  // Menos del primer umbral (Bronce) => sin nivel asignado.
  return sortedLevels.find((level) => puntosActuales >= level.puntosMinimos) || null
}

export const obtenerNivelCliente = (puntos, levels = DEFAULT_CLIENT_LEVELS) => (
  obtenerNivelClienteDetalle(puntos, levels)?.nombre ?? 'Sin nivel'
)

export const obtenerNivelPorId = (nivelId, levels = DEFAULT_CLIENT_LEVELS) => {
  const normalized = normalizeClientLevels(levels)
  return normalized.find((level) => level.id === String(nivelId || '').toLowerCase()) || normalized[0]
}

/** El cliente alcanza el nivel mínimo del premio (Bronce ⊂ Plata ⊂ Oro). */
export const clienteAlcanzaNivel = (puntos, nivelMinimoId, levels = DEFAULT_CLIENT_LEVELS) => {
  const nivelCliente = obtenerNivelClienteDetalle(puntos, levels)
  const nivelRequerido = obtenerNivelPorId(
    String(nivelMinimoId || 'bronce').toLowerCase(),
    levels,
  )

  // Sin nivel (debajo de Bronce) no puede canjear premios de ningún nivel.
  if (!nivelCliente || !nivelRequerido) return false

  return nivelCliente.puntosMinimos >= nivelRequerido.puntosMinimos
}

/** Progreso del cliente entre su nivel actual y el siguiente. */
export const obtenerProgresoEntreNiveles = (puntos, levels = DEFAULT_CLIENT_LEVELS) => {
  const puntosActuales = Math.max(0, Number(puntos) || 0)
  const niveles = [...normalizeClientLevels(levels)].sort(
    (a, b) => a.puntosMinimos - b.puntosMinimos,
  )
  const nivelActual = obtenerNivelClienteDetalle(puntosActuales, levels)
  const topeGlobal = niveles[niveles.length - 1]?.puntosMinimos || 1
  const porcentajeGlobal = Math.min(
    100,
    Math.round((puntosActuales / Math.max(1, topeGlobal)) * 100),
  )

  // Aún no llega a Bronce.
  if (!nivelActual) {
    const nivelSiguiente = niveles[0]
    const puntosObjetivo = Number(nivelSiguiente?.puntosMinimos) || 0
    return {
      niveles,
      nivelActual: null,
      nivelSiguiente,
      puntosActuales,
      puntosInicio: 0,
      puntosObjetivo,
      puntosFaltantes: Math.max(0, puntosObjetivo - puntosActuales),
      porcentaje: puntosObjetivo > 0
        ? Math.min(100, Math.round((puntosActuales / puntosObjetivo) * 100))
        : 0,
      porcentajeGlobal,
      esNivelMaximo: false,
      sinNivel: true,
      indiceActual: -1,
    }
  }

  const indiceActual = Math.max(0, niveles.findIndex((level) => level.id === nivelActual.id))
  const nivelSiguiente = niveles[indiceActual + 1] || null

  if (!nivelSiguiente) {
    return {
      niveles,
      nivelActual,
      nivelSiguiente: null,
      puntosActuales,
      puntosInicio: nivelActual.puntosMinimos,
      puntosObjetivo: nivelActual.puntosMinimos,
      puntosFaltantes: 0,
      porcentaje: 100,
      porcentajeGlobal,
      esNivelMaximo: true,
      sinNivel: false,
      indiceActual,
    }
  }

  const puntosInicio = nivelActual.puntosMinimos
  const puntosObjetivo = Number(nivelSiguiente.puntosMinimos) || 0
  const puntosFaltantes = Math.max(0, puntosObjetivo - puntosActuales)
  const porcentaje = puntosObjetivo > 0
    ? Math.min(100, Math.round((puntosActuales / puntosObjetivo) * 100))
    : 100

  return {
    niveles,
    nivelActual,
    nivelSiguiente,
    puntosActuales,
    puntosInicio,
    puntosObjetivo,
    puntosFaltantes,
    porcentaje,
    porcentajeGlobal,
    esNivelMaximo: false,
    sinNivel: false,
    indiceActual,
  }
}

/** Snapshot de trayectoria para persistir en el cliente. */
export const buildTrayectoriaCliente = (puntos, levels = DEFAULT_CLIENT_LEVELS) => {
  const niveles = normalizeClientLevels(levels)
  const puntosActuales = Math.max(0, Number(puntos) || 0)
  const nivelDetalle = obtenerNivelClienteDetalle(puntosActuales, niveles)
  const progreso = obtenerProgresoEntreNiveles(puntosActuales, niveles)

  return {
    puntos: puntosActuales,
    nivelId: nivelDetalle?.id || null,
    nivelNombre: nivelDetalle?.nombre || 'Sin nivel',
    nivelSiguienteId: progreso.nivelSiguiente?.id || null,
    nivelSiguienteNombre: progreso.nivelSiguiente?.nombre || null,
    puntosObjetivo: progreso.puntosObjetivo,
    puntosFaltantes: progreso.puntosFaltantes,
    porcentajeTrayecto: progreso.porcentajeGlobal,
    umbrales: niveles.map((level) => ({
      id: level.id,
      nombre: level.nombre,
      puntosMinimos: level.puntosMinimos,
    })),
    actualizadoAt: new Date().toISOString(),
  }
}
