import { useEffect, useState } from 'react'
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from './lib/firebase'
import { DEFAULT_CLIENT_LEVELS, obtenerNivelCliente } from './lib/clientLevels'
import {
  hashClientPassword,
  MIN_CLIENT_PASSWORD_LENGTH,
  stripClientPassword,
  validateClientPassword,
  verifyClientPassword,
} from './lib/clientPassword'
import {
  getDaysSinceAssignment,
  PRIZE_EXPIRATION_DAYS,
  resolveClientPrizes,
  SOLICITUD_PENDIENTE,
  STATUS_CANJEADO,
  STATUS_EN_SOLICITUD,
  STATUS_PENDIENTE,
  STATUS_VENCIDO,
} from './lib/prizeRules'

const ESTADO_ACTIVO = 'Activo'

const diasRestantesPremio = (premio) => {
  const diasTranscurridos = getDaysSinceAssignment(premio?.fechaAsignacion)
  return Math.max(0, PRIZE_EXPIRATION_DAYS - diasTranscurridos)
}

const ClientePublico = ({ onAccesoAdmin }) => {
  const [modo, setModo] = useState('consulta') // 'consulta' | 'registro'
  const [telefono, setTelefono] = useState('')
  const [contraseña, setContraseña] = useState('')
  const [nombreRegistro, setNombreRegistro] = useState('')
  const [telefonoRegistro, setTelefonoRegistro] = useState('')
  const [contraseñaRegistro, setContraseñaRegistro] = useState('')
  const [cliente, setCliente] = useState(null)
  const [loading, setLoading] = useState(false)
  const [registroLoading, setRegistroLoading] = useState(false)
  const [canjeLoadingId, setCanjeLoadingId] = useState(null)
  const [premioSeleccionadoId, setPremioSeleccionadoId] = useState(null)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [busquedaHecha, setBusquedaHecha] = useState(false)

  useEffect(() => {
    if (!cliente?.id || !busquedaHecha) return undefined

    const clienteDocRef = doc(db, 'clientes', cliente.id)
    const unsubscribe = onSnapshot(
      clienteDocRef,
      (snapshot) => {
        if (!snapshot.exists()) return
        setCliente(stripClientPassword({ id: snapshot.id, ...snapshot.data() }))
      },
      (err) => {
        console.error(err)
      },
    )

    return unsubscribe
  }, [cliente?.id, busquedaHecha])

  useEffect(() => {
    if (!cliente) {
      setPremioSeleccionadoId(null)
      return
    }

    const premiosCanjeables = resolveClientPrizes(cliente.premios)
      .filter((premio) => premio.statusEfectivo === STATUS_PENDIENTE)

    setPremioSeleccionadoId((currentId) => {
      if (currentId && premiosCanjeables.some((premio) => premio.id === currentId)) {
        return currentId
      }
      return premiosCanjeables[0]?.id ?? null
    })
  }, [cliente])

  const cerrarSesionCliente = () => {
    setCliente(null)
    setBusquedaHecha(false)
    setPremioSeleccionadoId(null)
    setContraseña('')
    setSuccessMessage('')
    setError('')
  }

  const abrirRegistro = (telefonoPrefill = '') => {
    setModo('registro')
    setTelefonoRegistro(telefonoPrefill || telefono.trim())
    setContraseñaRegistro('')
    setError('')
    setSuccessMessage('')
    setCliente(null)
    setBusquedaHecha(false)
    setPremioSeleccionadoId(null)
  }

  const abrirConsulta = () => {
    setModo('consulta')
    setError('')
    setSuccessMessage('')
  }

  const handleSearch = async (event) => {
    event.preventDefault()

    const telefonoBuscado = telefono.trim()
    const passwordCheck = validateClientPassword(contraseña)

    if (!telefonoBuscado) {
      setError('Ingresa tu número de teléfono para consultar.')
      setCliente(null)
      setBusquedaHecha(false)
      return
    }

    if (!passwordCheck.ok) {
      setError(passwordCheck.error)
      setCliente(null)
      setBusquedaHecha(false)
      return
    }

    setLoading(true)
    setError('')
    setSuccessMessage('')
    setCliente(null)
    setBusquedaHecha(false)
    setPremioSeleccionadoId(null)

    try {
      const clientesRef = collection(db, 'clientes')
      const clientesQuery = query(clientesRef, where('telefono', '==', telefonoBuscado))
      const snapshot = await getDocs(clientesQuery)

      if (snapshot.empty) {
        setError('Teléfono o contraseña incorrectos.')
        return
      }

      const clienteDoc = snapshot.docs[0]
      const clienteData = { id: clienteDoc.id, ...clienteDoc.data() }
      const storedPassword = clienteData.contraseña || clienteData.contraseñaHash || ''

      if (!storedPassword) {
        setError('Esta cuenta aún no tiene contraseña. Pide al administrador que te asigne una.')
        return
      }

      const esValida = await verifyClientPassword(passwordCheck.password, storedPassword)

      if (!esValida) {
        setError('Teléfono o contraseña incorrectos.')
        return
      }

      setCliente(stripClientPassword(clienteData))
      setContraseña('')
      setBusquedaHecha(true)
    } catch (err) {
      setError('No se pudo consultar tu información. Intenta de nuevo.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (event) => {
    event.preventDefault()

    const nombreTrim = nombreRegistro.trim()
    const telefonoTrim = telefonoRegistro.trim()
    const passwordCheck = validateClientPassword(contraseñaRegistro)

    if (!nombreTrim || !telefonoTrim) {
      setError('Completa tu nombre, teléfono y contraseña para registrarte.')
      setSuccessMessage('')
      return
    }

    if (!passwordCheck.ok) {
      setError(passwordCheck.error)
      setSuccessMessage('')
      return
    }

    setRegistroLoading(true)
    setError('')
    setSuccessMessage('')

    try {
      const clientesRef = collection(db, 'clientes')
      const clientesQuery = query(clientesRef, where('telefono', '==', telefonoTrim))
      const snapshot = await getDocs(clientesQuery)

      if (!snapshot.empty) {
        setError('Este número ya está registrado. Usa Consultar con tu contraseña.')
        return
      }

      const contraseñaHash = await hashClientPassword(passwordCheck.password)
      const docRef = await addDoc(clientesRef, {
        nombre: nombreTrim,
        telefono: telefonoTrim,
        contraseña: contraseñaHash,
        puntos: 0,
        montoPendientePuntos: 0,
        estado: ESTADO_ACTIVO,
        fechaUltimaCompra: new Date().toISOString(),
      })

      const nuevoCliente = {
        id: docRef.id,
        nombre: nombreTrim,
        telefono: telefonoTrim,
        puntos: 0,
        montoPendientePuntos: 0,
        estado: ESTADO_ACTIVO,
      }

      setCliente(nuevoCliente)
      setTelefono(telefonoTrim)
      setContraseña('')
      setNombreRegistro('')
      setTelefonoRegistro('')
      setContraseñaRegistro('')
      setBusquedaHecha(true)
      setModo('consulta')
      setSuccessMessage('¡Registro exitoso! Ya formas parte del programa de fidelidad.')
    } catch (err) {
      setError('No se pudo completar el registro. Intenta de nuevo.')
      console.error(err)
    } finally {
      setRegistroLoading(false)
    }
  }

  const handleSolicitarCanje = async (premio) => {
    if (!cliente?.id || !premio?.id) return

    if (premio.statusEfectivo !== STATUS_PENDIENTE) {
      setError('Este premio no está disponible para canje.')
      return
    }

    setCanjeLoadingId(premio.id)
    setError('')
    setSuccessMessage('')

    try {
      const fecha = new Date().toISOString()
      const solicitudRef = doc(collection(db, 'solicitudesCanje'))
      const nextPremios = (cliente.premios ?? []).map((item) => (
        item.id === premio.id
          ? {
              ...item,
              status: STATUS_EN_SOLICITUD,
              solicitudCanjeId: solicitudRef.id,
            }
          : item
      ))

      const batch = writeBatch(db)
      batch.set(solicitudRef, {
        clienteId: cliente.id,
        clienteNombre: cliente.nombre || 'Cliente',
        premioId: premio.id,
        premioNombre: premio.nombre,
        fecha,
        status: SOLICITUD_PENDIENTE,
      })
      batch.update(doc(db, 'clientes', cliente.id), {
        premios: nextPremios,
      })
      await batch.commit()

      setCliente((current) => (
        current ? { ...current, premios: nextPremios } : current
      ))
      setPremioSeleccionadoId(null)
      setSuccessMessage(`Solicitud enviada para "${premio.nombre}". Espera la aprobación del administrador.`)
    } catch (err) {
      setError('No se pudo enviar la solicitud de canje. Intenta de nuevo.')
      console.error(err)
    } finally {
      setCanjeLoadingId(null)
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
  const premiosCanjeables = premiosVisibles.filter(
    (premio) => premio.statusEfectivo === STATUS_PENDIENTE,
  )

  return (
    <main
      className="cliente-publico relative min-h-screen overflow-x-hidden px-4 py-10 sm:px-6"
      style={{ fontFamily: '"Manrope", sans-serif' }}
    >
      <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden="true">
        <img
          src="/bbq-ahumados-fondo.jpg"
          alt=""
          className="h-full w-full object-cover object-center"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(10, 6, 4, 0.72) 0%, rgba(18, 10, 6, 0.58) 38%, rgba(12, 7, 4, 0.78) 100%),'
              + 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(180, 83, 9, 0.22), transparent 55%)',
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.07] mix-blend-overlay"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.35) 2px, rgba(0,0,0,0.35) 3px)',
          }}
        />
      </div>

      <div className="mx-auto w-full max-w-md">
        <header
          className="mb-10 text-center"
          style={{
            '--brand-title': '#c48a1a',
            '--brand-subtitle': '#c4b5a0',
            '--brand-rule': 'rgba(196, 138, 26, 0.5)',
          }}
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => abrirRegistro()}
              className="rounded-full border border-amber-600/40 bg-amber-950/50 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-amber-100 shadow-sm backdrop-blur-sm transition hover:border-amber-400/55 hover:bg-amber-900/55 hover:text-amber-50"
            >
              Registrarme
            </button>
            <button
              type="button"
              onClick={onAccesoAdmin}
              className="rounded-full border border-amber-700/35 bg-black/45 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-amber-100/80 shadow-sm backdrop-blur-sm transition hover:border-amber-500/50 hover:bg-black/60 hover:text-amber-50"
            >
              Acceso Admin
            </button>
          </div>
          <h1
            className="text-[2.75rem] leading-none tracking-[0.14em] sm:text-6xl"
            style={{
              fontFamily: '"Bebas Neue", sans-serif',
              color: 'var(--brand-title)',
            }}
          >
            EL BAJONAZO
          </h1>
          <div
            className="mx-auto mt-3 h-px w-16"
            style={{ background: 'var(--brand-rule)' }}
            aria-hidden="true"
          />
          <p
            className="mt-3 text-sm font-medium leading-relaxed tracking-[0.02em]"
            style={{ color: 'var(--brand-subtitle)' }}
          >
            {modo === 'registro'
              ? 'Crea tu cuenta con teléfono y contraseña'
              : 'Ingresa con tu teléfono y contraseña para ver puntos y canjear'}
          </p>
        </header>

        {modo === 'consulta' && !(cliente && busquedaHecha) ? (
          <form
            onSubmit={handleSearch}
            className="rounded-3xl border border-amber-800/35 bg-gradient-to-b from-stone-950/85 to-black/80 p-5 shadow-2xl shadow-black/50 backdrop-blur-md sm:p-6"
          >
            <label htmlFor="telefono-publico" className="block text-sm font-semibold text-amber-100/90">
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
                setSuccessMessage('')
              }}
              placeholder="Ej. 88887777"
              className="mt-2 w-full rounded-2xl border border-amber-800/40 bg-black/50 px-4 py-3.5 text-base text-amber-50 outline-none transition placeholder:text-stone-400 focus:border-amber-500/70 focus:ring-2 focus:ring-amber-600/35"
            />

            <label htmlFor="contraseña-publico" className="mt-4 block text-sm font-semibold text-amber-100/90">
              Contraseña
            </label>
            <input
              id="contraseña-publico"
              type="password"
              autoComplete="current-password"
              value={contraseña}
              onChange={(event) => {
                setContraseña(event.target.value)
                setError('')
                setSuccessMessage('')
              }}
              placeholder="Tu contraseña"
              className="mt-2 w-full rounded-2xl border border-amber-800/40 bg-black/50 px-4 py-3.5 text-base text-amber-50 outline-none transition placeholder:text-stone-400 focus:border-amber-500/70 focus:ring-2 focus:ring-amber-600/35"
            />

            <button
              type="submit"
              disabled={loading}
              className="mt-4 w-full rounded-2xl bg-gradient-to-r from-amber-700 to-orange-800 px-4 py-3.5 text-sm font-bold uppercase tracking-wide text-amber-50 shadow-lg shadow-orange-950/50 transition hover:from-amber-600 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Verificando...' : 'Ingresar'}
            </button>

            <p className="mt-4 text-center text-sm text-stone-400">
              ¿Primera vez aquí?{' '}
              <button
                type="button"
                onClick={() => abrirRegistro(telefono)}
                className="font-semibold text-amber-300 underline-offset-2 transition hover:text-amber-200 hover:underline"
              >
                Regístrate gratis
              </button>
            </p>
          </form>
        ) : null}

        {modo === 'registro' ? (
          <form
            onSubmit={handleRegister}
            className="rounded-3xl border border-amber-800/35 bg-gradient-to-b from-stone-950/85 to-black/80 p-5 shadow-2xl shadow-black/50 backdrop-blur-md sm:p-6"
          >
            <p className="mb-4 text-sm text-stone-300/80">
              Completa tus datos para unirte al programa de fidelidad. Tu contraseña protege tus puntos y premios.
            </p>

            <label htmlFor="nombre-registro-publico" className="block text-sm font-semibold text-amber-100/90">
              Nombre completo
            </label>
            <input
              id="nombre-registro-publico"
              type="text"
              autoComplete="name"
              value={nombreRegistro}
              onChange={(event) => {
                setNombreRegistro(event.target.value)
                setError('')
              }}
              placeholder="Ej. María López"
              className="mt-2 w-full rounded-2xl border border-amber-800/40 bg-black/50 px-4 py-3.5 text-base text-amber-50 outline-none transition placeholder:text-stone-400 focus:border-amber-500/70 focus:ring-2 focus:ring-amber-600/35"
            />

            <label htmlFor="telefono-registro-publico" className="mt-4 block text-sm font-semibold text-amber-100/90">
              Número de Teléfono
            </label>
            <input
              id="telefono-registro-publico"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={telefonoRegistro}
              onChange={(event) => {
                setTelefonoRegistro(event.target.value)
                setError('')
              }}
              placeholder="Ej. 88887777"
              className="mt-2 w-full rounded-2xl border border-amber-800/40 bg-black/50 px-4 py-3.5 text-base text-amber-50 outline-none transition placeholder:text-stone-400 focus:border-amber-500/70 focus:ring-2 focus:ring-amber-600/35"
            />

            <label htmlFor="contraseña-registro-publico" className="mt-4 block text-sm font-semibold text-amber-100/90">
              Contraseña
            </label>
            <input
              id="contraseña-registro-publico"
              type="password"
              autoComplete="new-password"
              value={contraseñaRegistro}
              onChange={(event) => {
                setContraseñaRegistro(event.target.value)
                setError('')
              }}
              placeholder={`Mínimo ${MIN_CLIENT_PASSWORD_LENGTH} caracteres`}
              className="mt-2 w-full rounded-2xl border border-amber-800/40 bg-black/50 px-4 py-3.5 text-base text-amber-50 outline-none transition placeholder:text-stone-400 focus:border-amber-500/70 focus:ring-2 focus:ring-amber-600/35"
            />

            <button
              type="submit"
              disabled={registroLoading}
              className="mt-4 w-full rounded-2xl bg-gradient-to-r from-amber-700 to-orange-800 px-4 py-3.5 text-sm font-bold uppercase tracking-wide text-amber-50 shadow-lg shadow-orange-950/50 transition hover:from-amber-600 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {registroLoading ? 'Registrando...' : 'Crear mi cuenta'}
            </button>

            <button
              type="button"
              onClick={abrirConsulta}
              className="mt-3 w-full rounded-2xl border border-amber-800/40 bg-transparent px-4 py-3 text-sm font-semibold text-amber-100/85 transition hover:border-amber-600/50 hover:bg-black/30"
            >
              Ya tengo cuenta · Ingresar
            </button>
          </form>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-950/60 px-4 py-3 text-sm font-medium text-rose-200 backdrop-blur-sm">
            <p>{error}</p>
          </div>
        ) : null}

        {successMessage ? (
          <div className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-950/50 px-4 py-3 text-sm font-medium text-emerald-200 backdrop-blur-sm">
            {successMessage}
          </div>
        ) : null}

        {cliente && busquedaHecha ? (
          <section className="mt-6 space-y-4 animate-[fadeUp_0.45s_ease-out]">
            <div className="rounded-3xl border border-amber-800/30 bg-gradient-to-br from-stone-950/80 via-black/75 to-orange-950/40 p-5 shadow-xl shadow-black/40 backdrop-blur-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200/60">
                    Hola
                  </p>
                  <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-amber-50">
                    {cliente.nombre}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={cerrarSesionCliente}
                  className="shrink-0 rounded-full border border-amber-700/40 bg-black/40 px-3 py-1.5 text-[11px] font-semibold text-amber-100/85 transition hover:border-amber-500/50 hover:bg-black/60"
                >
                  Cerrar sesión
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <article className="rounded-3xl border border-amber-700/35 bg-gradient-to-br from-amber-900/70 via-orange-950/80 to-stone-950 p-5 shadow-lg shadow-black/50">
                <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-amber-200/75">
                  Mis Puntos Disponibles
                </p>
                <p className="mt-3 text-4xl font-extrabold tracking-tight text-amber-50">
                  {puntosDisponibles.toLocaleString('es-CR')}
                </p>
              </article>

              <article className="rounded-3xl border border-orange-800/35 bg-gradient-to-br from-stone-900/80 via-orange-950/70 to-black/80 p-5 shadow-lg shadow-black/50">
                <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-orange-200/70">
                  Mi Nivel actual
                </p>
                <p className="mt-3 text-4xl font-extrabold tracking-tight text-amber-100">
                  {nivelCliente}
                </p>
              </article>
            </div>

            <article className="rounded-3xl border border-amber-800/30 bg-gradient-to-b from-black/80 to-stone-950/85 p-5 shadow-xl shadow-black/40 backdrop-blur-md sm:p-6">
              <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-amber-200/55">
                Premios
              </p>
              <h3 className="mt-1 text-xl font-extrabold text-amber-50">
                Tus recompensas
              </h3>
              <p className="mt-2 text-sm text-stone-300/70">
                {premiosCanjeables.length > 1
                  ? 'Si tienes varios premios disponibles, toca el que deseas canjear y pulsa Canjear.'
                  : `Los premios pendientes vencen a los ${PRIZE_EXPIRATION_DAYS} días desde su asignación.`}
              </p>

              <ul className="mt-4 space-y-3">
                {premiosVisibles.length === 0 ? (
                  <li className="rounded-2xl border border-dashed border-amber-800/35 bg-black/40 px-4 py-5 text-center text-sm text-stone-400">
                    Aún no tienes premios pendientes o vencidos.
                  </li>
                ) : (
                  premiosVisibles.map((premio) => {
                    const status = premio.statusEfectivo
                    const esPendiente = status === STATUS_PENDIENTE
                    const esEnSolicitud = status === STATUS_EN_SOLICITUD
                    const esVencido = status === STATUS_VENCIDO
                    const diasRestantes = diasRestantesPremio(premio)
                    const estaSeleccionado = premioSeleccionadoId === premio.id
                    const enviando = canjeLoadingId === premio.id

                    return (
                      <li key={premio.id || `${premio.nombre}-${premio.fechaAsignacion}`}>
                        <div
                          role={esPendiente ? 'button' : undefined}
                          tabIndex={esPendiente ? 0 : undefined}
                          onClick={() => {
                            if (esPendiente) {
                              setPremioSeleccionadoId(premio.id)
                              setError('')
                            }
                          }}
                          onKeyDown={(event) => {
                            if (!esPendiente) return
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setPremioSeleccionadoId(premio.id)
                              setError('')
                            }
                          }}
                          className={`rounded-2xl border px-4 py-3 transition ${
                            esVencido
                              ? 'border-rose-500/30 bg-gradient-to-r from-rose-950/60 to-stone-950/80'
                              : esEnSolicitud
                                ? 'border-sky-500/40 bg-gradient-to-r from-sky-950/50 to-stone-950/70'
                                : estaSeleccionado
                                  ? 'border-amber-400/70 bg-gradient-to-r from-amber-900/70 to-orange-950/60 ring-2 ring-amber-400/40'
                                  : 'border-amber-700/30 bg-gradient-to-r from-amber-950/50 to-stone-950/70 hover:border-amber-500/50'
                          } ${esPendiente ? 'cursor-pointer' : ''}`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-bold text-amber-50">{premio.nombre}</p>
                              {premio.descripcion ? (
                                <p className="mt-0.5 text-sm text-stone-400">{premio.descripcion}</p>
                              ) : null}
                              {typeof premio.puntosCosto === 'number' ? (
                                <p className="mt-1 text-xs font-semibold text-amber-200/70">
                                  {premio.puntosCosto.toLocaleString('es-CR')} pts
                                </p>
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
                              {esEnSolicitud ? (
                                <p className="mt-2 text-sm font-semibold text-sky-300">
                                  Tu solicitud está en revisión por el administrador.
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
                                  : esEnSolicitud
                                    ? 'bg-sky-400/15 text-sky-200 ring-1 ring-sky-300/40'
                                    : estaSeleccionado
                                      ? 'bg-amber-300/25 text-amber-100 ring-1 ring-amber-200/50'
                                      : 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/40'
                              }`}
                            >
                              {esVencido
                                ? 'Vencido'
                                : esEnSolicitud
                                  ? 'En solicitud'
                                  : estaSeleccionado
                                    ? 'Seleccionado'
                                    : 'Pendiente'}
                            </span>
                          </div>

                          {esPendiente ? (
                            <button
                              type="button"
                              disabled={canjeLoadingId !== null || !estaSeleccionado}
                              onClick={(event) => {
                                event.stopPropagation()
                                handleSolicitarCanje(premio)
                              }}
                              className="mt-3 w-full rounded-xl bg-gradient-to-r from-amber-600 to-orange-700 px-3 py-2.5 text-sm font-bold uppercase tracking-wide text-amber-50 transition hover:from-amber-500 hover:to-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {enviando ? 'Enviando...' : 'Canjear'}
                            </button>
                          ) : null}

                          {esEnSolicitud ? (
                            <button
                              type="button"
                              disabled
                              className="mt-3 w-full cursor-not-allowed rounded-xl border border-sky-500/40 bg-sky-950/50 px-3 py-2.5 text-sm font-bold text-sky-100/90"
                            >
                              Esperando aprobación...
                            </button>
                          ) : null}
                        </div>
                      </li>
                    )
                  })
                )}
              </ul>
            </article>

            <p className="text-center text-xs text-stone-500">
              Acceso protegido con contraseña · El canje requiere aprobación del administrador
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
