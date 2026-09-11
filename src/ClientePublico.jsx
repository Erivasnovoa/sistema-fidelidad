import { useEffect, useState } from 'react'
import {
  clienteAlcanzaNivel,
  DEFAULT_CLIENT_LEVELS,
  normalizeClientLevels,
  obtenerNivelCliente,
  obtenerNivelClienteDetalle,
  obtenerProgresoEntreNiveles,
} from './lib/clientLevels'
import {
  MIN_CLIENT_PASSWORD_LENGTH,
  validateClientPassword,
} from './lib/clientPassword'
import { normalizeClientPhone } from './lib/phone'
import {
  getDaysSinceAssignment,
  normalizePrizeRules,
  obtenerNivelesCanjeados,
  ORIGEN_PREMIO_CATALOGO,
  PRIZE_EXPIRATION_DAYS,
  resolveClientPrizes,
  STATUS_CANJEADO,
  STATUS_EN_SOLICITUD,
  STATUS_PENDIENTE,
  STATUS_VENCIDO,
} from './lib/prizeRules'
import { callClientApi } from './lib/clientApi'

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
  const [prizeRules, setPrizeRules] = useState([])
  const [clientLevels, setClientLevels] = useState(DEFAULT_CLIENT_LEVELS)
  const [solicitudesPendientesCliente, setSolicitudesPendientesCliente] = useState([])
  const [showEditPerfil, setShowEditPerfil] = useState(false)
  const [editNombre, setEditNombre] = useState('')
  const [editTelefono, setEditTelefono] = useState('')
  const [editContraseña, setEditContraseña] = useState('')
  const [editLoading, setEditLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    callClientApi('config')
      .then((data) => {
        if (cancelled) return
        setPrizeRules(normalizePrizeRules(data.reglas || []))
        setClientLevels(data.niveles ? normalizeClientLevels(data.niveles) : DEFAULT_CLIENT_LEVELS)
      })
      .catch((err) => console.error(err))

    callClientApi('session')
      .then((data) => {
        if (cancelled) return
        setCliente(data.client)
        setBusquedaHecha(true)
        if (data.config) {
          setPrizeRules(normalizePrizeRules(data.config.reglas || []))
          setClientLevels(data.config.niveles ? normalizeClientLevels(data.config.niveles) : DEFAULT_CLIENT_LEVELS)
        }
        setSolicitudesPendientesCliente(data.solicitudesPendientes || [])
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!cliente) {
      const timer = window.setTimeout(() => setPremioSeleccionadoId(null), 0)
      return () => window.clearTimeout(timer)
    }

    const premiosCanjeables = resolveClientPrizes(cliente.premios)
      .filter((premio) => premio.statusEfectivo === STATUS_PENDIENTE)

    const timer = window.setTimeout(() => {
      setPremioSeleccionadoId((currentId) => {
        if (currentId && premiosCanjeables.some((premio) => premio.id === currentId)) {
          return currentId
        }
        if (currentId && String(currentId).startsWith('catalogo:')) {
          return currentId
        }
        return premiosCanjeables[0]?.id ?? null
      })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [cliente])

  const limpiarCamposLogin = () => {
    setTelefono('')
    setContraseña('')
    setError('')
    setSuccessMessage('')
  }

  const cerrarSesionCliente = () => {
    callClientApi('logout').catch(() => {})
    setCliente(null)
    setBusquedaHecha(false)
    setPremioSeleccionadoId(null)
    setShowEditPerfil(false)
    setEditNombre('')
    setEditTelefono('')
    setEditContraseña('')
    limpiarCamposLogin()
  }

  const abrirEditarPerfil = () => {
    if (!cliente) return
    setEditNombre(cliente.nombre || '')
    setEditTelefono(cliente.telefono || '')
    setEditContraseña('')
    setShowEditPerfil(true)
    setError('')
    setSuccessMessage('')
  }

  const cerrarEditarPerfil = () => {
    setShowEditPerfil(false)
    setEditContraseña('')
    setEditLoading(false)
  }

  const handleGuardarPerfil = async (event) => {
    event.preventDefault()
    if (!cliente?.id) return

    const nombreTrim = editNombre.trim()
    const telefonoTrim = normalizeClientPhone(editTelefono)
    const passwordRaw = editContraseña.trim()

    if (!nombreTrim || !telefonoTrim) {
      setError('Completa tu nombre y teléfono para guardar.')
      setSuccessMessage('')
      return
    }

    let passwordCheck = null
    if (passwordRaw) {
      passwordCheck = validateClientPassword(passwordRaw)
      if (!passwordCheck.ok) {
        setError(passwordCheck.error)
        setSuccessMessage('')
        return
      }
    }

    setEditLoading(true)
    setError('')
    setSuccessMessage('')

    try {
      const data = await callClientApi('updateProfile', {
        nombre: nombreTrim,
        telefono: telefonoTrim,
        contraseña: passwordCheck?.password || '',
      })
      setCliente(data.client)
      setTelefono(telefonoTrim)
      cerrarEditarPerfil()
      setSuccessMessage('Tus datos se actualizaron correctamente.')
    } catch (err) {
      setError(err.message || 'No se pudieron guardar tus datos. Intenta de nuevo.')
      console.error(err)
    } finally {
      setEditLoading(false)
    }
  }

  const abrirRegistro = (telefonoPrefill = '') => {
    setModo('registro')
    setTelefonoRegistro(telefonoPrefill || telefono.trim())
    setNombreRegistro('')
    setContraseñaRegistro('')
    setError('')
    setSuccessMessage('')
    setCliente(null)
    setBusquedaHecha(false)
    setPremioSeleccionadoId(null)
  }

  const abrirConsulta = () => {
    setModo('consulta')
    setNombreRegistro('')
    setTelefonoRegistro('')
    setContraseñaRegistro('')
    limpiarCamposLogin()
  }

  const handleSearch = async (event) => {
    event.preventDefault()

    const telefonoBuscado = normalizeClientPhone(telefono)
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
      const data = await callClientApi('login', { telefono: telefonoBuscado, contraseña: passwordCheck.password })
      setCliente(data.client)
      if (data.config) {
        setPrizeRules(normalizePrizeRules(data.config.reglas || []))
        setClientLevels(data.config.niveles ? normalizeClientLevels(data.config.niveles) : DEFAULT_CLIENT_LEVELS)
      }
      setContraseña('')
      setBusquedaHecha(true)
    } catch (err) {
      setError(err.message || 'No se pudo consultar tu información. Intenta de nuevo.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (event) => {
    event.preventDefault()

    const nombreTrim = nombreRegistro.trim()
    const telefonoTrim = normalizeClientPhone(telefonoRegistro)
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
      const data = await callClientApi('register', {
        nombre: nombreTrim,
        telefono: telefonoTrim,
        contraseña: passwordCheck.password,
      })
      setCliente(data.client)
      setTelefono(telefonoTrim)
      setContraseña('')
      setNombreRegistro('')
      setTelefonoRegistro('')
      setContraseñaRegistro('')
      setBusquedaHecha(true)
      setModo('consulta')
      setSuccessMessage('¡Registro exitoso! Ya formas parte del programa de fidelidad.')
    } catch (err) {
      setError(err.message || 'No se pudo completar el registro. Intenta de nuevo.')
      console.error(err)
    } finally {
      setRegistroLoading(false)
    }
  }

  const handleSolicitarCanjeAsignado = async (premio) => {
    if (!cliente?.id || !premio?.id) return

    if (premio.statusEfectivo !== STATUS_PENDIENTE) {
      setError('Este premio no está disponible para canje.')
      return
    }

    setCanjeLoadingId(premio.id)
    setError('')
    setSuccessMessage('')

    try {
      const data = await callClientApi('redeem', { origen: 'asignado', premioId: premio.id })
      setCliente(data.client)
      setSolicitudesPendientesCliente(data.solicitudesPendientes || [])
      setPremioSeleccionadoId(null)
      setSuccessMessage(`Solicitud enviada para "${premio.nombre}". Espera la aprobación del administrador.`)
    } catch (err) {
      setError(err.message || 'No se pudo enviar la solicitud de canje. Intenta de nuevo.')
      console.error(err)
    } finally {
      setCanjeLoadingId(null)
    }
  }

  const handleSolicitarCanjeCatalogo = async (regla) => {
    if (!cliente?.id || !regla?.id) return

    const puntosActuales = cliente.puntos ?? 0

    if (!clienteAlcanzaNivel(puntosActuales, regla.nivelId, clientLevels)) {
      setError('Aún no alcanzas el nivel requerido para este premio.')
      return
    }

    const nivelRegla = regla.nivelId || 'bronce'
    const nivelesCanjeados = obtenerNivelesCanjeados(cliente.premios)
    if (nivelesCanjeados.has(nivelRegla)) {
      setError('Ya canjeaste el premio de este nivel. Acumula puntos para desbloquear el siguiente.')
      return
    }

    if (solicitudesPendientesCliente.some((item) => (
      item.origen === ORIGEN_PREMIO_CATALOGO
      && (item.premioId === regla.id || item.premioCatalogoId === regla.id)
    ))) {
      setError('Ya tienes una solicitud pendiente para este premio.')
      return
    }

    const nivelOcupado = solicitudesPendientesCliente.some((item) => (
      item.nivelId === nivelRegla
      && item.premioId !== regla.id
      && item.premioCatalogoId !== regla.id
    )) || resolveClientPrizes(cliente.premios).some((premio) => (
      premio.nivelId === nivelRegla
      && (
        premio.statusEfectivo === STATUS_PENDIENTE
        || premio.statusEfectivo === STATUS_EN_SOLICITUD
        || premio.statusEfectivo === STATUS_CANJEADO
      )
      && premio.premioId !== regla.id
      && premio.id !== regla.id
    ))

    if (nivelOcupado) {
      setError('Ya elegiste otro premio de este nivel. Cancélalo o espera la resolución para elegir otro.')
      return
    }

    setCanjeLoadingId(`catalogo:${regla.id}`)
    setError('')
    setSuccessMessage('')

    try {
      const data = await callClientApi('redeem', { origen: 'catalogo', premioId: regla.id })
      setCliente(data.client)
      setSolicitudesPendientesCliente(data.solicitudesPendientes || [])
      setPremioSeleccionadoId(null)
      setSuccessMessage(`Solicitud enviada para "${regla.nombre}". Espera la aprobación del administrador.`)
    } catch (err) {
      setError(err.message || 'No se pudo enviar la solicitud de canje. Intenta de nuevo.')
      console.error(err)
    } finally {
      setCanjeLoadingId(null)
    }
  }

  const puntosDisponibles = cliente?.puntos ?? 0
  const nivelDetalle = cliente
    ? obtenerNivelClienteDetalle(puntosDisponibles, clientLevels)
    : null
  const nivelCliente = cliente
    ? obtenerNivelCliente(puntosDisponibles, clientLevels)
    : 'Sin nivel'
  const progresoNivel = cliente
    ? obtenerProgresoEntreNiveles(puntosDisponibles, clientLevels)
    : null
  const premiosCliente = cliente ? resolveClientPrizes(cliente.premios) : []
  const nivelesCanjeados = cliente ? obtenerNivelesCanjeados(cliente.premios) : new Set()
  const nivelActualYaCanjeado = Boolean(nivelDetalle && nivelesCanjeados.has(nivelDetalle.id))
  const premiosVisibles = premiosCliente.filter(
    (premio) => premio.statusEfectivo !== STATUS_CANJEADO,
  )
  // Solo premios del nivel actual y solo si ese nivel aún no fue canjeado.
  // Debajo del umbral Bronce => sin nivel => sin premios de catálogo.
  const umbralBronce = clientLevels.find((level) => level.id === 'bronce')?.puntosMinimos ?? 10
  const premiosDelNivelActual = nivelDetalle && !nivelActualYaCanjeado
    ? prizeRules.filter((regla) => regla.nivelId === nivelDetalle.id)
    : []
  const premiosProximosNivel = progresoNivel?.nivelSiguiente
    ? prizeRules.filter((regla) => (
      regla.nivelId === progresoNivel.nivelSiguiente.id
      && !nivelesCanjeados.has(regla.nivelId)
    ))
    : []
  const idsPremiosAsignadosActivos = new Set(
    premiosVisibles
      .map((premio) => premio.premioId || premio.id)
      .filter(Boolean),
  )

  // Un solo premio por nivel: pendiente, en solicitud o ya canjeado bloquea el resto.
  const nivelesOcupados = new Map()
  premiosCliente.forEach((premio) => {
    if (
      (premio.statusEfectivo === STATUS_PENDIENTE
        || premio.statusEfectivo === STATUS_EN_SOLICITUD
        || premio.statusEfectivo === STATUS_CANJEADO)
      && premio.nivelId
      && !nivelesOcupados.has(premio.nivelId)
    ) {
      nivelesOcupados.set(premio.nivelId, {
        tipo: premio.statusEfectivo === STATUS_CANJEADO ? 'canjeado' : 'asignado',
        id: premio.id,
        premioId: premio.premioId || premio.id,
      })
    }
  })
  solicitudesPendientesCliente.forEach((solicitud) => {
    if (!solicitud.nivelId || nivelesOcupados.has(solicitud.nivelId)) return
    nivelesOcupados.set(solicitud.nivelId, {
      tipo: 'solicitud',
      id: solicitud.premioCatalogoId || solicitud.premioId,
    })
  })

  const esPremioBloqueadoPorNivel = (nivelId, propioId, propioPremioId = null) => {
    if (!nivelId || !nivelesOcupados.has(nivelId)) return false
    const ocupante = nivelesOcupados.get(nivelId)
    if (ocupante.tipo === 'canjeado') return true
    return ocupante.id !== propioId && ocupante.id !== propioPremioId && ocupante.premioId !== propioId
  }

  const premioCatalogoSeleccionadoId = premioSeleccionadoId?.startsWith('catalogo:')
    ? premioSeleccionadoId.slice('catalogo:'.length)
    : null
  const nivelCatalogoSeleccionado = premioCatalogoSeleccionadoId
    ? (prizeRules.find((regla) => regla.id === premioCatalogoSeleccionadoId)?.nivelId || null)
    : null

  const filtrarCatalogoVisible = (reglas) => reglas.filter((regla) => {
    if (nivelesCanjeados.has(regla.nivelId)) return false

    const yaAsignadoActivo = idsPremiosAsignadosActivos.has(regla.id)
    if (yaAsignadoActivo) return false

    const ocupante = nivelesOcupados.get(regla.nivelId)
    if (ocupante) {
      if (ocupante.tipo === 'canjeado') return false
      // Nivel ya tomado por asignación/solicitud: solo el premio elegido queda visible.
      return ocupante.id === regla.id || ocupante.premioId === regla.id
    }

    // Al seleccionar un premio del nivel, los demás se ocultan hasta cambiar la elección.
    if (nivelCatalogoSeleccionado && regla.nivelId === nivelCatalogoSeleccionado) {
      return regla.id === premioCatalogoSeleccionadoId
    }

    return true
  })

  const premiosCatalogoVisibles = filtrarCatalogoVisible(premiosDelNivelActual)
  const totalPremiosVisibles = premiosVisibles.length + premiosCatalogoVisibles.length

  return (
    <main
      className="cliente-publico relative isolate min-h-screen overflow-x-hidden px-4 py-10 sm:px-6"
      style={{
        fontFamily: '"Manrope", sans-serif',
        backgroundColor: '#2f3033',
        backgroundImage:
          'radial-gradient(ellipse 110% 75% at 50% -20%, rgba(90, 92, 98, 0.55), transparent 60%),'
          + 'radial-gradient(ellipse 70% 55% at 100% 110%, rgba(36, 37, 40, 0.95), transparent 55%),'
          + 'radial-gradient(ellipse 55% 45% at -10% 85%, rgba(48, 49, 54, 0.8), transparent 50%),'
          + 'linear-gradient(165deg, #3a3b40 0%, #2f3033 28%, #242528 62%, #1a1b1e 100%)',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          backgroundImage:
            'radial-gradient(rgba(210, 210, 215, 0.16) 0.8px, transparent 0.9px),'
            + 'radial-gradient(rgba(150, 152, 158, 0.12) 0.7px, transparent 0.8px)',
          backgroundSize: '12px 12px, 24px 24px',
          backgroundPosition: '0 0, 6px 6px',
          opacity: 0.7,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          backgroundImage:
            'repeating-linear-gradient(122deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 8px),'
            + 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.18) 3px, rgba(0,0,0,0.18) 4px)',
          opacity: 0.55,
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-md">
        <header
          className="mb-10 text-center"
          style={{
            '--brand-title': '#c48a1a',
            '--brand-subtitle': '#c4b5a0',
            '--brand-rule': 'rgba(196, 138, 26, 0.5)',
          }}
        >
          <div className="mb-5 flex items-center justify-between gap-2">
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

          <div className="mx-auto flex w-full max-w-[210px] flex-col items-center sm:max-w-[240px]">
            <div
              className="relative w-full overflow-hidden rounded-[1.6rem] bg-[#141516] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.45)] ring-1 ring-white/10 animate-[brandIn_0.55s_ease-out] sm:p-5"
            >
              <div
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(220,38,38,0.14),transparent_62%)]"
                aria-hidden="true"
              />
              <img
                src="/vb-smoke-grill-logo.png"
                alt="VB Smoke & Grill"
                className="relative z-[1] mx-auto h-auto w-full max-h-[240px] select-none object-contain object-center mix-blend-lighten sm:max-h-[270px]"
                width={425}
                height={660}
                decoding="async"
                fetchPriority="high"
              />
            </div>
            <h1 className="sr-only">VB Smoke & Grill</h1>
          </div>

          <div
            className="mx-auto mt-5 h-px w-14"
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
            className="rounded-3xl border border-white/10 bg-black/55 p-5 shadow-2xl shadow-black/40 backdrop-blur-md sm:p-6"
            autoComplete="off"
          >
            <div className="space-y-4">
              <div>
                <label htmlFor="telefono-publico" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-amber-100/70">
                  Teléfono
                </label>
                <input
                  id="telefono-publico"
                  type="tel"
                  inputMode="tel"
                  name="telefono-cliente"
                  autoComplete="off"
                  value={telefono}
                  onChange={(event) => {
                    setTelefono(event.target.value)
                    setError('')
                    setSuccessMessage('')
                  }}
                  placeholder="Número de teléfono"
                  className="w-full rounded-xl border border-white/15 bg-transparent px-4 py-3 text-base text-amber-50 outline-none transition placeholder:text-stone-500 focus:border-amber-400/60 focus:bg-black/30"
                />
              </div>

              <div>
                <label htmlFor="contraseña-publico" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-amber-100/70">
                  Contraseña
                </label>
                <input
                  id="contraseña-publico"
                  type="password"
                  name="contraseña-cliente"
                  autoComplete="new-password"
                  value={contraseña}
                  onChange={(event) => {
                    setContraseña(event.target.value)
                    setError('')
                    setSuccessMessage('')
                  }}
                  placeholder="Contraseña"
                  className="w-full rounded-xl border border-white/15 bg-transparent px-4 py-3 text-base text-amber-50 outline-none transition placeholder:text-stone-500 focus:border-amber-400/60 focus:bg-black/30"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-5 w-full rounded-xl bg-gradient-to-r from-amber-700 to-orange-800 px-4 py-3.5 text-sm font-bold uppercase tracking-wide text-amber-50 transition hover:from-amber-600 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
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

        {modo === 'consulta' && !(cliente && busquedaHecha) ? (
          <footer className="mt-6 text-center leading-relaxed text-white">
            <p className="text-sm font-bold tracking-wide">Loyalty El Bajonazo</p>
            <p className="mt-2 text-xs">Todos los derechos reservados ©</p>
            <p className="mt-1 text-xs">Creado por: Eduardo Rivas Novoa</p>
          </footer>
        ) : null}

        {modo === 'registro' ? (
          <form
            onSubmit={handleRegister}
            className="rounded-3xl border border-white/10 bg-black/55 p-5 shadow-2xl shadow-black/40 backdrop-blur-md sm:p-6"
            autoComplete="off"
          >
            <div className="space-y-4">
              <div>
                <label htmlFor="nombre-registro-publico" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-amber-100/70">
                  Nombre
                </label>
                <input
                  id="nombre-registro-publico"
                  type="text"
                  name="nombre-cliente"
                  autoComplete="off"
                  value={nombreRegistro}
                  onChange={(event) => {
                    setNombreRegistro(event.target.value)
                    setError('')
                  }}
                  placeholder="Nombre completo"
                  className="w-full rounded-xl border border-white/15 bg-transparent px-4 py-3 text-base text-amber-50 outline-none transition placeholder:text-stone-500 focus:border-amber-400/60 focus:bg-black/30"
                />
              </div>

              <div>
                <label htmlFor="telefono-registro-publico" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-amber-100/70">
                  Teléfono
                </label>
                <input
                  id="telefono-registro-publico"
                  type="tel"
                  inputMode="tel"
                  name="telefono-registro"
                  autoComplete="off"
                  value={telefonoRegistro}
                  onChange={(event) => {
                    setTelefonoRegistro(event.target.value)
                    setError('')
                  }}
                  placeholder="Número de teléfono"
                  className="w-full rounded-xl border border-white/15 bg-transparent px-4 py-3 text-base text-amber-50 outline-none transition placeholder:text-stone-500 focus:border-amber-400/60 focus:bg-black/30"
                />
              </div>

              <div>
                <label htmlFor="contraseña-registro-publico" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-amber-100/70">
                  Contraseña
                </label>
                <input
                  id="contraseña-registro-publico"
                  type="password"
                  name="contraseña-registro"
                  autoComplete="new-password"
                  value={contraseñaRegistro}
                  onChange={(event) => {
                    setContraseñaRegistro(event.target.value)
                    setError('')
                  }}
                  placeholder={`Mínimo ${MIN_CLIENT_PASSWORD_LENGTH} caracteres`}
                  className="w-full rounded-xl border border-white/15 bg-transparent px-4 py-3 text-base text-amber-50 outline-none transition placeholder:text-stone-500 focus:border-amber-400/60 focus:bg-black/30"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={registroLoading}
              className="mt-5 w-full rounded-xl bg-gradient-to-r from-amber-700 to-orange-800 px-4 py-3.5 text-sm font-bold uppercase tracking-wide text-amber-50 transition hover:from-amber-600 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {registroLoading ? 'Registrando...' : 'Crear mi cuenta'}
            </button>

            <button
              type="button"
              onClick={abrirConsulta}
              className="mt-3 w-full rounded-xl border border-white/15 bg-transparent px-4 py-3 text-sm font-semibold text-amber-100/85 transition hover:border-amber-400/40 hover:bg-black/30"
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
                  {cliente.telefono ? (
                    <p className="mt-1 text-sm text-stone-300/75">{cliente.telefono}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <button
                    type="button"
                    onClick={abrirEditarPerfil}
                    className="rounded-full border border-amber-500/45 bg-amber-950/50 px-3 py-1.5 text-[11px] font-semibold text-amber-100 transition hover:border-amber-400/60 hover:bg-amber-900/55"
                  >
                    Editar datos
                  </button>
                  <button
                    type="button"
                    onClick={cerrarSesionCliente}
                    className="rounded-full border border-amber-700/40 bg-black/40 px-3 py-1.5 text-[11px] font-semibold text-amber-100/85 transition hover:border-amber-500/50 hover:bg-black/60"
                  >
                    Cerrar sesión
                  </button>
                </div>
              </div>
            </div>

            {showEditPerfil ? (
              <article className="rounded-3xl border border-amber-700/40 bg-gradient-to-b from-black/85 to-stone-950/90 p-5 shadow-xl shadow-black/40 backdrop-blur-md">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-amber-200/55">
                      Mi perfil
                    </p>
                    <h3 className="mt-1 text-xl font-extrabold text-amber-50">
                      Editar mis datos
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={cerrarEditarPerfil}
                    disabled={editLoading}
                    className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-stone-300 transition hover:border-amber-400/40 hover:text-amber-100 disabled:opacity-50"
                  >
                    Cerrar
                  </button>
                </div>

                <form onSubmit={handleGuardarPerfil} className="space-y-4" autoComplete="off">
                  <div>
                    <label htmlFor="edit-nombre-cliente" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-amber-100/70">
                      Nombre
                    </label>
                    <input
                      id="edit-nombre-cliente"
                      type="text"
                      value={editNombre}
                      onChange={(event) => {
                        setEditNombre(event.target.value)
                        setError('')
                      }}
                      placeholder="Tu nombre"
                      className="w-full rounded-xl border border-white/15 bg-transparent px-4 py-3 text-base text-amber-50 outline-none transition placeholder:text-stone-500 focus:border-amber-400/60 focus:bg-black/30"
                    />
                  </div>

                  <div>
                    <label htmlFor="edit-telefono-cliente" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-amber-100/70">
                      Teléfono
                    </label>
                    <input
                      id="edit-telefono-cliente"
                      type="tel"
                      inputMode="tel"
                      value={editTelefono}
                      onChange={(event) => {
                        setEditTelefono(event.target.value)
                        setError('')
                      }}
                      placeholder="Número de teléfono"
                      className="w-full rounded-xl border border-white/15 bg-transparent px-4 py-3 text-base text-amber-50 outline-none transition placeholder:text-stone-500 focus:border-amber-400/60 focus:bg-black/30"
                    />
                  </div>

                  <div>
                    <label htmlFor="edit-contraseña-cliente" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-amber-100/70">
                      Nueva contraseña (opcional)
                    </label>
                    <input
                      id="edit-contraseña-cliente"
                      type="password"
                      autoComplete="new-password"
                      value={editContraseña}
                      onChange={(event) => {
                        setEditContraseña(event.target.value)
                        setError('')
                      }}
                      placeholder={`Mínimo ${MIN_CLIENT_PASSWORD_LENGTH} caracteres`}
                      className="w-full rounded-xl border border-white/15 bg-transparent px-4 py-3 text-base text-amber-50 outline-none transition placeholder:text-stone-500 focus:border-amber-400/60 focus:bg-black/30"
                    />
                    <p className="mt-1.5 text-xs text-stone-400">
                      Déjala vacía si no quieres cambiarla.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={editLoading}
                    className="w-full rounded-xl bg-gradient-to-r from-amber-600 to-orange-700 px-4 py-3 text-sm font-bold uppercase tracking-wide text-amber-50 transition hover:from-amber-500 hover:to-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {editLoading ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                </form>
              </article>
            ) : null}

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

            {progresoNivel ? (
              <article className="rounded-3xl border border-amber-800/30 bg-gradient-to-b from-black/80 to-stone-950/85 p-5 shadow-xl shadow-black/40 backdrop-blur-md">
                <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-amber-200/55">
                  Tu trayecto
                </p>
                <h3 className="mt-1 text-xl font-extrabold text-amber-50">
                  {progresoNivel.sinNivel
                    ? `Sin nivel → ${progresoNivel.nivelSiguiente?.nombre}`
                    : progresoNivel.esNivelMaximo
                      ? `Nivel máximo · ${progresoNivel.nivelActual?.nombre}`
                      : `${progresoNivel.nivelActual?.nombre} → ${progresoNivel.nivelSiguiente?.nombre}`}
                </h3>
                <p className="mt-2 text-sm text-stone-300/70">
                  {progresoNivel.sinNivel
                    ? `Tienes ${progresoNivel.puntosActuales.toLocaleString('es-CR')} pts · Necesitas ${progresoNivel.puntosObjetivo.toLocaleString('es-CR')} pts para obtener nivel ${progresoNivel.nivelSiguiente?.nombre} (te faltan ${progresoNivel.puntosFaltantes.toLocaleString('es-CR')} pts).`
                    : progresoNivel.esNivelMaximo
                      ? 'Ya alcanzaste el nivel más alto del programa.'
                      : `Tienes ${progresoNivel.puntosActuales.toLocaleString('es-CR')} pts · Te faltan ${progresoNivel.puntosFaltantes.toLocaleString('es-CR')} pts para ${progresoNivel.nivelSiguiente?.nombre} (${progresoNivel.puntosObjetivo.toLocaleString('es-CR')} pts).`}
                </p>

                {(() => {
                  const topeTrayecto = Math.max(
                    1,
                    ...progresoNivel.niveles.map((nivel) => Number(nivel.puntosMinimos) || 0),
                  )
                  const porcentajeBarra = Math.min(
                    100,
                    Math.round((progresoNivel.puntosActuales / topeTrayecto) * 100),
                  )
                  const posicionNivel = (puntosMinimos) => (
                    Math.min(100, Math.max(0, ((Number(puntosMinimos) || 0) / topeTrayecto) * 100))
                  )

                  return (
                    <>
                      <div className="relative mt-6 px-1 pt-1">
                        <div className="relative h-3 overflow-hidden rounded-full bg-stone-900/90 ring-1 ring-white/10">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-600 via-orange-500 to-amber-300 transition-[width] duration-500 ease-out"
                            style={{ width: `${porcentajeBarra}%` }}
                          />
                        </div>

                        <div className="pointer-events-none absolute inset-x-1 top-1/2 -translate-y-1/2">
                          {progresoNivel.niveles.map((nivel, index) => {
                            const alcanzado = puntosDisponibles >= nivel.puntosMinimos
                            const esActual = nivel.id === progresoNivel.nivelActual?.id
                            const left = posicionNivel(nivel.puntosMinimos)
                            const alInicio = left <= 0
                            const alFinal = left >= 100

                            return (
                              <div
                                key={nivel.id}
                                className="absolute top-1/2 -translate-y-1/2"
                                style={{
                                  left: `${left}%`,
                                  transform: alInicio
                                    ? 'translate(0, -50%)'
                                    : alFinal
                                      ? 'translate(-100%, -50%)'
                                      : 'translate(-50%, -50%)',
                                }}
                              >
                                <div
                                  className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold shadow-md ${
                                    esActual
                                      ? 'bg-amber-500 text-stone-950 ring-2 ring-amber-200/70'
                                      : alcanzado
                                        ? 'bg-emerald-600/90 text-emerald-50'
                                        : 'bg-stone-800 text-stone-400 ring-1 ring-stone-600/60'
                                  }`}
                                >
                                  {index + 1}
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        <div className="relative mt-5 h-10">
                          {progresoNivel.niveles.map((nivel) => {
                            const alcanzado = puntosDisponibles >= nivel.puntosMinimos
                            const esActual = nivel.id === progresoNivel.nivelActual?.id
                            const left = posicionNivel(nivel.puntosMinimos)
                            const alInicio = left <= 0
                            const alFinal = left >= 100

                            return (
                              <div
                                key={`label-${nivel.id}`}
                                className="absolute top-0 flex w-16 flex-col items-center"
                                style={{
                                  left: `${left}%`,
                                  transform: alInicio
                                    ? 'translateX(0)'
                                    : alFinal
                                      ? 'translateX(-100%)'
                                      : 'translateX(-50%)',
                                }}
                              >
                                <span
                                  className={`truncate text-[11px] font-semibold ${
                                    esActual
                                      ? 'text-amber-200'
                                      : alcanzado
                                        ? 'text-emerald-200/80'
                                        : 'text-stone-500'
                                  }`}
                                >
                                  {nivel.nombre}
                                </span>
                                <span className="text-[10px] text-stone-500">
                                  {nivel.puntosMinimos.toLocaleString('es-CR')} pts
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-xs font-semibold text-stone-400">
                        <span>
                          Ahora: {progresoNivel.puntosActuales.toLocaleString('es-CR')} pts
                        </span>
                        <span className="text-amber-200">
                          {porcentajeBarra}% del trayecto
                        </span>
                        <span>
                          {progresoNivel.esNivelMaximo
                            ? 'Máximo'
                            : `Meta: ${progresoNivel.nivelSiguiente?.nombre} ${progresoNivel.puntosObjetivo.toLocaleString('es-CR')} pts`}
                        </span>
                      </div>
                    </>
                  )
                })()}
              </article>
            ) : null}

            <article className="rounded-3xl border border-amber-800/30 bg-gradient-to-b from-black/80 to-stone-950/85 p-5 shadow-xl shadow-black/40 backdrop-blur-md sm:p-6">
              <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-amber-200/55">
                Premios
              </p>
              <h3 className="mt-1 text-xl font-extrabold text-amber-50">
                {nivelDetalle
                  ? `Premios de tu nivel ${nivelCliente}`
                  : 'Premios · Sin nivel aún'}
              </h3>
              <p className="mt-2 text-sm text-stone-300/70">
                {nivelDetalle
                  ? nivelActualYaCanjeado
                    ? `Ya canjeaste el premio de ${nivelCliente}. Sigue acumulando puntos con tus compras para el siguiente nivel.`
                    : 'Elige un solo premio de tu nivel actual. Canjearlo no resta puntos: tu trayectoria sigue con las compras.'
                  : `Con menos de ${umbralBronce.toLocaleString('es-CR')} pts aún no tienes nivel. Al llegar a ${umbralBronce.toLocaleString('es-CR')} pts desbloqueas Bronce y sus premios.`}
              </p>

              <ul className="mt-4 space-y-3">
                {totalPremiosVisibles === 0 && premiosProximosNivel.length === 0 ? (
                  <li className="rounded-2xl border border-dashed border-amber-800/35 bg-black/40 px-4 py-5 text-center text-sm text-stone-400">
                    {nivelActualYaCanjeado
                      ? `Premio de ${nivelCliente} canjeado. Acumula puntos para desbloquear el siguiente nivel.`
                      : `Aún no hay premios configurados para tu nivel ${nivelCliente}.`}
                  </li>
                ) : null}

                {premiosVisibles.map((premio) => {
                  const status = premio.statusEfectivo
                  const esPendiente = status === STATUS_PENDIENTE
                  const esEnSolicitud = status === STATUS_EN_SOLICITUD
                  const esVencido = status === STATUS_VENCIDO
                  const bloqueadoPorNivel = esPremioBloqueadoPorNivel(
                    premio.nivelId,
                    premio.id,
                    premio.premioId,
                  )
                  const diasRestantes = diasRestantesPremio(premio)
                  const estaSeleccionado = premioSeleccionadoId === premio.id
                  const enviando = canjeLoadingId === premio.id
                  const sePuedeElegir = esPendiente && !bloqueadoPorNivel

                  return (
                    <li key={`asignado-${premio.id}`}>
                      <div
                        role={sePuedeElegir ? 'button' : undefined}
                        tabIndex={sePuedeElegir ? 0 : undefined}
                        onClick={() => {
                          if (sePuedeElegir) {
                            setPremioSeleccionadoId(premio.id)
                            setError('')
                          }
                        }}
                        onKeyDown={(event) => {
                          if (!sePuedeElegir) return
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
                              : bloqueadoPorNivel
                                ? 'border-stone-600/40 bg-stone-950/50 opacity-55'
                                : estaSeleccionado
                                  ? 'border-amber-400/70 bg-gradient-to-r from-amber-900/70 to-orange-950/60 ring-2 ring-amber-400/40'
                                  : 'border-amber-700/30 bg-gradient-to-r from-amber-950/50 to-stone-950/70 hover:border-amber-500/50'
                        } ${sePuedeElegir ? 'cursor-pointer' : ''}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-amber-50">{premio.nombre}</p>
                            {premio.descripcion ? (
                              <p className="mt-0.5 text-sm text-stone-400">{premio.descripcion}</p>
                            ) : null}
                            {premio.nivelId ? (
                              <p className="mt-1 text-xs font-semibold text-amber-200/70">
                                Premio de nivel {premio.nivelId}
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
                            {bloqueadoPorNivel ? (
                              <p className="mt-2 text-sm font-semibold text-stone-400">
                                Deshabilitado: ya elegiste otro premio de este nivel.
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
                                  : bloqueadoPorNivel
                                    ? 'bg-stone-500/20 text-stone-300 ring-1 ring-stone-400/40'
                                    : estaSeleccionado
                                      ? 'bg-amber-300/25 text-amber-100 ring-1 ring-amber-200/50'
                                      : 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/40'
                            }`}
                          >
                            {esVencido
                              ? 'Vencido'
                              : esEnSolicitud
                                ? 'En solicitud'
                                : bloqueadoPorNivel
                                  ? 'No disponible'
                                  : estaSeleccionado
                                    ? 'Seleccionado'
                                    : 'Asignado'}
                          </span>
                        </div>

                        {esPendiente ? (
                          <button
                            type="button"
                            disabled={canjeLoadingId !== null || !estaSeleccionado || bloqueadoPorNivel}
                            onClick={(event) => {
                              event.stopPropagation()
                              handleSolicitarCanjeAsignado(premio)
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
                })}

                {premiosCatalogoVisibles.length > 0 ? (
                  <li className="pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-200/60">
                    Disponibles para tu nivel
                  </li>
                ) : null}

                {premiosCatalogoVisibles.map((regla) => {
                  const selectionId = `catalogo:${regla.id}`
                  const estaSeleccionado = premioSeleccionadoId === selectionId
                  const enSolicitud = solicitudesPendientesCliente.some((item) => (
                    item.origen === ORIGEN_PREMIO_CATALOGO
                    && (item.premioId === regla.id || item.premioCatalogoId === regla.id)
                  ))
                  const bloqueadoPorNivel = esPremioBloqueadoPorNivel(regla.nivelId, regla.id, regla.id)
                  const puedeCanjear = !enSolicitud && !bloqueadoPorNivel
                  const enviando = canjeLoadingId === selectionId
                  const sePuedeElegir = !enSolicitud && !bloqueadoPorNivel
                  const esNivelActual = Boolean(nivelDetalle && regla.nivelId === nivelDetalle.id)

                  return (
                    <li key={`catalogo-${regla.id}`}>
                      <div
                        role={sePuedeElegir ? 'button' : undefined}
                        tabIndex={sePuedeElegir ? 0 : undefined}
                        onClick={() => {
                          if (!sePuedeElegir) return
                          setPremioSeleccionadoId(selectionId)
                          setError('')
                        }}
                        onKeyDown={(event) => {
                          if (!sePuedeElegir) return
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setPremioSeleccionadoId(selectionId)
                            setError('')
                          }
                        }}
                        className={`rounded-2xl border px-4 py-3 transition ${
                          enSolicitud
                            ? 'border-sky-500/40 bg-gradient-to-r from-sky-950/50 to-stone-950/70'
                            : bloqueadoPorNivel
                              ? 'border-stone-600/40 bg-stone-950/50 opacity-55'
                              : estaSeleccionado
                                ? 'cursor-pointer border-amber-400/70 bg-gradient-to-r from-amber-900/70 to-orange-950/60 ring-2 ring-amber-400/40'
                                : 'cursor-pointer border-amber-700/30 bg-gradient-to-r from-amber-950/50 to-stone-950/70 hover:border-amber-500/50'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-amber-50">{regla.nombre}</p>
                            {regla.descripcion ? (
                              <p className="mt-0.5 text-sm text-stone-400">{regla.descripcion}</p>
                            ) : null}
                            <p className="mt-1 text-xs font-semibold text-amber-200/70">
                              Nivel {regla.nivelId}
                              {esNivelActual ? ' · Tu nivel' : ''}
                              {' · No descuenta puntos'}
                            </p>
                            {enSolicitud ? (
                              <p className="mt-2 text-sm font-semibold text-sky-300">
                                Tu solicitud está en revisión por el administrador.
                              </p>
                            ) : bloqueadoPorNivel ? (
                              <p className="mt-2 text-sm font-semibold text-stone-400">
                                Deshabilitado: ya elegiste otro premio de este nivel.
                              </p>
                            ) : (
                              <p className="mt-2 text-sm font-semibold text-amber-300">
                                Disponible en tu nivel {nivelCliente}
                              </p>
                            )}
                          </div>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                              enSolicitud
                                ? 'bg-sky-400/15 text-sky-200 ring-1 ring-sky-300/40'
                                : bloqueadoPorNivel
                                  ? 'bg-stone-500/20 text-stone-300 ring-1 ring-stone-400/40'
                                  : estaSeleccionado
                                    ? 'bg-amber-300/25 text-amber-100 ring-1 ring-amber-200/50'
                                    : 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/40'
                            }`}
                          >
                            {enSolicitud
                              ? 'En solicitud'
                              : bloqueadoPorNivel
                                ? 'No disponible'
                                : estaSeleccionado
                                  ? 'Seleccionado'
                                  : 'Disponible'}
                          </span>
                        </div>

                        {enSolicitud ? (
                          <button
                            type="button"
                            disabled
                            className="mt-3 w-full cursor-not-allowed rounded-xl border border-sky-500/40 bg-sky-950/50 px-3 py-2.5 text-sm font-bold text-sky-100/90"
                          >
                            Esperando aprobación...
                          </button>
                        ) : (
                          <div className="mt-3 space-y-2">
                            <button
                              type="button"
                              disabled={canjeLoadingId !== null || !estaSeleccionado || !puedeCanjear}
                              onClick={(event) => {
                                event.stopPropagation()
                                handleSolicitarCanjeCatalogo(regla)
                              }}
                              className="w-full rounded-xl bg-gradient-to-r from-amber-600 to-orange-700 px-3 py-2.5 text-sm font-bold uppercase tracking-wide text-amber-50 transition hover:from-amber-500 hover:to-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {enviando ? 'Enviando...' : 'Canjear'}
                            </button>
                            {estaSeleccionado ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setPremioSeleccionadoId(null)
                                  setError('')
                                }}
                                className="w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 text-sm font-semibold text-amber-100/85 transition hover:border-amber-400/40 hover:bg-black/30"
                              >
                                Cambiar premio
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}

                {nivelActualYaCanjeado && premiosProximosNivel.length > 0 ? (
                  <li className="rounded-2xl border border-emerald-700/30 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100/90">
                    Premio de {nivelCliente} reclamado. Al llegar a{' '}
                    {progresoNivel?.nivelSiguiente?.nombre} (
                    {progresoNivel?.puntosObjetivo?.toLocaleString('es-CR')} pts) se habilitarán
                    nuevos premios.
                  </li>
                ) : null}

                {premiosProximosNivel.length > 0 ? (
                  <li className="pt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-stone-400">
                    Se desbloquean en {progresoNivel?.nivelSiguiente?.nombre}
                  </li>
                ) : null}

                {premiosProximosNivel.map((regla) => (
                  <li key={`proximo-${regla.id}`}>
                    <div className="rounded-2xl border border-stone-600/40 bg-stone-950/45 px-4 py-3 opacity-70">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-stone-200">{regla.nombre}</p>
                          {regla.descripcion ? (
                            <p className="mt-0.5 text-sm text-stone-500">{regla.descripcion}</p>
                          ) : null}
                          <p className="mt-2 text-sm font-semibold text-stone-400">
                            Requiere nivel {progresoNivel?.nivelSiguiente?.nombre}
                            {progresoNivel?.puntosFaltantes
                              ? ` · Faltan ${progresoNivel.puntosFaltantes.toLocaleString('es-CR')} pts`
                              : ''}
                          </p>
                        </div>
                        <span className="inline-flex rounded-full bg-stone-500/20 px-2.5 py-1 text-xs font-bold text-stone-300 ring-1 ring-stone-400/40">
                          Bloqueado
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
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
        @keyframes brandIn {
          from { opacity: 0; transform: scale(0.92) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </main>
  )
}

export default ClientePublico
