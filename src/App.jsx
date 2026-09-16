import { useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { auth, db } from './lib/firebase'
import {
  calcularAsignacionDesdeMonto,
  canRedeemAssignedPrize,
  DEFAULT_MONTO_POR_PUNTO,
  getAvailablePrizeRules,
  normalizeMontoPendiente,
  normalizeMontoPorPunto,
  normalizePrizeRules,
  parseMontoCompra,
  resolveClientPrizes,
  buildClienteUpdatesPorVencimiento,
  buildClienteUpdatesTrasCanjeAprobado,
  esCanjeDeNivelMaximo,
  normalizeClientPremios,
  obtenerNivelesCanjeados,
  ORIGEN_PREMIO_CATALOGO,
  SOLICITUD_APROBADA,
  SOLICITUD_PENDIENTE,
  SOLICITUD_RECHAZADA,
  STATUS_CANJEADO,
  STATUS_EN_SOLICITUD,
  STATUS_PENDIENTE,
  STATUS_VENCIDO,
} from './lib/prizeRules'
import {
  buildTrayectoriaCliente,
  clienteAlcanzaNivel,
  DEFAULT_CLIENT_LEVELS,
  normalizeClientLevels,
  obtenerNivelCliente,
  obtenerNivelPorId,
} from './lib/clientLevels'
import {
  hashClientPassword,
  MIN_CLIENT_PASSWORD_LENGTH,
  validateClientPassword,
} from './lib/clientPassword'
import {
  findClienteByTelefono,
  MSG_TELEFONO_YA_REGISTRADO_ADMIN,
  normalizeClientPhone,
} from './lib/clientPhone'
import ClientePublico from './ClientePublico'
import './App.css'

/** Link público para registro de clientes (QR admin). */
const PUBLIC_SITE_URL = (
  import.meta.env.VITE_PUBLIC_SITE_URL
  || 'https://sistema-fidelidad-omega.vercel.app'
).replace(/\/$/, '')

const initialPrizeRules = [
  {
    id: 'descuento-10',
    nombre: 'Descuento 10%',
    descripcion: 'Vale para tu próxima compra.',
    umbral: 500,
    puntosCosto: 0,
    nivelId: 'bronce',
  },
  {
    id: 'producto-gratis',
    nombre: 'Producto gratis',
    descripcion: 'Un producto sorpresa en tienda.',
    umbral: 1500,
    puntosCosto: 0,
    nivelId: 'plata',
  },
  {
    id: 'visita-premium',
    nombre: 'Visita premium',
    descripcion: 'Atención especial y beneficios exclusivos.',
    umbral: 2500,
    puntosCosto: 0,
    nivelId: 'oro',
  },
]

const ESTADO_ACTIVO = 'Activo'
const ESTADO_INACTIVO = 'Inactivo'
const DIAS_INACTIVIDAD_LIMITE = 60

const obtenerEstadoCliente = (cliente) => (
  cliente?.estado === ESTADO_INACTIVO ? ESTADO_INACTIVO : ESTADO_ACTIVO
)

const diasDesdeFecha = (fechaIso) => {
  if (!fechaIso) return null

  const fecha = new Date(fechaIso)

  if (Number.isNaN(fecha.getTime())) return null

  const diffMs = Date.now() - fecha.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

const aplicarReglaInactividad = async (clienteData, levels = DEFAULT_CLIENT_LEVELS) => {
  const puntos = clienteData.puntos ?? 0
  const estadoActual = obtenerEstadoCliente(clienteData)
  const diasInactivo = diasDesdeFecha(clienteData.fechaUltimaCompra)
  const debeInactivarPorTiempo = (
    diasInactivo !== null
    && diasInactivo > DIAS_INACTIVIDAD_LIMITE
    && estadoActual === ESTADO_ACTIVO
  )

  const montoPendiente = normalizeMontoPendiente(clienteData.montoPendientePuntos)
  // Al desactivar (auto) o si ya está inactivo con puntos, reiniciar saldo a 0.
  if (
    debeInactivarPorTiempo
    || (estadoActual === ESTADO_INACTIVO && (puntos > 0 || montoPendiente > 0))
  ) {
    const clienteDocRef = doc(db, 'clientes', clienteData.id)
    await updateDoc(clienteDocRef, {
      puntos: 0,
      montoPendientePuntos: 0,
      estado: ESTADO_INACTIVO,
    })

    return {
      ...clienteData,
      puntos: 0,
      montoPendientePuntos: 0,
      estado: ESTADO_INACTIVO,
    }
  }

  // Vencimiento de premios: si el Oro venció (u Oro ya canjeado sin activos), cierra ciclo.
  // Tener nivel Oro sin reclamar NO reinicia puntos.
  const cierrePorPremios = buildClienteUpdatesPorVencimiento({
    puntos,
    montoPendientePuntos: montoPendiente,
    premios: clienteData.premios,
    premiosCanjeados: clienteData.premiosCanjeados,
    levels,
  })

  if (cierrePorPremios.debePersistir && cierrePorPremios.updates) {
    const clienteDocRef = doc(db, 'clientes', clienteData.id)
    await updateDoc(clienteDocRef, cierrePorPremios.updates)

    return {
      ...clienteData,
      ...cierrePorPremios.updates,
      estado: estadoActual,
      _cicloReiniciadoPorVencimiento: cierrePorPremios.reinicioCiclo,
    }
  }

  return {
    ...clienteData,
    estado: estadoActual,
  }
}

const App = () => {
  const [vistaActual, setVistaActual] = useState('cliente')
  const [telefono, setTelefono] = useState('')
  const [cliente, setCliente] = useState(null)
  const [clientesCatalogo, setClientesCatalogo] = useState([])
  const [loading, setLoading] = useState(false)
  const busquedaAutoRef = useRef(0)
  const [updatingPoints, setUpdatingPoints] = useState(false)
  const [error, setError] = useState('')
  const [nombre, setNombre] = useState('')
  const [telefonoRegistro, setTelefonoRegistro] = useState('')
  const [contraseñaRegistro, setContraseñaRegistro] = useState('')
  const [contraseñaClienteAdmin, setContraseñaClienteAdmin] = useState('')
  const [registroLoading, setRegistroLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [rulesLoaded, setRulesLoaded] = useState(false)
  const [prizeRules, setPrizeRules] = useState(() => {
    if (typeof window === 'undefined') {
      return initialPrizeRules
    }

    const storedRules = window.localStorage.getItem('fidelidad-prize-rules')

    if (!storedRules) {
      return initialPrizeRules
    }

    try {
      return normalizePrizeRules(JSON.parse(storedRules))
    } catch {
      return initialPrizeRules
    }
  })
  const [purchaseAmount, setPurchaseAmount] = useState(1200)
  const [montoPorPunto, setMontoPorPunto] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_MONTO_POR_PUNTO
    }

    const storedRate = window.localStorage.getItem('fidelidad-monto-por-punto')
    return storedRate ? normalizeMontoPorPunto(storedRate) : DEFAULT_MONTO_POR_PUNTO
  })
  const [montoCompraAsignacion, setMontoCompraAsignacion] = useState('')
  const [ruleName, setRuleName] = useState('')
  const [ruleDescription, setRuleDescription] = useState('')
  const [ruleThreshold, setRuleThreshold] = useState('')
  const [rulePointsCost, setRulePointsCost] = useState('')
  const [ruleNivelId, setRuleNivelId] = useState('bronce')
  const [prizeLevelFilter, setPrizeLevelFilter] = useState('todos')
  const [editingRuleId, setEditingRuleId] = useState(null)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [configModalTab, setConfigModalTab] = useState('premios')
  const [clientLevels, setClientLevels] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_CLIENT_LEVELS
    }

    const storedLevels = window.localStorage.getItem('fidelidad-client-levels')
    if (!storedLevels) return DEFAULT_CLIENT_LEVELS

    try {
      return normalizeClientLevels(JSON.parse(storedLevels))
    } catch {
      return DEFAULT_CLIENT_LEVELS
    }
  })
  const [showRegisterModal, setShowRegisterModal] = useState(false)
  const [showEditClientModal, setShowEditClientModal] = useState(false)
  const [editNombre, setEditNombre] = useState('')
  const [editTelefono, setEditTelefono] = useState('')
  const [editContraseña, setEditContraseña] = useState('')
  const [editClientLoading, setEditClientLoading] = useState(false)
  const [showTransactionsModal, setShowTransactionsModal] = useState(false)
  const [transaccionesCliente, setTransaccionesCliente] = useState([])
  const [showEditPointsModal, setShowEditPointsModal] = useState(false)
  const [editPointsValue, setEditPointsValue] = useState('')
  const [editPointsLoading, setEditPointsLoading] = useState(false)
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [solicitudesPendientes, setSolicitudesPendientes] = useState([])
  const [qrLinkCopiado, setQrLinkCopiado] = useState(false)
  const [filtroEstadoClientes, setFiltroEstadoClientes] = useState('todos')
  const [filtroTextoClientes, setFiltroTextoClientes] = useState('')
  const [showClientesModal, setShowClientesModal] = useState(false)
  const [levelsSaving, setLevelsSaving] = useState(false)
  const [resolviendoSolicitud, setResolviendoSolicitud] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      setAuthReady(true)

      if (firebaseUser) {
        setVistaActual('admin')
      } else {
        setVistaActual('cliente')
        setShowConfigModal(false)
        setShowRegisterModal(false)
        setShowEditClientModal(false)
        setShowTransactionsModal(false)
        setShowEditPointsModal(false)
        setShowClientesModal(false)
        setSolicitudesPendientes([])
      }
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!user) {
      return undefined
    }

    const unsubscribe = onSnapshot(
      collection(db, 'clientes'),
      (snapshot) => {
        setClientesCatalogo(
          snapshot.docs.map((clienteDoc) => ({
            id: clienteDoc.id,
            ...clienteDoc.data(),
          })),
        )
      },
      (err) => {
        console.error(err)
      },
    )

    return unsubscribe
  }, [user])

  useEffect(() => {
    if (!user || !cliente?.id || !showTransactionsModal) {
      return undefined
    }

    const unsubscribe = onSnapshot(
      collection(db, 'clientes', cliente.id, 'transacciones'),
      (snapshot) => {
        const items = snapshot.docs
          .map((transactionDoc) => ({ id: transactionDoc.id, ...transactionDoc.data() }))
          .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
        setTransaccionesCliente(items)
      },
      (err) => {
        console.error(err)
        setError('No se pudieron cargar las transacciones del cliente.')
      },
    )

    return unsubscribe
  }, [user, cliente?.id, showTransactionsModal])

  useEffect(() => {
    if (!user) return undefined

    const solicitudesQuery = query(
      collection(db, 'solicitudesCanje'),
      where('status', '==', SOLICITUD_PENDIENTE),
    )

    const unsubscribe = onSnapshot(
      solicitudesQuery,
      (snapshot) => {
        const pendientes = snapshot.docs
          .map((solicitudDoc) => ({
            id: solicitudDoc.id,
            ...solicitudDoc.data(),
          }))
          .sort((a, b) => {
            const fechaA = new Date(a.fecha || 0).getTime()
            const fechaB = new Date(b.fecha || 0).getTime()
            return fechaA - fechaB
          })

        setSolicitudesPendientes(pendientes)
      },
      (err) => {
        console.error(err)
        setError('No se pudieron escuchar las solicitudes de canje en tiempo real.')
      },
    )

    return unsubscribe
  }, [user])

  const handleAdminLogin = async (event) => {
    event.preventDefault()

    const email = adminEmail.trim()
    const password = adminPassword

    if (!email || !password) {
      setAuthError('Ingresa correo y contraseña.')
      return
    }

    setAuthLoading(true)
    setAuthError('')

    try {
      await signInWithEmailAndPassword(auth, email, password)
      setShowAuthModal(false)
      setAdminEmail('')
      setAdminPassword('')
      setVistaActual('admin')
    } catch (err) {
      console.error(err)
      setAuthError('No se pudo iniciar sesión. Verifica tus credenciales.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleAdminLogout = async () => {
    setAuthError('')

    try {
      await signOut(auth)
      setShowAuthModal(false)
      setShowConfigModal(false)
      setShowRegisterModal(false)
      setShowEditClientModal(false)
      setShowTransactionsModal(false)
      cerrarEditPointsModal()
      setVistaActual('cliente')
    } catch (err) {
      console.error(err)
      setError('No se pudo cerrar la sesión. Intenta nuevamente.')
    }
  }

  const cerrarEditClientModal = () => {
    setShowEditClientModal(false)
    setEditNombre('')
    setEditTelefono('')
    setEditContraseña('')
    setEditClientLoading(false)
  }

  const cerrarEditPointsModal = () => {
    setShowEditPointsModal(false)
    setEditPointsValue('')
    setEditPointsLoading(false)
  }

  const abrirEditPointsModal = () => {
    if (!cliente) return
    setEditPointsValue(String(cliente.puntos ?? 0))
    setError('')
    setSuccessMessage('')
    setShowEditPointsModal(true)
  }

  const abrirEditClientModal = () => {
    if (!cliente) return
    setEditNombre(cliente.nombre || '')
    setEditTelefono(cliente.telefono || '')
    setEditContraseña('')
    setError('')
    setSuccessMessage('')
    setShowEditClientModal(true)
  }

  const resetBusquedaClienteUi = () => {
    setMontoCompraAsignacion('')
    setContraseñaClienteAdmin('')
    setShowEditClientModal(false)
    cerrarEditPointsModal()
    setShowTransactionsModal(false)
    setEditNombre('')
    setEditTelefono('')
    setEditContraseña('')
  }

  const cargarClienteSeleccionado = async (clienteData, { silencioso = false } = {}) => {
    if (!clienteData?.id) return

    const requestId = ++busquedaAutoRef.current
    setLoading(true)
    if (!silencioso) {
      setError('')
      setSuccessMessage('')
    }
    resetBusquedaClienteUi()

    try {
      const clienteResuelto = await aplicarReglaInactividad(clienteData, clientLevels)
      if (requestId !== busquedaAutoRef.current) return

      setCliente(clienteResuelto)
      setTelefono(String(clienteResuelto.telefono || clienteData.telefono || ''))

      if (
        clienteResuelto.estado === ESTADO_INACTIVO
        && (clienteData.puntos ?? 0) > 0
        && (clienteResuelto.puntos ?? 0) === 0
      ) {
        setSuccessMessage('Cliente inactivo por más de 60 días: sus puntos se reiniciaron a 0.')
      } else if (clienteResuelto._cicloReiniciadoPorVencimiento) {
        setSuccessMessage(
          'El premio Oro venció sin canjearse: el ciclo se reinició (puntos y compras en cero).',
        )
      }
    } catch (err) {
      if (requestId !== busquedaAutoRef.current) return
      setCliente(null)
      setError('No se pudo consultar el cliente. Intenta nuevamente.')
      console.error(err)
    } finally {
      if (requestId === busquedaAutoRef.current) {
        setLoading(false)
      }
    }
  }

  const handleSearch = async (event) => {
    event.preventDefault()

    const telefonoBuscado = telefono.trim()

    if (!telefonoBuscado) {
      setError('Ingresa un número de teléfono para buscar al cliente.')
      setCliente(null)
      return
    }

    const matchLocal = clientesCatalogo.find(
      (item) => String(item.telefono || '') === telefonoBuscado,
    )

    if (matchLocal) {
      await cargarClienteSeleccionado(matchLocal)
      return
    }

    setLoading(true)
    setError('')
    setSuccessMessage('')
    setCliente(null)
    resetBusquedaClienteUi()

    try {
      const clientesRef = collection(db, 'clientes')
      const clientesQuery = query(clientesRef, where('telefono', '==', telefonoBuscado))
      const snapshot = await getDocs(clientesQuery)

      if (snapshot.empty) {
        setError('No se encontró ningún cliente con ese teléfono.')
        setLoading(false)
        return
      }

      const clienteDoc = snapshot.docs[0]
      await cargarClienteSeleccionado({ id: clienteDoc.id, ...clienteDoc.data() })
    } catch (err) {
      setError('No se pudo consultar el cliente. Intenta nuevamente.')
      console.error(err)
      setLoading(false)
    }
  }

  const telefonoFiltro = telefono.trim()
  const clientesFiltrados = useMemo(() => {
    if (!telefonoFiltro) return []

    const filtro = telefonoFiltro.toLowerCase()
    return clientesCatalogo
      .filter((item) => String(item.telefono || '').toLowerCase().includes(filtro))
      .sort((a, b) => String(a.telefono || '').localeCompare(String(b.telefono || '')))
      .slice(0, 8)
  }, [clientesCatalogo, telefonoFiltro])

  useEffect(() => {
    if (!user || !telefonoFiltro) return undefined

    const exacto = clientesCatalogo.find(
      (item) => String(item.telefono || '') === telefonoFiltro,
    )

    if (!exacto) return undefined
    if (cliente?.id === exacto.id) return undefined

    const timer = window.setTimeout(() => {
      cargarClienteSeleccionado(exacto, { silencioso: true })
    }, 280)

    return () => window.clearTimeout(timer)
  }, [user, telefonoFiltro, clientesCatalogo, cliente?.id, clientLevels])

  const handleUpdatePoints = async (amount) => {
    if (!cliente?.id) return false

    if (obtenerEstadoCliente(cliente) === ESTADO_INACTIVO) {
      setError('El cliente está inactivo. Actívalo para acumular puntos.')
      setSuccessMessage('')
      return false
    }

    const pointsToAdd = Number(amount)

    if (!Number.isFinite(pointsToAdd) || pointsToAdd <= 0) {
      return false
    }

    setUpdatingPoints(true)
    setError('')

    try {
      const clienteDocRef = doc(db, 'clientes', cliente.id)
      const nextPoints = (cliente.puntos ?? 0) + pointsToAdd
      const fechaUltimaCompra = new Date().toISOString()

      await updateDoc(clienteDocRef, {
        puntos: nextPoints,
        fechaUltimaCompra,
        estado: ESTADO_ACTIVO,
      })
      setCliente((currentCliente) => (
        currentCliente
          ? {
              ...currentCliente,
              puntos: nextPoints,
              fechaUltimaCompra,
              estado: ESTADO_ACTIVO,
            }
          : currentCliente
      ))
      return true
    } catch (err) {
      setError('No se pudieron actualizar los puntos. Intenta nuevamente.')
      console.error(err)
      return false
    } finally {
      setUpdatingPoints(false)
    }
  }

  const handleSavePointsEdit = async (event) => {
    event.preventDefault()
    if (!cliente?.id) return

    const puntos = Number(editPointsValue)
    if (!Number.isFinite(puntos) || puntos < 0 || !Number.isInteger(puntos)) {
      setError('Ingresa una cantidad entera de puntos igual o mayor que cero.')
      return
    }

    setEditPointsLoading(true)
    setError('')
    setSuccessMessage('')

    try {
      const trayectoria = buildTrayectoriaCliente(puntos, clientLevels)
      const updates = {
        puntos,
        trayectoria,
        nivelId: trayectoria.nivelId,
        nivelNombre: trayectoria.nivelNombre,
      }
      await updateDoc(doc(db, 'clientes', cliente.id), updates)
      setCliente((currentCliente) => (
        currentCliente ? { ...currentCliente, ...updates } : currentCliente
      ))
      cerrarEditPointsModal()
      setSuccessMessage('Puntos del cliente actualizados correctamente.')
    } catch (err) {
      setError('No se pudieron actualizar los puntos del cliente.')
      console.error(err)
    } finally {
      setEditPointsLoading(false)
    }
  }

  const handleToggleClienteEstado = async () => {
    if (!cliente?.id) return

    const estadoActual = obtenerEstadoCliente(cliente)
    const nextEstado = estadoActual === ESTADO_INACTIVO ? ESTADO_ACTIVO : ESTADO_INACTIVO

    setUpdatingPoints(true)
    setError('')
    setSuccessMessage('')

    try {
      const clienteDocRef = doc(db, 'clientes', cliente.id)
      const updates = { estado: nextEstado }

      if (nextEstado === ESTADO_INACTIVO) {
        updates.puntos = 0
        updates.montoPendientePuntos = 0
      }

      if (nextEstado === ESTADO_ACTIVO) {
        updates.fechaUltimaCompra = new Date().toISOString()
      }

      await updateDoc(clienteDocRef, updates)
      setCliente((currentCliente) => (
        currentCliente
          ? { ...currentCliente, ...updates }
          : currentCliente
      ))
      setSuccessMessage(
        nextEstado === ESTADO_ACTIVO
          ? 'Cliente activado. Ya puede volver a acumular puntos.'
          : 'Cliente desactivado. Sus puntos se reiniciaron a 0.',
      )
    } catch (err) {
      setError('No se pudo actualizar el estado del cliente. Intenta nuevamente.')
      console.error(err)
    } finally {
      setUpdatingPoints(false)
    }
  }

  const handleUpdateClientLevel = (levelId, puntosMinimos) => {
    const nextPoints = Number(puntosMinimos)

    setClientLevels((currentLevels) => currentLevels.map((level) => (
      level.id === levelId
        ? {
            ...level,
            puntosMinimos: Number.isNaN(nextPoints) || nextPoints < 0 ? 0 : nextPoints,
          }
        : level
    )))
  }

  const handleSaveClientLevels = async () => {
    const bronceRaw = clientLevels.find((level) => level.id === 'bronce')
    const plataRaw = clientLevels.find((level) => level.id === 'plata')
    const oroRaw = clientLevels.find((level) => level.id === 'oro')
    const broncePts = Number(bronceRaw?.puntosMinimos)
    const plataPts = Number(plataRaw?.puntosMinimos)
    const oroPts = Number(oroRaw?.puntosMinimos)

    if (
      Number.isNaN(broncePts)
      || Number.isNaN(plataPts)
      || Number.isNaN(oroPts)
      || broncePts <= 0
      || plataPts <= broncePts
      || oroPts <= plataPts
    ) {
      setError('Los umbrales deben ser crecientes: Bronce < Plata < Oro, y Bronce mayor a 0.')
      setSuccessMessage('')
      return
    }

    const levels = normalizeClientLevels(clientLevels)

    setLevelsSaving(true)
    setError('')
    setSuccessMessage('')

    try {
      setClientLevels(levels)

      const rulesDocRef = doc(db, 'configuracionPremios', 'reglas')
      await setDoc(rulesDocRef, {
        reglas: normalizePrizeRules(prizeRules),
        niveles: levels,
        montoPorPunto: normalizeMontoPorPunto(montoPorPunto),
        updatedAt: new Date().toISOString(),
      }, { merge: true })

      if (typeof window !== 'undefined') {
        window.localStorage.setItem('fidelidad-client-levels', JSON.stringify(levels))
      }

      // Recalcular y persistir trayectoria de todos los clientes con los nuevos umbrales.
      const clientesSnap = await getDocs(collection(db, 'clientes'))
      const docs = clientesSnap.docs
      const CHUNK = 400

      for (let offset = 0; offset < docs.length; offset += CHUNK) {
        const batch = writeBatch(db)
        const slice = docs.slice(offset, offset + CHUNK)

        slice.forEach((clienteDoc) => {
          const data = clienteDoc.data()
          const trayectoria = buildTrayectoriaCliente(data.puntos ?? 0, levels)
          batch.update(clienteDoc.ref, {
            trayectoria,
            nivelId: trayectoria.nivelId,
            nivelNombre: trayectoria.nivelNombre,
          })
        })

        await batch.commit()
      }

      if (cliente?.id) {
        const trayectoriaActual = buildTrayectoriaCliente(cliente.puntos ?? 0, levels)
        setCliente((current) => (
          current
            ? {
                ...current,
                trayectoria: trayectoriaActual,
                nivelId: trayectoriaActual.nivelId,
                nivelNombre: trayectoriaActual.nivelNombre,
              }
            : current
        ))
      }

      setSuccessMessage(
        `Niveles actualizados. Trayectoria recalculada para ${docs.length} cliente${docs.length === 1 ? '' : 's'}.`,
      )
    } catch (err) {
      setError('No se pudieron guardar los niveles ni ajustar las trayectorias.')
      console.error(err)
    } finally {
      setLevelsSaving(false)
    }
  }

  const handleRestoreDefaultLevels = () => {
    setClientLevels(DEFAULT_CLIENT_LEVELS)
    setError('')
    setSuccessMessage('Umbrales restaurados a Bronce 10, Plata 30 y Oro 50. Guarda para aplicarlos a todos los clientes.')
  }

  const handleDeleteCliente = async () => {
    if (!cliente?.id) return

    const nombreCliente = cliente.nombre || 'este cliente'
    const telefonoCliente = cliente.telefono || 'sin teléfono'
    const confirmar = window.confirm(
      `¿Eliminar a "${nombreCliente}" (${telefonoCliente})?\n\nEsta acción no se puede deshacer. Se borrarán sus puntos, premios y datos del sistema.`,
    )

    if (!confirmar) return

    setUpdatingPoints(true)
    setError('')
    setSuccessMessage('')

    try {
      const clienteId = cliente.id
      const batch = writeBatch(db)

      batch.delete(doc(db, 'clientes', clienteId))

      solicitudesPendientes
        .filter((item) => item.clienteId === clienteId)
        .forEach((item) => {
          batch.delete(doc(db, 'solicitudesCanje', item.id))
        })

      await batch.commit()

      setCliente(null)
      setTelefono('')
      setMontoCompraAsignacion('')
      setContraseñaClienteAdmin('')
      setShowEditClientModal(false)
      setShowTransactionsModal(false)
      cerrarEditPointsModal()
      setSuccessMessage(`Cliente "${nombreCliente}" eliminado correctamente.`)
    } catch (err) {
      setError('No se pudo eliminar el cliente. Intenta nuevamente.')
      console.error(err)
    } finally {
      setUpdatingPoints(false)
    }
  }

  const handleAssignPurchasePoints = async () => {
    if (!cliente?.id) return

    if (obtenerEstadoCliente(cliente) === ESTADO_INACTIVO) {
      setError('El cliente está inactivo. Actívalo para acumular puntos.')
      setSuccessMessage('')
      return
    }

    const asignacion = calcularAsignacionDesdeMonto(
      montoCompraAsignacion,
      montoPorPunto,
      cliente.montoPendientePuntos,
    )

    if (asignacion.montoCompra <= 0) {
      setError('Ingresa un monto de compra válido.')
      setSuccessMessage('')
      return
    }

    setUpdatingPoints(true)
    setError('')
    setSuccessMessage('')

    try {
      const clienteDocRef = doc(db, 'clientes', cliente.id)
      const nextPoints = (cliente.puntos ?? 0) + asignacion.puntos
      const fechaUltimaCompra = new Date().toISOString()

      const compra = {
        tipo: 'compra',
        monto: asignacion.montoCompra,
        puntosOtorgados: asignacion.puntos,
        montoPendientePuntos: asignacion.montoPendienteNuevo,
        fecha: fechaUltimaCompra,
      }
      const batch = writeBatch(db)
      batch.update(clienteDocRef, {
        puntos: nextPoints,
        montoPendientePuntos: asignacion.montoPendienteNuevo,
        fechaUltimaCompra,
        estado: ESTADO_ACTIVO,
      })
      batch.set(doc(collection(db, 'clientes', cliente.id, 'transacciones')), compra)
      await batch.commit()

      setCliente((currentCliente) => (
        currentCliente
          ? {
              ...currentCliente,
              puntos: nextPoints,
              montoPendientePuntos: asignacion.montoPendienteNuevo,
              fechaUltimaCompra,
              estado: ESTADO_ACTIVO,
            }
          : currentCliente
      ))
      setMontoCompraAsignacion('')

      if (asignacion.puntos > 0) {
        const remanenteMsg = asignacion.montoPendienteNuevo > 0
          ? ` Quedan $${asignacion.montoPendienteNuevo.toLocaleString('es-CR')} para el próximo punto.`
          : ''
        setSuccessMessage(
          `Compra de $${asignacion.montoCompra.toLocaleString('es-CR')}: se asignaron ${asignacion.puntos.toLocaleString('es-CR')} punto(s).${remanenteMsg}`,
        )
      } else {
        setSuccessMessage(
          `Compra de $${asignacion.montoCompra.toLocaleString('es-CR')} acumulada. Progreso: $${asignacion.montoPendienteNuevo.toLocaleString('es-CR')} de $${asignacion.valorPunto.toLocaleString('es-CR')} para 1 punto.`,
        )
      }
    } catch (err) {
      setError('No se pudieron actualizar los puntos. Intenta nuevamente.')
      console.error(err)
    } finally {
      setUpdatingPoints(false)
    }
  }

  const handleAssignPrize = async (premio) => {
    if (!cliente?.id) return

    const puntosActuales = cliente.puntos ?? 0
    const nivelRequerido = obtenerNivelPorId(premio.nivelId, clientLevels)
    const nivelPremio = premio.nivelId || 'bronce'

    if (obtenerNivelesCanjeados(cliente.premios).has(nivelPremio)) {
      setError(`Este cliente ya canjeó un premio de nivel ${nivelRequerido.nombre} en el ciclo actual.`)
      return
    }

    if (!clienteAlcanzaNivel(puntosActuales, premio.nivelId, clientLevels)) {
      setError(`Este premio requiere nivel ${nivelRequerido.nombre} o superior.`)
      return
    }

    // Un premio por nivel: no descuenta puntos (la trayectoria sigue por compras).
    const yaTienePremioNivel = normalizeClientPremios(cliente.premios).some((item) => (
      (item.nivelId || 'bronce') === nivelPremio
      && item.status !== STATUS_CANJEADO
      && item.status !== STATUS_VENCIDO
    ))
    if (yaTienePremioNivel) {
      setError(`Este cliente ya tiene un premio activo de nivel ${nivelRequerido.nombre}.`)
      return
    }

    setUpdatingPoints(true)
    setError('')
    setSuccessMessage('')

    try {
      const clienteDocRef = doc(db, 'clientes', cliente.id)
      const premioAsignado = {
        id: crypto.randomUUID(),
        premioId: premio.id,
        nombre: premio.nombre,
        descripcion: premio.descripcion || '',
        puntosCosto: 0,
        nivelId: nivelPremio,
        fechaAsignacion: new Date().toISOString(),
        status: STATUS_PENDIENTE,
      }
      const nextPremios = [...normalizeClientPremios(cliente.premios), premioAsignado]

      await updateDoc(clienteDocRef, {
        premios: nextPremios,
      })
      setCliente((currentCliente) => (
        currentCliente
          ? { ...currentCliente, premios: nextPremios }
          : currentCliente
      ))
      setSuccessMessage(
        `Premio "${premio.nombre}" asignado (nivel ${nivelRequerido.nombre}). Los puntos de trayectoria no se modifican.`,
      )
    } catch (err) {
      setError('No se pudo asignar el premio. Intenta nuevamente.')
      console.error(err)
    } finally {
      setUpdatingPoints(false)
    }
  }

  const handleRedeemAssignedPrize = async (premioAsignado) => {
    if (!cliente?.id || !premioAsignado?.id) return

    if (!canRedeemAssignedPrize(premioAsignado)) {
      setError('Este premio está vencido, en solicitud o ya fue canjeado.')
      return
    }

    setUpdatingPoints(true)
    setError('')
    setSuccessMessage('')

    try {
      const clienteDocRef = doc(db, 'clientes', cliente.id)
      const nextPremios = normalizeClientPremios(cliente.premios).map((premio) => (
        premio.id === premioAsignado.id
          ? { ...premio, status: STATUS_CANJEADO, fechaCanje: new Date().toISOString() }
          : premio
      ))
      const nextRedeemed = (cliente.premiosCanjeados ?? 0) + 1
      const updates = buildClienteUpdatesTrasCanjeAprobado({
        puntosTrasCanje: cliente.puntos ?? 0,
        premiosTrasCanje: nextPremios,
        premiosCanjeados: nextRedeemed,
        levels: clientLevels,
      })
      const { reinicioCiclo, ...clienteUpdates } = updates
      delete clienteUpdates.motivoCierre

      await updateDoc(clienteDocRef, clienteUpdates)
      setCliente((currentCliente) => (
        currentCliente
          ? { ...currentCliente, ...clienteUpdates }
          : currentCliente
      ))
      setSuccessMessage(
        reinicioCiclo
          ? 'Premio Oro canjeado. Ciclo reiniciado: puntos y compras en cero.'
          : `Premio "${premioAsignado.nombre}" canjeado correctamente.${
            esCanjeDeNivelMaximo(premioAsignado.nivelId, clientLevels)
              ? ' Aún hay premios pendientes: el ciclo se reiniciará al reclamarlos o cuando venzan.'
              : ''
          }`,
      )
    } catch (err) {
      setError('No se pudo canjear el premio. Intenta nuevamente.')
      console.error(err)
    } finally {
      setUpdatingPoints(false)
    }
  }

  const handleCancelAssignedPrize = async (premioAsignado) => {
    if (!cliente?.id || !premioAsignado?.id) return

    const status = resolveClientPrizes([premioAsignado])[0]?.statusEfectivo
    if (status !== STATUS_PENDIENTE && status !== STATUS_EN_SOLICITUD) {
      setError('Solo se pueden cancelar premios pendientes o en solicitud.')
      return
    }

    setUpdatingPoints(true)
    setError('')
    setSuccessMessage('')

    try {
      const clienteDocRef = doc(db, 'clientes', cliente.id)
      const nextPremios = normalizeClientPremios(cliente.premios).filter(
        (premio) => premio.id !== premioAsignado.id,
      )
      const batch = writeBatch(db)

      batch.update(clienteDocRef, {
        premios: nextPremios,
      })

      if (premioAsignado.solicitudCanjeId) {
        batch.update(doc(db, 'solicitudesCanje', premioAsignado.solicitudCanjeId), {
          status: SOLICITUD_RECHAZADA,
          resueltoAt: new Date().toISOString(),
        })
      }

      await batch.commit()

      setCliente((currentCliente) => (
        currentCliente
          ? { ...currentCliente, premios: nextPremios }
          : currentCliente
      ))
      setSuccessMessage(
        `Premio "${premioAsignado.nombre}" cancelado. La trayectoria de puntos no se modifica.`,
      )
    } catch (err) {
      setError('No se pudo cancelar el premio. Intenta nuevamente.')
      console.error(err)
    } finally {
      setUpdatingPoints(false)
    }
  }

  const sincronizarClienteLocal = (clienteId, patch) => {
    setCliente((currentCliente) => (
      currentCliente?.id === clienteId
        ? { ...currentCliente, ...patch }
        : currentCliente
    ))
  }

  const handleAceptarSolicitudCanje = async (solicitud) => {
    if (!solicitud?.id || !solicitud?.clienteId || resolviendoSolicitud) return

    setResolviendoSolicitud(true)
    setError('')
    setSuccessMessage('')

    try {
      const clienteDocRef = doc(db, 'clientes', solicitud.clienteId)
      const clienteSnap = await getDoc(clienteDocRef)

      if (!clienteSnap.exists()) {
        setError('No se encontró el cliente de esta solicitud.')
        await updateDoc(doc(db, 'solicitudesCanje', solicitud.id), {
          status: SOLICITUD_RECHAZADA,
        })
        return
      }

      const clienteData = clienteSnap.data()
      const premiosActuales = normalizeClientPremios(clienteData.premios)
      const esCatalogo = solicitud.origen === ORIGEN_PREMIO_CATALOGO
      const premioAsignadoIdx = premiosActuales.findIndex(
        (premio) => premio.id === solicitud.premioId,
      )
      const puntosActuales = clienteData.puntos ?? 0
      const nivelSolicitud = solicitud.nivelId || 'bronce'
      const nivelesCanjeados = obtenerNivelesCanjeados(premiosActuales)

      if (nivelesCanjeados.has(nivelSolicitud)) {
        setError('Este cliente ya canjeó un premio de ese nivel en el ciclo actual.')
        await updateDoc(doc(db, 'solicitudesCanje', solicitud.id), {
          status: SOLICITUD_RECHAZADA,
          resueltoAt: new Date().toISOString(),
        })
        return
      }

      let nextPremios = premiosActuales
      const nextRedeemed = (clienteData.premiosCanjeados ?? 0) + 1
      const batch = writeBatch(db)

      if (esCatalogo || premioAsignadoIdx < 0) {
        // Canje por nivel: no resta puntos; solo marca el premio del nivel.
        nextPremios = [
          ...premiosActuales,
          {
            id: crypto.randomUUID(),
            premioId: solicitud.premioCatalogoId || solicitud.premioId,
            nombre: solicitud.premioNombre,
            descripcion: solicitud.premioDescripcion || '',
            puntosCosto: 0,
            nivelId: nivelSolicitud,
            fechaAsignacion: new Date().toISOString(),
            fechaCanje: new Date().toISOString(),
            status: STATUS_CANJEADO,
            solicitudCanjeId: solicitud.id,
          },
        ]
      } else {
        nextPremios = premiosActuales.map((premio) => (
          premio.id === solicitud.premioId
            ? {
                ...premio,
                status: STATUS_CANJEADO,
                fechaCanje: new Date().toISOString(),
                solicitudCanjeId: solicitud.id,
              }
            : premio
        ))
      }

      const updates = buildClienteUpdatesTrasCanjeAprobado({
        puntosTrasCanje: puntosActuales,
        premiosTrasCanje: nextPremios,
        premiosCanjeados: nextRedeemed,
        levels: clientLevels,
      })
      const { reinicioCiclo, ...clienteUpdates } = updates
      delete clienteUpdates.motivoCierre

      batch.update(clienteDocRef, clienteUpdates)

      if (reinicioCiclo) {
        solicitudesPendientes
          .filter((item) => (
            item.id !== solicitud.id
            && item.clienteId === solicitud.clienteId
          ))
          .forEach((item) => {
            batch.update(doc(db, 'solicitudesCanje', item.id), {
              status: SOLICITUD_RECHAZADA,
              resueltoAt: new Date().toISOString(),
              motivo: 'ciclo_reiniciado',
            })
          })
      }

      batch.update(doc(db, 'solicitudesCanje', solicitud.id), {
        status: SOLICITUD_APROBADA,
        resueltoAt: new Date().toISOString(),
      })
      await batch.commit()

      sincronizarClienteLocal(solicitud.clienteId, clienteUpdates)
      setSuccessMessage(
        reinicioCiclo
          ? `Canje Oro aprobado: ${solicitud.clienteNombre} · Ciclo reiniciado (puntos y compras en cero).`
          : esCanjeDeNivelMaximo(nivelSolicitud, clientLevels)
            ? `Canje Oro aprobado: ${solicitud.clienteNombre}. Aún hay premios pendientes; el ciclo se reiniciará al reclamarlos o cuando venzan.`
            : `Canje aprobado: ${solicitud.clienteNombre} · ${solicitud.premioNombre}`,
      )
    } catch (err) {
      setError('No se pudo aprobar la solicitud de canje.')
      console.error(err)
    } finally {
      setResolviendoSolicitud(false)
    }
  }

  const handleCancelarSolicitudCanje = async (solicitud) => {
    if (!solicitud?.id || !solicitud?.clienteId || resolviendoSolicitud) return

    setResolviendoSolicitud(true)
    setError('')
    setSuccessMessage('')

    try {
      const clienteDocRef = doc(db, 'clientes', solicitud.clienteId)
      const clienteSnap = await getDoc(clienteDocRef)
      const batch = writeBatch(db)
      let nextPremios = null

      if (clienteSnap.exists() && solicitud.origen !== ORIGEN_PREMIO_CATALOGO) {
        const clienteData = clienteSnap.data()
        nextPremios = normalizeClientPremios(clienteData.premios).map((premio) => (
          premio.id === solicitud.premioId && premio.status === STATUS_EN_SOLICITUD
            ? {
                ...premio,
                status: STATUS_PENDIENTE,
                solicitudCanjeId: null,
              }
            : premio
        ))

        batch.update(clienteDocRef, {
          premios: nextPremios,
        })
      }

      batch.update(doc(db, 'solicitudesCanje', solicitud.id), {
        status: SOLICITUD_RECHAZADA,
        resueltoAt: new Date().toISOString(),
      })
      await batch.commit()

      if (nextPremios) {
        sincronizarClienteLocal(solicitud.clienteId, {
          premios: nextPremios,
        })
      }

      setSuccessMessage(
        `Solicitud rechazada: ${solicitud.clienteNombre} · ${solicitud.premioNombre}`,
      )
    } catch (err) {
      setError('No se pudo rechazar la solicitud de canje.')
      console.error(err)
    } finally {
      setResolviendoSolicitud(false)
    }
  }

  const resetPrizeRuleForm = () => {
    setEditingRuleId(null)
    setRuleName('')
    setRuleDescription('')
    setRuleThreshold('')
    setRulePointsCost('')
    setRuleNivelId('bronce')
  }

  const handleAddPrizeRule = (event) => {
    event.preventDefault()

    const name = ruleName.trim()
    const description = ruleDescription.trim()
    const threshold = Number(ruleThreshold)
    const pointsCost = rulePointsCost === '' ? 0 : Number(rulePointsCost)
    const nivelId = obtenerNivelPorId(ruleNivelId, clientLevels).id

    if (!name || !description || Number.isNaN(threshold) || Number.isNaN(pointsCost) || threshold <= 0 || pointsCost < 0) {
      setError('Completa nombre, descripción, umbral y nivel con valores válidos.')
      return
    }

    if (editingRuleId) {
      setPrizeRules((currentRules) => currentRules.map((rule) => (
        rule.id === editingRuleId
          ? {
            ...rule,
            nombre: name,
            descripcion: description,
            umbral: threshold,
            puntosCosto: pointsCost,
            nivelId,
          }
          : rule
      )))
      setSuccessMessage('¡Regla de premio actualizada correctamente!')
    } else {
      const newRule = {
        id: crypto.randomUUID(),
        nombre: name,
        descripcion: description,
        umbral: threshold,
        puntosCosto: pointsCost,
        nivelId,
      }

      setPrizeRules((currentRules) => [...currentRules, newRule])
      setSuccessMessage('¡Regla de premio agregada correctamente!')
    }

    resetPrizeRuleForm()
    setError('')
  }

  const handleEditRule = (rule) => {
    setEditingRuleId(rule.id)
    setRuleName(rule.nombre)
    setRuleDescription(rule.descripcion)
    setRuleThreshold(String(rule.umbral))
    setRulePointsCost(String(rule.puntosCosto))
    setRuleNivelId(rule.nivelId || 'bronce')
    setError('')
    setSuccessMessage('')
  }

  const handleDeleteRule = (ruleId) => {
    setPrizeRules((currentRules) => currentRules.filter((rule) => rule.id !== ruleId))
    if (editingRuleId === ruleId) {
      resetPrizeRuleForm()
    }
    setSuccessMessage('¡Regla de premio eliminada correctamente!')
    setError('')
  }

  const handleRestoreDefaultRules = () => {
    setPrizeRules(initialPrizeRules)
    resetPrizeRuleForm()
    setSuccessMessage('¡Reglas restauradas a los valores por defecto!')
    setError('')
  }

  const handleSaveClientEdit = async (event) => {
    event.preventDefault()

    if (!cliente?.id) return

    const nombreTrim = editNombre.trim()
    const telefonoTrim = normalizeClientPhone(editTelefono)
    const passwordRaw = editContraseña.trim()

    if (!nombreTrim || !telefonoTrim) {
      setError('Completa nombre y teléfono para guardar los cambios.')
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

    setEditClientLoading(true)
    setError('')
    setSuccessMessage('')

    try {
      if (telefonoTrim !== normalizeClientPhone(cliente.telefono)) {
        const existente = await findClienteByTelefono(telefonoTrim)
        if (existente && existente.id !== cliente.id) {
          setError(MSG_TELEFONO_YA_REGISTRADO_ADMIN)
          return
        }
      }

      const updates = {
        nombre: nombreTrim,
        telefono: telefonoTrim,
      }

      if (passwordCheck) {
        updates.contraseña = await hashClientPassword(passwordCheck.password)
      }

      await updateDoc(doc(db, 'clientes', cliente.id), updates)

      setCliente((current) => (
        current
          ? {
              ...current,
              ...updates,
            }
          : current
      ))
      setTelefono(telefonoTrim)
      cerrarEditClientModal()
      setSuccessMessage(`Datos de "${nombreTrim}" actualizados correctamente.`)
    } catch (err) {
      setError('No se pudieron guardar los cambios del cliente.')
      console.error(err)
    } finally {
      setEditClientLoading(false)
    }
  }

  const handleSetClientPassword = async (event) => {
    event.preventDefault()

    if (!cliente?.id) return

    const passwordCheck = validateClientPassword(contraseñaClienteAdmin)
    if (!passwordCheck.ok) {
      setError(passwordCheck.error)
      setSuccessMessage('')
      return
    }

    setUpdatingPoints(true)
    setError('')
    setSuccessMessage('')

    try {
      const contraseñaHash = await hashClientPassword(passwordCheck.password)
      await updateDoc(doc(db, 'clientes', cliente.id), {
        contraseña: contraseñaHash,
      })
      setCliente((current) => (
        current ? { ...current, contraseña: contraseñaHash } : current
      ))
      setContraseñaClienteAdmin('')
      setSuccessMessage(`Contraseña actualizada para ${cliente.nombre}.`)
    } catch (err) {
      setError('No se pudo actualizar la contraseña del cliente.')
      console.error(err)
    } finally {
      setUpdatingPoints(false)
    }
  }

  const handleRegisterClient = async (event) => {
    event.preventDefault()

    const nombreTrim = nombre.trim()
    const telefonoTrim = normalizeClientPhone(telefonoRegistro)
    const passwordCheck = validateClientPassword(contraseñaRegistro)

    if (!nombreTrim || !telefonoTrim) {
      setError('Completa nombre, teléfono y contraseña para registrar al cliente.')
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
      const existente = await findClienteByTelefono(telefonoTrim)
      if (existente) {
        setError(MSG_TELEFONO_YA_REGISTRADO_ADMIN)
        return
      }

      const clientesRef = collection(db, 'clientes')
      const contraseñaHash = await hashClientPassword(passwordCheck.password)

      await addDoc(clientesRef, {
        nombre: nombreTrim,
        telefono: telefonoTrim,
        contraseña: contraseñaHash,
        puntos: 0,
        montoPendientePuntos: 0,
        estado: ESTADO_ACTIVO,
        fechaUltimaCompra: new Date().toISOString(),
      })

      setNombre('')
      setTelefonoRegistro('')
      setContraseñaRegistro('')
      setShowRegisterModal(false)
      setSuccessMessage('¡Cliente registrado con éxito!')
    } catch (err) {
      setError('No se pudo registrar al cliente. Intenta nuevamente.')
      console.error(err)
    } finally {
      setRegistroLoading(false)
    }
  }

  useEffect(() => {
    const loadPrizeRules = async () => {
      try {
        const rulesDocRef = doc(db, 'configuracionPremios', 'reglas')
        const rulesDoc = await getDoc(rulesDocRef)

        if (rulesDoc.exists()) {
          const data = rulesDoc.data()
          const rulesFromFirestore = normalizePrizeRules(data.reglas || [])
          const rateFromFirestore = normalizeMontoPorPunto(data.montoPorPunto)
          const levelsFromFirestore = normalizeClientLevels(data.niveles || DEFAULT_CLIENT_LEVELS)
          setPrizeRules(rulesFromFirestore)
          setMontoPorPunto(rateFromFirestore)
          setClientLevels(levelsFromFirestore)

          if (typeof window !== 'undefined') {
            window.localStorage.setItem('fidelidad-prize-rules', JSON.stringify(rulesFromFirestore))
            window.localStorage.setItem('fidelidad-monto-por-punto', String(rateFromFirestore))
            window.localStorage.setItem('fidelidad-client-levels', JSON.stringify(levelsFromFirestore))
          }
        } else if (typeof window !== 'undefined') {
          const storedRules = window.localStorage.getItem('fidelidad-prize-rules')
          const storedRate = window.localStorage.getItem('fidelidad-monto-por-punto')
          const storedLevels = window.localStorage.getItem('fidelidad-client-levels')

          if (storedRules) {
            try {
              const parsedRules = normalizePrizeRules(JSON.parse(storedRules))
              setPrizeRules(parsedRules)
            } catch {
              setPrizeRules(initialPrizeRules)
            }
          }

          if (storedRate) {
            setMontoPorPunto(normalizeMontoPorPunto(storedRate))
          }

          if (storedLevels) {
            try {
              setClientLevels(normalizeClientLevels(JSON.parse(storedLevels)))
            } catch {
              setClientLevels(DEFAULT_CLIENT_LEVELS)
            }
          }
        }
      } catch (err) {
        console.error(err)
      } finally {
        setRulesLoaded(true)
      }
    }

    loadPrizeRules()
  }, [])

  useEffect(() => {
    if (!rulesLoaded || typeof window === 'undefined') {
      return
    }

    const rate = normalizeMontoPorPunto(montoPorPunto)
    const levels = normalizeClientLevels(clientLevels)
    const rules = normalizePrizeRules(prizeRules)

    window.localStorage.setItem('fidelidad-prize-rules', JSON.stringify(rules))
    window.localStorage.setItem('fidelidad-monto-por-punto', String(rate))
    window.localStorage.setItem('fidelidad-client-levels', JSON.stringify(levels))

    const syncPrizeRules = async () => {
      try {
        const rulesDocRef = doc(db, 'configuracionPremios', 'reglas')
        await setDoc(rulesDocRef, {
          reglas: rules,
          niveles: levels,
          montoPorPunto: rate,
          updatedAt: new Date().toISOString(),
        })
      } catch (err) {
        console.error(err)
      }
    }

    syncPrizeRules()
  }, [prizeRules, montoPorPunto, clientLevels, rulesLoaded])

  const puntosDisponibles = cliente ? (cliente.puntos ?? 0) : 0
  const premiosCanjeados = cliente ? (cliente.premiosCanjeados ?? 0) : 0
  const nivelCliente = cliente ? obtenerNivelCliente(puntosDisponibles, clientLevels) : 'Sin nivel'
  const configPrizeRules = getAvailablePrizeRules(prizeRules, purchaseAmount, {
    levels: clientLevels,
  })
  const availablePrizeRules = cliente
    ? getAvailablePrizeRules(prizeRules, purchaseAmount, {
      puntosCliente: puntosDisponibles,
      levels: clientLevels,
    })
    : configPrizeRules
  const filteredConfigPrizeRules = prizeLevelFilter === 'todos'
    ? configPrizeRules
    : configPrizeRules.filter((rule) => rule.nivelId === prizeLevelFilter)
  const premiosCliente = cliente ? resolveClientPrizes(cliente.premios) : []
  const montoPendienteCliente = normalizeMontoPendiente(cliente?.montoPendientePuntos)
  const asignacionCompraPreview = calcularAsignacionDesdeMonto(
    montoCompraAsignacion,
    montoPorPunto,
    montoPendienteCliente,
  )
  const puntosDesdeCompra = asignacionCompraPreview.puntos
  const puedeRegistrarCompra = parseMontoCompra(montoCompraAsignacion) > 0
  const initials = cliente?.nombre?.charAt(0)?.toUpperCase() ?? 'C'
  const estadoCliente = cliente ? obtenerEstadoCliente(cliente) : ESTADO_ACTIVO
  const clienteEstaInactivo = estadoCliente === ESTADO_INACTIVO
  const totalClientesActivos = clientesCatalogo.filter(
    (item) => obtenerEstadoCliente(item) === ESTADO_ACTIVO,
  ).length
  const totalClientesInactivos = Math.max(0, clientesCatalogo.length - totalClientesActivos)
  const clientesVista = useMemo(() => {
    const texto = filtroTextoClientes.trim().toLowerCase()

    return clientesCatalogo
      .filter((item) => {
        const estado = obtenerEstadoCliente(item)
        if (filtroEstadoClientes === 'activos' && estado !== ESTADO_ACTIVO) return false
        if (filtroEstadoClientes === 'inactivos' && estado !== ESTADO_INACTIVO) return false
        if (!texto) return true

        return (
          String(item.nombre || '').toLowerCase().includes(texto)
          || String(item.telefono || '').includes(texto)
        )
      })
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'))
  }, [clientesCatalogo, filtroEstadoClientes, filtroTextoClientes])

  const getPrizeStatusBadgeClass = (status) => {
    if (status === STATUS_CANJEADO) {
      return 'bg-slate-200 text-slate-600 ring-1 ring-slate-300/80'
    }
    if (status === STATUS_VENCIDO) {
      return 'bg-red-100 text-red-700 ring-1 ring-red-200'
    }
    if (status === STATUS_EN_SOLICITUD) {
      return 'bg-sky-100 text-sky-700 ring-1 ring-sky-200'
    }
    return 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
  }

  const solicitudActiva = solicitudesPendientes[0] || null

  const authModal = showAuthModal ? (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!authLoading) {
          setShowAuthModal(false)
          setAuthError('')
        }
      }}
    >
      <div
        className="config-card modal-card auth-modal-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="card-title-row">
          <div>
            <p className="eyebrow">Administración</p>
            <h3>Acceso Admin</h3>
          </div>
          <button
            type="button"
            className="close-modal-btn"
            disabled={authLoading}
            onClick={() => {
              setShowAuthModal(false)
              setAuthError('')
            }}
          >
            ✕
          </button>
        </div>
        <p className="card-description">
          Inicia sesión para gestionar premios y registrar clientes.
        </p>
        <form className="stacked-form" onSubmit={handleAdminLogin}>
          <label htmlFor="admin-email" className="field-label">
            Correo
          </label>
          <input
            id="admin-email"
            name="admin-email"
            type="email"
            autoComplete="username"
            value={adminEmail}
            onChange={(event) => {
              setAdminEmail(event.target.value)
              setAuthError('')
            }}
            placeholder="admin@ejemplo.com"
            className="input-modern"
            disabled={authLoading}
          />
          <label htmlFor="admin-password" className="field-label">
            Contraseña
          </label>
          <input
            id="admin-password"
            name="admin-password"
            type="password"
            autoComplete="current-password"
            value={adminPassword}
            onChange={(event) => {
              setAdminPassword(event.target.value)
              setAuthError('')
            }}
            placeholder="••••••••"
            className="input-modern"
            disabled={authLoading}
          />
          {authError ? <div className="feedback-card feedback-error">{authError}</div> : null}
          <button type="submit" disabled={authLoading} className="primary-btn">
            {authLoading ? 'Ingresando...' : 'Iniciar sesión'}
          </button>
        </form>
      </div>
    </div>
  ) : null

  if (!authReady) {
    return null
  }

  if (vistaActual === 'cliente' || !user) {
    return (
      <>
        <ClientePublico
          onAccesoAdmin={() => {
            setAuthError('')
            setShowAuthModal(true)
          }}
        />
        {authModal}
      </>
    )
  }

  return (
    <main className="app-shell">
      {authModal}
      <section className="app-card">
        <div className="app-title-bar">
          <div className="app-title-row">
            <h1 className="app-main-title">EL BAJONAZO</h1>
            <button
              type="button"
              className="admin-access-btn admin-access-btn-light"
              onClick={handleAdminLogout}
            >
              Cerrar Sesión
            </button>
          </div>
          <div className="app-intro">
            <p className="app-subtitle">Gestión inteligente de clientes, puntos y premios en una sola experiencia.</p>
            <div className="app-badges">
              <span className="app-badge-pill">⚡ Rápido</span>
              <span className="app-badge-pill">🎯 Premium</span>
              <span className="app-badge-pill">📊 Modular</span>
            </div>
          </div>
        </div>
        <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
          <div className="hero-panel">
            <div className="hero-badge">Sistema de fidelidad</div>
            <h1 className="hero-title">Convierte cada compra en una experiencia premium.</h1>
            <p className="hero-copy">
              Busca clientes, gestiona puntos y activa recompensas desde una sola vista elegante y rápida.
            </p>

            <div className="hero-stats">
              <div className="hero-stat-card">
                <span className="hero-stat-icon">⚡</span>
                <div>
                  <strong>Búsqueda instantánea</strong>
                  <p>Encuentra perfiles al instante con solo un teléfono.</p>
                </div>
              </div>
              <div className="hero-stat-card">
                <span className="hero-stat-icon">🎁</span>
                <div>
                  <strong>Premios dinámicos</strong>
                  <p>Canjea recompensas con una experiencia visual más clara.</p>
                </div>
              </div>
            </div>

            <div className="hero-metrics">
              <div className="metric-pill">
                <span>12+</span>
                <p>clientes activos</p>
              </div>
              <div className="metric-pill">
                <span>3</span>
                <p>tipos de premios</p>
              </div>
            </div>
          </div>

          <div className="info-panel">
            <form className="search-card" onSubmit={handleSearch}>
              <div className="search-card-header">
                <div>
                  <p className="eyebrow">Consulta rápida</p>
                  <h2>Buscar cliente</h2>
                </div>
                <div className="search-chip">
                  {loading ? 'Buscando...' : 'Filtro en vivo'}
                </div>
              </div>

              <label htmlFor="telefono" className="field-label">
                Número de teléfono
              </label>
              <div className="search-autocomplete">
                <input
                  id="telefono"
                  name="telefono"
                  type="tel"
                  inputMode="tel"
                  value={telefono}
                  onChange={(event) => {
                    const value = event.target.value
                    setTelefono(value)
                    setError('')
                    setSuccessMessage('')

                    const trimmed = value.trim()
                    if (!trimmed) {
                      setCliente(null)
                      return
                    }

                    if (cliente && !String(cliente.telefono || '').includes(trimmed)) {
                      setCliente(null)
                    }
                  }}
                  placeholder="Escribe el teléfono para filtrar..."
                  className="input-modern"
                  autoComplete="off"
                />

                {telefonoFiltro && clientesFiltrados.length > 0 ? (
                  <ul className="search-suggestions" role="listbox" aria-label="Clientes sugeridos">
                    {clientesFiltrados.map((item) => {
                      const seleccionado = cliente?.id === item.id
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={`search-suggestion-item ${seleccionado ? 'search-suggestion-item-active' : ''}`}
                            onClick={() => cargarClienteSeleccionado(item)}
                          >
                            <span className="search-suggestion-phone">{item.telefono || 'Sin teléfono'}</span>
                            <span className="search-suggestion-name">{item.nombre || 'Cliente'}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}

                {telefonoFiltro && clientesFiltrados.length === 0 && !loading ? (
                  <p className="search-suggestions-empty">
                    Ningún cliente coincide con “{telefonoFiltro}”.
                  </p>
                ) : null}
              </div>

              <p className="field-hint">
                Se filtra solo al escribir. Si el número coincide exacto, el cliente se carga automáticamente.
              </p>

              <button type="submit" disabled={loading || !telefonoFiltro} className="primary-btn">
                {loading ? 'Buscando...' : 'Buscar coincidencia exacta'}
              </button>
            </form>

            <div className="feedback-stack">
              {error ? <div className="feedback-card feedback-error">{error}</div> : null}
              {successMessage ? <div className="feedback-card feedback-success">{successMessage}</div> : null}
            </div>

            {user ? (
              <div className="action-row">
                <button
                  type="button"
                  className="floating-config-btn"
                  onClick={() => {
                    setShowConfigModal(true)
                    setConfigModalTab('premios')
                    setError('')
                    setSuccessMessage('')
                  }}
                >
                  ⚙️ Configuración de premios
                </button>
                <button
                  type="button"
                  className="floating-config-btn register-action-btn"
                  onClick={() => {
                    setShowRegisterModal(true)
                    setError('')
                    setSuccessMessage('')
                  }}
                >
                  ➕ Registrar cliente
                </button>
                <button
                  type="button"
                  className="floating-config-btn clients-directory-btn"
                  onClick={() => {
                    setShowClientesModal(true)
                    setError('')
                    setSuccessMessage('')
                  }}
                >
                  👥 Ver clientes ({clientesCatalogo.length})
                </button>
              </div>
            ) : null}

            {user ? (
              <div className="secondary-card public-qr-card">
                <div className="card-title-row">
                  <div>
                    <p className="eyebrow">Registro público</p>
                    <h3>Código QR para clientes</h3>
                  </div>
                  <span className="search-chip">Escanear</span>
                </div>
                <p className="card-description">
                  Muestra o comparte este QR para que los clientes abran el sitio público
                  desde su celular y se registren.
                </p>
                <div className="public-qr-layout">
                  <div className="public-qr-frame" aria-hidden="true">
                    <QRCodeSVG
                      value={PUBLIC_SITE_URL}
                      size={168}
                      level="M"
                      includeMargin
                      bgColor="#ffffff"
                      fgColor="#0f172a"
                    />
                  </div>
                  <div className="public-qr-meta">
                    <p className="public-qr-label">Link del sitio público</p>
                    <a
                      href={PUBLIC_SITE_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="public-qr-link"
                    >
                      {PUBLIC_SITE_URL}
                    </a>
                    <div className="public-qr-actions">
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(PUBLIC_SITE_URL)
                            setQrLinkCopiado(true)
                            window.setTimeout(() => setQrLinkCopiado(false), 2000)
                          } catch {
                            setError('No se pudo copiar el link. Cópialo manualmente.')
                          }
                        }}
                      >
                        {qrLinkCopiado ? 'Link copiado' : 'Copiar link'}
                      </button>
                      <a
                        href={PUBLIC_SITE_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="ghost-btn public-qr-open-btn"
                      >
                        Abrir sitio
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {user && showClientesModal ? (
              <div
                className="modal-overlay"
                onClick={() => setShowClientesModal(false)}
              >
                <div
                  className="config-card modal-card clients-directory-modal"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="clientes-modal-title"
                >
                  <div className="card-title-row">
                    <div>
                      <p className="eyebrow">Directorio</p>
                      <h3 id="clientes-modal-title">Clientes registrados</h3>
                    </div>
                    <button
                      type="button"
                      className="close-modal-btn"
                      onClick={() => setShowClientesModal(false)}
                    >
                      ✕
                    </button>
                  </div>

                  <p className="card-description">
                    Activos e inactivos. Selecciona uno para cargarlo en el panel.
                  </p>

                  <div className="clients-directory-stats">
                    <div className="clients-stat-pill clients-stat-active">
                      <strong>{totalClientesActivos}</strong>
                      <span>Activos</span>
                    </div>
                    <div className="clients-stat-pill clients-stat-inactive">
                      <strong>{totalClientesInactivos}</strong>
                      <span>Inactivos</span>
                    </div>
                    <div className="clients-stat-pill clients-stat-total">
                      <strong>{clientesCatalogo.length}</strong>
                      <span>Total</span>
                    </div>
                  </div>

                  <div className="level-filter-row" role="group" aria-label="Filtrar clientes por estado">
                    <button
                      type="button"
                      className={`level-filter-chip ${filtroEstadoClientes === 'todos' ? 'level-filter-chip-active' : ''}`}
                      onClick={() => setFiltroEstadoClientes('todos')}
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      className={`level-filter-chip ${filtroEstadoClientes === 'activos' ? 'level-filter-chip-active' : ''}`}
                      onClick={() => setFiltroEstadoClientes('activos')}
                    >
                      Activos
                    </button>
                    <button
                      type="button"
                      className={`level-filter-chip ${filtroEstadoClientes === 'inactivos' ? 'level-filter-chip-active' : ''}`}
                      onClick={() => setFiltroEstadoClientes('inactivos')}
                    >
                      Inactivos
                    </button>
                  </div>

                  <label className="field-label" htmlFor="filtro-texto-clientes">
                    Buscar en el directorio
                  </label>
                  <input
                    id="filtro-texto-clientes"
                    type="search"
                    value={filtroTextoClientes}
                    onChange={(event) => setFiltroTextoClientes(event.target.value)}
                    placeholder="Nombre o teléfono..."
                    className="input-modern"
                  />

                  <div className="clients-directory-list clients-directory-list-modal">
                    {clientesVista.length === 0 ? (
                      <p className="clients-directory-empty">
                        No hay clientes que coincidan con este filtro.
                      </p>
                    ) : (
                      clientesVista.map((item) => {
                        const estadoItem = obtenerEstadoCliente(item)
                        const puntosItem = item.puntos ?? 0
                        const nivelItem = obtenerNivelCliente(puntosItem, clientLevels)
                        const seleccionado = cliente?.id === item.id

                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`clients-directory-item ${seleccionado ? 'clients-directory-item-active' : ''}`}
                            onClick={() => {
                              setTelefono(String(item.telefono || ''))
                              setShowClientesModal(false)
                              cargarClienteSeleccionado(item)
                            }}
                          >
                            <div className="clients-directory-item-main">
                              <strong>{item.nombre || 'Sin nombre'}</strong>
                              <span>{item.telefono || 'Sin teléfono'}</span>
                            </div>
                            <div className="clients-directory-item-meta">
                              <span className="clients-directory-points">
                                {puntosItem.toLocaleString('es-CR')} pts
                              </span>
                              <span className="clients-directory-level">{nivelItem}</span>
                              <span
                                className={`clients-directory-status ${
                                  estadoItem === ESTADO_ACTIVO
                                    ? 'clients-directory-status-active'
                                    : 'clients-directory-status-inactive'
                                }`}
                              >
                                {estadoItem}
                              </span>
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {user && showConfigModal ? (
              <div className="modal-overlay" onClick={() => setShowConfigModal(false)}>
                <div className="config-card modal-card" onClick={(event) => event.stopPropagation()}>
                  <div className="card-title-row">
                    <div>
                      <p className="eyebrow">Ajustes</p>
                      <h3>Configuración General</h3>
                    </div>
                    <button type="button" className="close-modal-btn" onClick={() => setShowConfigModal(false)}>
                      ✕
                    </button>
                  </div>

                  <div className="config-tabs" role="tablist" aria-label="Secciones de configuración">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={configModalTab === 'premios'}
                      className={`config-tab ${configModalTab === 'premios' ? 'config-tab-active' : ''}`}
                      onClick={() => setConfigModalTab('premios')}
                    >
                      Configuración de Premios
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={configModalTab === 'niveles'}
                      className={`config-tab ${configModalTab === 'niveles' ? 'config-tab-active' : ''}`}
                      onClick={() => setConfigModalTab('niveles')}
                    >
                      Configuración de Niveles de Cliente
                    </button>
                  </div>

                  {configModalTab === 'premios' ? (
                    <div className="config-tab-panel">
                      <p className="card-description">
                        Configura premios por nivel (Bronce, Plata u Oro). El cliente elige un premio
                        por nivel; canjearlo no resta puntos de su trayectoria.
                      </p>

                      <div className="config-grid">
                        <div>
                          <label className="field-label" htmlFor="config-monto-por-punto">
                            Monto por 1 punto ($)
                          </label>
                          <input
                            id="config-monto-por-punto"
                            type="number"
                            min="1"
                            value={montoPorPunto}
                            onChange={(event) => {
                              const nextValue = Number(event.target.value)
                              if (event.target.value === '' || Number.isNaN(nextValue)) {
                                setMontoPorPunto('')
                                return
                              }
                              setMontoPorPunto(nextValue > 0 ? nextValue : DEFAULT_MONTO_POR_PUNTO)
                            }}
                            onBlur={() => setMontoPorPunto((current) => normalizeMontoPorPunto(current))}
                            className="input-modern"
                            placeholder="Ej. 1000"
                          />
                          <p className="field-hint">
                            Ejemplo: con ${normalizeMontoPorPunto(montoPorPunto).toLocaleString('es-CR')} se otorga 1 punto.
                          </p>
                        </div>
                        <div>
                          <label className="field-label" htmlFor="config-monto-compra-preview">
                            Monto de compra (vista previa)
                          </label>
                          <input
                            id="config-monto-compra-preview"
                            type="number"
                            min="0"
                            value={purchaseAmount}
                            onChange={(event) => setPurchaseAmount(Number(event.target.value) || 0)}
                            className="input-modern"
                            placeholder="Ej. 1200"
                          />
                        </div>
                      </div>

                      <form className="stacked-form" onSubmit={handleAddPrizeRule}>
                        <input
                          type="text"
                          value={ruleName}
                          onChange={(event) => setRuleName(event.target.value)}
                          placeholder="Nombre del premio"
                          className="input-modern"
                        />
                        <input
                          type="text"
                          value={ruleDescription}
                          onChange={(event) => setRuleDescription(event.target.value)}
                          placeholder="Descripción"
                          className="input-modern"
                        />
                        <div>
                          <label className="field-label" htmlFor="rule-nivel">
                            Nivel requerido
                          </label>
                          <select
                            id="rule-nivel"
                            value={ruleNivelId}
                            onChange={(event) => setRuleNivelId(event.target.value)}
                            className="input-modern"
                          >
                            {clientLevels.map((level) => (
                              <option key={level.id} value={level.id}>
                                {level.nombre} (desde {level.puntosMinimos.toLocaleString('es-CR')} pts)
                              </option>
                            ))}
                          </select>
                          <p className="field-hint">
                            Disponible para ese nivel y los superiores.
                          </p>
                        </div>
                        <div className="config-grid">
                          <input
                            type="number"
                            min="0"
                            value={ruleThreshold}
                            onChange={(event) => setRuleThreshold(event.target.value)}
                            placeholder="Umbral (₡)"
                            className="input-modern"
                          />
                          <input
                            type="number"
                            min="0"
                            value={rulePointsCost}
                            onChange={(event) => setRulePointsCost(event.target.value)}
                            placeholder="Costo (opcional, no descuenta)"
                            className="input-modern"
                            title="Ya no se descuenta de la trayectoria; se mantiene solo como referencia"
                          />
                        </div>
                        <button type="submit" className="secondary-btn">
                          {editingRuleId ? 'Guardar cambios' : 'Agregar regla de premio'}
                        </button>
                        <button type="button" onClick={handleRestoreDefaultRules} className="ghost-btn">
                          Restaurar predeterminadas
                        </button>
                        {editingRuleId ? (
                          <button
                            type="button"
                            onClick={() => {
                              resetPrizeRuleForm()
                              setError('')
                              setSuccessMessage('')
                            }}
                            className="ghost-btn"
                          >
                            Cancelar
                          </button>
                        ) : null}
                      </form>

                      <div className="level-filter-row" role="group" aria-label="Filtrar premios por nivel">
                        <button
                          type="button"
                          className={`level-filter-chip ${prizeLevelFilter === 'todos' ? 'level-filter-chip-active' : ''}`}
                          onClick={() => setPrizeLevelFilter('todos')}
                        >
                          Todos
                        </button>
                        {clientLevels.map((level) => (
                          <button
                            key={level.id}
                            type="button"
                            className={`level-filter-chip ${prizeLevelFilter === level.id ? 'level-filter-chip-active' : ''}`}
                            onClick={() => setPrizeLevelFilter(level.id)}
                          >
                            {level.nombre}
                          </button>
                        ))}
                      </div>

                      <div className="rules-list">
                        {filteredConfigPrizeRules.length === 0 ? (
                          <p className="text-sm text-slate-500">
                            No hay premios configurados para este nivel.
                          </p>
                        ) : (
                          filteredConfigPrizeRules.map((rule) => (
                            <div key={rule.id} className={`rule-item ${rule.unlocked ? 'rule-item-active' : ''}`}>
                              <div>
                                <p className="rule-name">{rule.nombre}</p>
                                <p className="rule-description">{rule.descripcion}</p>
                                <p className="rule-meta">
                                  Nivel: {rule.nivelNombre} · Umbral: ₡{rule.umbral.toLocaleString('es-CR')}
                                </p>
                              </div>
                              <div className="rule-actions">
                                <span className="rule-badge rule-badge-level">
                                  {rule.nivelNombre}
                                </span>
                                <span className={`rule-badge ${rule.unlocked ? 'rule-badge-active' : ''}`}>
                                  {rule.unlocked ? 'Disponible' : `Faltan ₡${Math.max(rule.umbral - purchaseAmount, 0).toLocaleString('es-CR')}`}
                                </span>
                                <button type="button" className="mini-btn" onClick={() => handleEditRule(rule)}>
                                  Editar
                                </button>
                                <button type="button" className="mini-btn danger" onClick={() => handleDeleteRule(rule.id)}>
                                  Eliminar
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="config-tab-panel">
                      <p className="card-description">
                        Edita los puntos mínimos de Bronce, Plata y Oro. Al guardar, la trayectoria
                        de todos los clientes registrados se recalcula automáticamente con los nuevos umbrales.
                        Por debajo de Bronce el cliente queda sin nivel.
                      </p>

                      <div className="stacked-form">
                        {clientLevels.map((level) => (
                          <label key={level.id} className="field-label" htmlFor={`nivel-${level.id}`}>
                            {level.nombre} (puntos mínimos)
                            <input
                              id={`nivel-${level.id}`}
                              type="number"
                              min="1"
                              value={level.puntosMinimos}
                              onChange={(event) => handleUpdateClientLevel(level.id, event.target.value)}
                              placeholder={`Puntos requeridos para ${level.nombre}`}
                              className="input-modern mt-2"
                              disabled={levelsSaving}
                            />
                          </label>
                        ))}
                      </div>

                      <p className="field-hint">
                        Debe cumplirse: Bronce &lt; Plata &lt; Oro. Actual:{' '}
                        {clientLevels.map((level) => `${level.nombre} ${level.puntosMinimos}`).join(' · ')}
                      </p>

                      <div className="public-qr-actions" style={{ marginTop: 12 }}>
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={handleSaveClientLevels}
                          disabled={levelsSaving}
                        >
                          {levelsSaving
                            ? 'Guardando y ajustando trayectorias...'
                            : 'Guardar niveles y ajustar trayectorias'}
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={handleRestoreDefaultLevels}
                          disabled={levelsSaving}
                        >
                          Restaurar 10 / 30 / 50
                        </button>
                      </div>

                      <div className="level-prize-summary">
                        {clientLevels.map((level) => {
                          const count = prizeRules.filter((rule) => (rule.nivelId || 'bronce') === level.id).length
                          return (
                            <div key={level.id} className="level-prize-summary-item">
                              <strong>{level.nombre}</strong>
                              <span>
                                Desde {level.puntosMinimos.toLocaleString('es-CR')} pts · {count} premio
                                {count === 1 ? '' : 's'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {user && !cliente ? (
              <div className="secondary-card compact-card">
                <div className="card-title-row">
                  <div>
                    <p className="eyebrow">Nuevo ingreso</p>
                    <h3>Registrar cliente</h3>
                  </div>
                  <div className="avatar-pill">+</div>
                </div>
                <p className="card-description">
                  Crea el perfil del cliente y empieza su recorrido de puntos desde cero.
                </p>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    setShowRegisterModal(true)
                    setError('')
                    setSuccessMessage('')
                  }}
                >
                  Abrir formulario de registro
                </button>
              </div>
            ) : null}

            {user && showEditClientModal && cliente ? (
              <div
                className="modal-overlay"
                onClick={() => {
                  if (!editClientLoading) cerrarEditClientModal()
                }}
              >
                <div className="config-card modal-card" onClick={(event) => event.stopPropagation()}>
                  <div className="card-title-row">
                    <div>
                      <p className="eyebrow">Actualizar perfil</p>
                      <h3>Editar cliente</h3>
                    </div>
                    <button
                      type="button"
                      className="close-modal-btn"
                      disabled={editClientLoading}
                      onClick={cerrarEditClientModal}
                    >
                      ✕
                    </button>
                  </div>
                  <p className="card-description">
                    Modifica nombre, teléfono o contraseña del cliente y guarda los cambios.
                  </p>

                  <form className="stacked-form" onSubmit={handleSaveClientEdit}>
                    <label htmlFor="edit-nombre" className="field-label">
                      Nombre
                    </label>
                    <input
                      id="edit-nombre"
                      name="edit-nombre"
                      type="text"
                      value={editNombre}
                      onChange={(event) => setEditNombre(event.target.value)}
                      placeholder="Nombre del cliente"
                      className="input-modern"
                      disabled={editClientLoading}
                    />

                    <label htmlFor="edit-telefono" className="field-label">
                      Teléfono
                    </label>
                    <input
                      id="edit-telefono"
                      name="edit-telefono"
                      type="tel"
                      value={editTelefono}
                      onChange={(event) => setEditTelefono(event.target.value)}
                      placeholder="Número de teléfono"
                      className="input-modern"
                      disabled={editClientLoading}
                    />

                    <label htmlFor="edit-contraseña" className="field-label">
                      Contraseña (opcional)
                    </label>
                    <input
                      id="edit-contraseña"
                      name="edit-contraseña"
                      type="password"
                      autoComplete="new-password"
                      value={editContraseña}
                      onChange={(event) => setEditContraseña(event.target.value)}
                      placeholder={`Dejar vacío para no cambiar · mín. ${MIN_CLIENT_PASSWORD_LENGTH}`}
                      className="input-modern"
                      disabled={editClientLoading}
                    />

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={editClientLoading}
                        className="primary-btn"
                      >
                        {editClientLoading ? 'Guardando...' : 'Guardar cambios'}
                      </button>
                      <button
                        type="button"
                        disabled={editClientLoading}
                        className="secondary-btn"
                        onClick={cerrarEditClientModal}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}

            {user && showTransactionsModal && cliente ? (
              <div className="modal-overlay" onClick={() => setShowTransactionsModal(false)}>
                <div
                  className="config-card modal-card w-full max-w-2xl"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="transactions-modal-title"
                >
                  <div className="card-title-row">
                    <div>
                      <p className="eyebrow">Historial de compras</p>
                      <h3 id="transactions-modal-title">Transacciones de {cliente.nombre || 'cliente'}</h3>
                    </div>
                    <button
                      type="button"
                      className="close-modal-btn"
                      onClick={() => setShowTransactionsModal(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <p className="card-description">
                    Monto, fecha y puntos otorgados por cada compra registrada desde ahora.
                  </p>

                  <div className="mt-4 max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                    {transaccionesCliente.length === 0 ? (
                      <p className="clients-directory-empty">
                        Aún no hay compras registradas para este cliente.
                      </p>
                    ) : (
                      transaccionesCliente.map((transaccion) => {
                        const fecha = new Date(transaccion.fecha)
                        const fechaValida = !Number.isNaN(fecha.getTime())
                        return (
                          <article
                            key={transaccion.id}
                            className="rounded-2xl border border-violet-100 bg-violet-50/50 p-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-lg font-bold text-slate-900">
                                  ${(Number(transaccion.monto) || 0).toLocaleString('es-CR')}
                                </p>
                                <p className="mt-1 text-sm text-slate-600">
                                  {fechaValida
                                    ? fecha.toLocaleString('es-CR', {
                                      dateStyle: 'medium',
                                      timeStyle: 'short',
                                    })
                                    : 'Fecha no disponible'}
                                </p>
                              </div>
                              <span className="rounded-full bg-violet-200 px-3 py-1 text-xs font-bold text-violet-800">
                                +{(Number(transaccion.puntosOtorgados) || 0).toLocaleString('es-CR')} pts
                              </span>
                            </div>
                          </article>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {user && showEditPointsModal && cliente ? (
              <div
                className="modal-overlay"
                onClick={() => {
                  if (!editPointsLoading) cerrarEditPointsModal()
                }}
              >
                <div
                  className="config-card modal-card"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="edit-points-modal-title"
                >
                  <div className="card-title-row">
                    <div>
                      <p className="eyebrow">Ajuste manual</p>
                      <h3 id="edit-points-modal-title">Editar puntos de {cliente.nombre || 'cliente'}</h3>
                    </div>
                    <button
                      type="button"
                      className="close-modal-btn"
                      disabled={editPointsLoading}
                      onClick={cerrarEditPointsModal}
                    >
                      ✕
                    </button>
                  </div>
                  <p className="card-description">
                    Define el saldo total de puntos. El nivel y la trayectoria se recalcularán automáticamente.
                  </p>

                  <form className="stacked-form" onSubmit={handleSavePointsEdit}>
                    <label className="field-label" htmlFor="edit-client-points">
                      Puntos disponibles
                    </label>
                    <input
                      id="edit-client-points"
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={editPointsValue}
                      onChange={(event) => setEditPointsValue(event.target.value)}
                      className="input-modern"
                      disabled={editPointsLoading}
                      autoFocus
                    />
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className="primary-btn" disabled={editPointsLoading}>
                        {editPointsLoading ? 'Guardando...' : 'Guardar puntos'}
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={editPointsLoading}
                        onClick={cerrarEditPointsModal}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}

            {user && showRegisterModal ? (
              <div
                className="modal-overlay"
                onClick={() => {
                  setShowRegisterModal(false)
                  setContraseñaRegistro('')
                }}
              >
                <div className="config-card modal-card" onClick={(event) => event.stopPropagation()}>
                  <div className="card-title-row">
                    <div>
                      <p className="eyebrow">Nuevo ingreso</p>
                      <h3>Registrar cliente</h3>
                    </div>
                    <button
                      type="button"
                      className="close-modal-btn"
                      onClick={() => {
                        setShowRegisterModal(false)
                        setContraseñaRegistro('')
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <p className="card-description">
                    Completa los datos del cliente, incluida su contraseña, para que pueda consultar y canjear desde la vista pública.
                  </p>

                  <form className="stacked-form" onSubmit={handleRegisterClient}>
                    <input
                      id="nombre"
                      name="nombre"
                      type="text"
                      value={nombre}
                      onChange={(event) => setNombre(event.target.value)}
                      placeholder="Nombre del cliente"
                      className="input-modern"
                    />
                    <input
                      id="telefonoRegistro"
                      name="telefonoRegistro"
                      type="tel"
                      value={telefonoRegistro}
                      onChange={(event) => setTelefonoRegistro(event.target.value)}
                      placeholder="Número de teléfono"
                      className="input-modern"
                    />
                    <input
                      id="contraseñaRegistro"
                      name="contraseñaRegistro"
                      type="password"
                      autoComplete="new-password"
                      value={contraseñaRegistro}
                      onChange={(event) => setContraseñaRegistro(event.target.value)}
                      placeholder={`Contraseña (mín. ${MIN_CLIENT_PASSWORD_LENGTH} caracteres)`}
                      className="input-modern"
                    />
                    <button type="submit" disabled={registroLoading} className="secondary-btn">
                      {registroLoading ? 'Registrando...' : 'Registrar cliente'}
                    </button>
                  </form>
                </div>
              </div>
            ) : null}

            {cliente ? (
              <div className="profile-card">
                <div className="profile-header">
                  <div className="avatar-circle">{initials}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="eyebrow">Detalle del cliente</p>
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide shadow-sm ring-2 ${
                          clienteEstaInactivo
                            ? 'bg-red-600 text-white ring-red-300 animate-pulse'
                            : 'bg-emerald-600 text-white ring-emerald-300'
                        }`}
                      >
                        {estadoCliente}
                      </span>
                    </div>
                    <h3>{cliente.nombre}</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={abrirEditClientModal}
                        disabled={updatingPoints || editClientLoading}
                        className="rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
                      >
                        Editar cliente
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setError('')
                          setSuccessMessage('')
                          setShowTransactionsModal(true)
                        }}
                        className="rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
                      >
                        Ver transacciones
                      </button>
                      <button
                        type="button"
                        onClick={abrirEditPointsModal}
                        disabled={updatingPoints || editPointsLoading}
                        className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                      >
                        Editar puntos
                      </button>
                      <button
                        type="button"
                        onClick={handleToggleClienteEstado}
                        disabled={updatingPoints}
                        className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                          clienteEstaInactivo
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60'
                            : 'bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60'
                        }`}
                      >
                        {updatingPoints
                          ? 'Actualizando...'
                          : clienteEstaInactivo
                            ? 'Activar Cliente'
                            : 'Desactivar Cliente'}
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteCliente}
                        disabled={updatingPoints || editClientLoading}
                        className="rounded-xl bg-red-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-60"
                      >
                        Eliminar cliente
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-4 shadow-sm">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-amber-700/80">
                      Puntos Disponibles
                    </p>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                      {puntosDisponibles.toLocaleString('es-CR')}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-sky-200/80 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-4 shadow-sm">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-sky-700/80">
                      Premios Canjeados
                    </p>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                      {premiosCanjeados}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4 shadow-sm">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-emerald-700/80">
                      Nivel de Cliente
                    </p>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-800">
                      {nivelCliente}
                    </p>
                  </div>
                </div>

                <div className="points-card">
                  <div>
                    <p className="points-label">Puntos actuales</p>
                    <p className="points-value">{cliente.puntos ?? 0}</p>
                  </div>
                  <span className="phone-badge">{cliente.telefono}</span>
                </div>

                <form className="assign-points-card" onSubmit={handleSetClientPassword}>
                  <div>
                    <p className="eyebrow">Acceso del cliente</p>
                    <h3>Contraseña de consulta</h3>
                    <p className="card-description">
                      {cliente.contraseña
                        ? 'Este cliente ya tiene contraseña. Puedes actualizarla aquí.'
                        : 'Este cliente aún no tiene contraseña. Asígnale una para que pueda ingresar en la vista pública.'}
                    </p>
                  </div>
                  <input
                    id="contraseña-cliente-admin"
                    type="password"
                    autoComplete="new-password"
                    value={contraseñaClienteAdmin}
                    onChange={(event) => setContraseñaClienteAdmin(event.target.value)}
                    placeholder={`Nueva contraseña (mín. ${MIN_CLIENT_PASSWORD_LENGTH})`}
                    className="input-modern"
                  />
                  <button
                    type="submit"
                    disabled={updatingPoints || !contraseñaClienteAdmin.trim()}
                    className="secondary-btn"
                  >
                    {updatingPoints ? 'Guardando...' : 'Guardar contraseña'}
                  </button>
                </form>

                <div className="assign-points-card">
                  <div>
                    <p className="eyebrow">Asignación por compra</p>
                    <h3>Sumar puntos al cliente</h3>
                  </div>

                  <label className="field-label" htmlFor="monto-compra-asignacion">
                    Monto de Compra ($)
                  </label>
                  <input
                    id="monto-compra-asignacion"
                    type="text"
                    inputMode="decimal"
                    value={montoCompraAsignacion}
                    onChange={(event) => {
                      setMontoCompraAsignacion(event.target.value)
                      setError('')
                      setSuccessMessage('')
                    }}
                    className="input-modern"
                    placeholder="Ej. 3500 o 3.500,50"
                    disabled={updatingPoints || clienteEstaInactivo}
                  />

                  {clienteEstaInactivo ? (
                    <p className="mt-2 text-sm font-medium text-red-600">
                      Cliente inactivo: actívalo para asignar puntos por compra.
                    </p>
                  ) : null}

                  <p className="mt-2 text-sm text-slate-600">
                    Acumulado hacia el próximo punto:{' '}
                    <strong>
                      ${montoPendienteCliente.toLocaleString('es-CR')}
                    </strong>
                    {' '}de ${normalizeMontoPorPunto(montoPorPunto).toLocaleString('es-CR')}
                  </p>

                  <div className="calculated-points-row">
                    <div>
                      <p className="points-label">Puntos a asignar</p>
                      <p className="calculated-points-value">
                        {puntosDesdeCompra.toLocaleString('es-CR')} pts
                      </p>
                    </div>
                    <p className="field-hint">
                      Compra + acumulado = ${asignacionCompraPreview.totalAcumulado.toLocaleString('es-CR')}.
                      {asignacionCompraPreview.montoPendienteNuevo > 0
                        ? ` Remanente: $${asignacionCompraPreview.montoPendienteNuevo.toLocaleString('es-CR')}.`
                        : ''}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="primary-btn"
                    onClick={handleAssignPurchasePoints}
                    disabled={updatingPoints || clienteEstaInactivo || !puedeRegistrarCompra}
                  >
                    {updatingPoints
                      ? 'Registrando...'
                      : puntosDesdeCompra > 0
                        ? 'Asignar puntos'
                        : 'Registrar compra'}
                  </button>

                  <div className="quick-actions">
                    {[100, 250, 500].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => handleUpdatePoints(amount)}
                        disabled={updatingPoints || clienteEstaInactivo}
                        className="quick-action-btn"
                      >
                        +{amount} pts
                      </button>
                    ))}
                  </div>
                </div>

                <div className="prizes-card">
                  <div className="card-title-row">
                    <div>
                      <p className="eyebrow">Catálogo · Nivel {nivelCliente}</p>
                      <h3>Asignar premio</h3>
                    </div>
                    <span className="points-pill">{puntosDisponibles} pts</span>
                  </div>
                  <p className="card-description">
                    Un premio por nivel. Asignar o canjear no descuenta puntos: la trayectoria solo
                    avanza con las compras del cliente.
                  </p>

                  <div className="prizes-list">
                    {availablePrizeRules.map((premio) => {
                      const alcanzaNivel = premio.nivelAlcanzado !== false
                      const nivelOcupado = obtenerNivelesCanjeados(cliente?.premios).has(
                        premio.nivelId || 'bronce',
                      ) || normalizeClientPremios(cliente?.premios).some((item) => (
                        (item.nivelId || 'bronce') === (premio.nivelId || 'bronce')
                        && item.status !== STATUS_CANJEADO
                        && item.status !== STATUS_VENCIDO
                      ))
                      const esAsignable = alcanzaNivel && !nivelOcupado

                      return (
                        <button
                          key={premio.id}
                          type="button"
                          onClick={() => handleAssignPrize(premio)}
                          disabled={updatingPoints || !esAsignable}
                          className="prize-item"
                          title={
                            !alcanzaNivel
                              ? `Requiere nivel ${premio.nivelNombre}`
                              : nivelOcupado
                                ? 'Este nivel ya tiene premio elegido/canjeado'
                                : 'Asignar premio del nivel'
                          }
                        >
                          <div>
                            <p className="prize-name">{premio.nombre}</p>
                            <p className="prize-description">{premio.descripcion}</p>
                            <p className="prize-level-meta">
                              Nivel {premio.nivelNombre}
                              {!alcanzaNivel ? ' · No disponible para este cliente' : ''}
                              {nivelOcupado ? ' · Nivel ya utilizado' : ''}
                            </p>
                          </div>
                          <span className="prize-cost">{premio.nivelNombre}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="prizes-card mt-3">
                  <div className="card-title-row">
                    <div>
                      <p className="eyebrow">Premios del cliente</p>
                      <h3>Lista de premios</h3>
                    </div>
                    <span className="points-pill">{premiosCliente.length}</span>
                  </div>

                  <div className="prizes-list">
                    {premiosCliente.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        Este cliente aún no tiene premios asignados.
                      </p>
                    ) : (
                      premiosCliente.map((premio) => {
                        const status = premio.statusEfectivo
                        const esCanjeable = status === STATUS_PENDIENTE
                        const etiquetaStatus = status === STATUS_EN_SOLICITUD
                          ? 'en solicitud'
                          : status

                        return (
                          <div
                            key={premio.id}
                            className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="prize-name">{premio.nombre}</p>
                                <span
                                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getPrizeStatusBadgeClass(status)}`}
                                >
                                  {etiquetaStatus}
                                </span>
                              </div>
                              {premio.descripcion ? (
                                <p className="prize-description">{premio.descripcion}</p>
                              ) : null}
                              <p className="mt-1 text-xs text-slate-500">
                                Asignado:{' '}
                                {premio.fechaAsignacion
                                  ? new Date(premio.fechaAsignacion).toLocaleDateString('es-CR')
                                  : '—'}
                              </p>
                            </div>

                            <div className="flex shrink-0 flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleRedeemAssignedPrize(premio)}
                                disabled={updatingPoints || !esCanjeable}
                                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                                  esCanjeable
                                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                    : 'cursor-not-allowed bg-slate-100 text-slate-400'
                                }`}
                                title={
                                  status === STATUS_VENCIDO
                                    ? 'Premio vencido: no se puede canjear'
                                    : status === STATUS_CANJEADO
                                      ? 'Premio ya canjeado'
                                      : status === STATUS_EN_SOLICITUD
                                        ? 'Esperando aprobación de solicitud'
                                        : 'Canjear premio'
                                }
                              >
                                {status === STATUS_CANJEADO
                                  ? 'Canjeado'
                                  : status === STATUS_VENCIDO
                                    ? 'Vencido'
                                    : status === STATUS_EN_SOLICITUD
                                      ? 'En solicitud'
                                      : 'Canjear'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelAssignedPrize(premio)}
                                disabled={
                                  updatingPoints
                                  || (status !== STATUS_PENDIENTE && status !== STATUS_EN_SOLICITUD)
                                }
                                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                                  status === STATUS_PENDIENTE || status === STATUS_EN_SOLICITUD
                                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                                    : 'cursor-not-allowed bg-slate-100 text-slate-400'
                                }`}
                                title="Cancelar premio y devolver puntos"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {solicitudActiva ? (
        <div className="canje-toast-overlay" role="alertdialog" aria-live="assertive" aria-modal="true">
          <div className="canje-toast-card">
            <div className="canje-toast-pulse" aria-hidden="true" />
            <p className="canje-toast-eyebrow">Nueva solicitud de canje</p>
            <h3 className="canje-toast-title">
              {solicitudActiva.clienteNombre} desea canjear {solicitudActiva.premioNombre}
            </h3>
            <p className="canje-toast-meta">
              Nivel {solicitudActiva.nivelId || 'bronce'} · No descuenta puntos
              {' · '}
              {solicitudActiva.fecha
                ? new Date(solicitudActiva.fecha).toLocaleString('es-CR')
                : 'Ahora'}
              {solicitudesPendientes.length > 1
                ? ` · ${solicitudesPendientes.length} pendientes`
                : ''}
            </p>
            <div className="canje-toast-actions">
              <button
                type="button"
                className="canje-toast-btn canje-toast-btn-accept"
                disabled={resolviendoSolicitud}
                onClick={() => handleAceptarSolicitudCanje(solicitudActiva)}
              >
                {resolviendoSolicitud ? 'Procesando...' : 'Aceptar'}
              </button>
              <button
                type="button"
                className="canje-toast-btn canje-toast-btn-cancel"
                disabled={resolviendoSolicitud}
                onClick={() => handleCancelarSolicitudCanje(solicitudActiva)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default App
