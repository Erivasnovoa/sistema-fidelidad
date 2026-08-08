import { useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from './lib/firebase'
import { DEFAULT_CLIENT_LEVELS, obtenerNivelCliente } from './lib/clientLevels'
import {
  getDaysSinceAssignment,
  PRIZE_EXPIRATION_DAYS,
  resolveClientPrizes,
  STATUS_CANJEADO,
  STATUS_PENDIENTE,
  STATUS_VENCIDO,
} from './lib/prizeRules'

const diasRestantesPremio = (premio) => {
  const diasTranscurridos = getDaysSinceAssignment(premio?.fechaAsignacion)
  return Math.max(0, PRIZE_EXPIRATION_DAYS - diasTranscurridos)
}

const ClientePublico = ({ onAccesoAdmin }) => {
  const [telefono, setTelefono] = useState('')
  const [cliente, setCliente] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busquedaHecha, setBusquedaHecha] = useState(false)

  const handleSearch = async (event) => {
    event.preventDefault()

    const telefonoBuscado = telefono.trim()

    if (!telefonoBuscado) {
      setError('Ingresa tu número de teléfono para consultar.')
      setCliente(null)
      setBusquedaHecha(false)
      return
    }

    setLoading(true)
    setError('')
    setCliente(null)
    setBusquedaHecha(false)

    try {
      // Solo lectura: getDocs / query. Sin updateDoc ni canjes.
      const clientesRef = collection(db, 'clientes')
      const clientesQuery = query(clientesRef, where('telefono', '==', telefonoBuscado))
      const snapshot = await getDocs(clientesQuery)

      if (snapshot.empty) {
        setError('No encontramos un cliente con ese teléfono.')
        return
      }

      const clienteDoc = snapshot.docs[0]
      setCliente({ id: clienteDoc.id, ...clienteDoc.data() })
      setBusquedaHecha(true)
    } catch (err) {
      setError('No se pudo consultar tu información. Intenta de nuevo.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const puntosDisponibles = cliente?.puntos ?? 0
  const nivelCliente = cliente
    ? obtenerNivelCliente(puntosDisponibles, DEFAULT_CLIENT_LEVELS)
    : 'Sin nivel'
  const premiosCliente = cliente ? resolveClientPrizes(cliente.premios) : []
  const premiosVisibles = premiosCliente.filter(
    (premio) => premio.statusEfectivo !== STATUS_CANJEADO,
  )

  return (
    <main
      className="relative min-h-screen overflow-x-hidden px-4 py-10 sm:px-6"
      style={{ fontFamily: '"Manrope", sans-serif' }}
    >
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 90% 55% at 15% -5%, rgba(139, 92, 246, 0.35), transparent 55%),'
            + 'radial-gradient(ellipse 70% 45% at 95% 15%, rgba(88, 28, 135, 0.4), transparent 50%),'
            + 'radial-gradient(ellipse 60% 40% at 50% 100%, rgba(67, 56, 202, 0.22), transparent 55%),'
            + 'linear-gradient(165deg, #0a0612 0%, #12081f 40%, #1a1029 100%)',
        }}
      />

      <div className="mx-auto w-full max-w-md">
        <header className="mb-10 text-center">
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={onAccesoAdmin}
              className="rounded-full border border-violet-300/25 bg-violet-950/60 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-violet-100/85 shadow-sm backdrop-blur-sm transition hover:border-violet-300/45 hover:bg-violet-900/70 hover:text-white"
            >
              Acceso Admin
            </button>
          </div>
          <p
            className="text-5xl tracking-[0.2em] text-violet-300 sm:text-6xl"
            style={{ fontFamily: '"Bebas Neue", sans-serif' }}
          >
            EL BAJONAZO
          </p>
          <p className="mt-3 text-sm font-medium text-violet-200/70">
            Consulta tus puntos, nivel y premios
          </p>
        </header>

        <form
          onSubmit={handleSearch}
          className="rounded-3xl border border-violet-400/20 bg-gradient-to-b from-violet-950/80 to-slate-950/90 p-5 shadow-2xl shadow-violet-950/50 backdrop-blur-sm sm:p-6"
        >
          <label htmlFor="telefono-publico" className="block text-sm font-semibold text-violet-100">
            Número de Teléfono
          </label>
          <input
            id="telefono-publico"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={telefono}
            onChange={(event) => {
              setTelefono(event.target.value)
              setError('')
            }}
            placeholder="Ej. 88887777"
            className="mt-2 w-full rounded-2xl border border-violet-500/30 bg-black/40 px-4 py-3.5 text-base text-violet-50 outline-none transition placeholder:text-violet-300/40 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/40"
          />

          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-700 px-4 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-violet-900/40 transition hover:from-violet-500 hover:to-fuchsia-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Buscando...' : 'Consultar'}
          </button>
        </form>

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-950/50 px-4 py-3 text-sm font-medium text-rose-200">
            {error}
          </div>
        ) : null}

        {cliente && busquedaHecha ? (
          <section className="mt-6 space-y-4 animate-[fadeUp_0.45s_ease-out]">
            <div className="rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-900/50 via-slate-950/80 to-indigo-950/60 p-5 shadow-xl shadow-black/40">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-300/70">
                Hola
              </p>
              <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-white">
                {cliente.nombre}
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <article className="rounded-3xl border border-violet-400/25 bg-gradient-to-br from-violet-700 via-purple-900 to-slate-950 p-5 shadow-lg shadow-violet-950/50">
                <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-violet-200/80">
                  Mis Puntos Disponibles
                </p>
                <p className="mt-3 text-4xl font-extrabold tracking-tight text-white">
                  {puntosDisponibles.toLocaleString('es-CR')}
                </p>
              </article>

              <article className="rounded-3xl border border-fuchsia-400/20 bg-gradient-to-br from-indigo-800 via-violet-950 to-slate-950 p-5 shadow-lg shadow-indigo-950/50">
                <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-indigo-200/80">
                  Mi Nivel actual
                </p>
                <p className="mt-3 text-4xl font-extrabold tracking-tight text-violet-100">
                  {nivelCliente}
                </p>
              </article>
            </div>

            <article className="rounded-3xl border border-violet-400/20 bg-gradient-to-b from-slate-950/90 to-violet-950/40 p-5 shadow-xl shadow-black/40 sm:p-6">
              <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-violet-300/70">
                Premios
              </p>
              <h3 className="mt-1 text-xl font-extrabold text-white">
                Tus recompensas
              </h3>
              <p className="mt-2 text-sm text-violet-200/55">
                Los premios pendientes vencen a los {PRIZE_EXPIRATION_DAYS} días desde su asignación.
              </p>

              <ul className="mt-4 space-y-3">
                {premiosVisibles.length === 0 ? (
                  <li className="rounded-2xl border border-dashed border-violet-500/25 bg-black/30 px-4 py-5 text-center text-sm text-violet-200/60">
                    Aún no tienes premios pendientes o vencidos.
                  </li>
                ) : (
                  premiosVisibles.map((premio) => {
                    const status = premio.statusEfectivo
                    const esPendiente = status === STATUS_PENDIENTE
                    const esVencido = status === STATUS_VENCIDO
                    const diasRestantes = diasRestantesPremio(premio)

                    return (
                      <li
                        key={premio.id || `${premio.nombre}-${premio.fechaAsignacion}`}
                        className={`rounded-2xl border px-4 py-3 ${
                          esVencido
                            ? 'border-rose-500/30 bg-gradient-to-r from-rose-950/60 to-slate-950/80'
                            : 'border-violet-400/25 bg-gradient-to-r from-violet-900/50 to-indigo-950/60'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-white">{premio.nombre}</p>
                            {premio.descripcion ? (
                              <p className="mt-0.5 text-sm text-violet-200/55">{premio.descripcion}</p>
                            ) : null}
                            {esPendiente ? (
                              <p className="mt-2 text-sm font-semibold text-amber-300">
                                {diasRestantes === 0
                                  ? 'Vence hoy'
                                  : diasRestantes === 1
                                    ? 'Te queda 1 día antes de vencer'
                                    : `Te quedan ${diasRestantes} días antes de vencer`}
                              </p>
                            ) : null}
                            {esVencido ? (
                              <p className="mt-2 text-sm font-semibold text-rose-300">
                                Este premio ya venció (más de {PRIZE_EXPIRATION_DAYS} días)
                              </p>
                            ) : null}
                          </div>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                              esVencido
                                ? 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40'
                                : 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/40'
                            }`}
                          >
                            {esVencido ? 'Vencido' : 'Pendiente'}
                          </span>
                        </div>
                      </li>
                    )
                  })
                )}
              </ul>
            </article>

            <p className="text-center text-xs text-violet-300/40">
              Vista informativa · Solo consulta · Sin edición ni canjes
            </p>
          </section>
        ) : null}
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </main>
  )
}

export default ClientePublico
