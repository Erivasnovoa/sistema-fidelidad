export const DEFAULT_CLIENT_LEVELS = [
  { id: 'bronce', nombre: 'Bronce', puntosMinimos: 0 },
  { id: 'plata', nombre: 'Plata', puntosMinimos: 500 },
  { id: 'oro', nombre: 'Oro', puntosMinimos: 1500 },
]

export const obtenerNivelCliente = (puntos, levels = DEFAULT_CLIENT_LEVELS) => {
  const sortedLevels = [...levels].sort((a, b) => b.puntosMinimos - a.puntosMinimos)
  const nivelActual = sortedLevels.find((level) => puntos >= level.puntosMinimos)

  return nivelActual?.nombre ?? 'Sin nivel'
}
