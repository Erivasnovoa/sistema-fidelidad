import { useEffect, useState } from 'react'
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
  SOLICITUD_APROBADA,
  SOLICITUD_PENDIENTE,
  SOLICITUD_RECHAZADA,
  STATUS_CANJEADO,
  STATUS_EN_SOLICITUD,
  STATUS_PENDIENTE,
  STATUS_VENCIDO,
} from './lib/prizeRules'
import {
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
import ClientePublico from './ClientePublico'
import './App.css'

const initialPrizeRules = [
  {
    id: 'descuento-10',
    nombre: 'Descuento 10%',
    descripcion: 'Vale para tu próxima compra.',
    umbral: 500,
    puntosCosto: 300,
    nivelId: 'bronce',
  },
  {
    id: 'producto-gratis',
    nombre: 'Producto gratis',
    descripcion: 'Un producto sorpresa en tienda.',
    umbral: 1500,
    puntosCosto: 800,
    nivelId: 'plata',
  },
  {
    id: 'visita-premium',
    nombre: 'Visita premium',
    descripcion: 'Atención especial y beneficios exclusivos.',
    umbral: 2500,
    puntosCosto: 1500,
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

const aplicarReglaInactividad = async (clienteData) => {
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

  return {
    ...clienteData,
    estado: estadoActual,
  }
}

const App = () => {
  const [vistaActual, setVistaActual] = useState('cliente')
  const [telefono, setTelefono] = useState('')
  const [cliente, setCliente] = useState(null)
  const [loading, setLoading] = useState(false)
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
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [solicitudesPendientes, setSolicitudesPendientes] = useState([])
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
        setSolicitudesPendientes([])
      }
    })

    return unsubscribe
  }, [])

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
      setVistaActual('cliente')
    } catch (err) {
      console.error(err)
      setError('No se pudo cerrar la sesión. Intenta nuevamente.')
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

    setLoading(true)
    setError('')
    setSuccessMessage('')
    setCliente(null)
    setMontoCompraAsignacion('')
    setContraseñaClienteAdmin('')

    try {
      const clientesRef = collection(db, 'clientes')
      const clientesQuery = query(clientesRef, where('telefono', '==', telefonoBuscado))
      const snapshot = await getDocs(clientesQuery)

      if (snapshot.empty) {
        setError('No se encontró ningún cliente con ese teléfono.')
        return
      }

      const clienteDoc = snapshot.docs[0]
      const clienteData = { id: clienteDoc.id, ...clienteDoc.data() }
      const clienteResuelto = await aplicarReglaInactividad(clienteData)
      setCliente(clienteResuelto)

      if (
        clienteResuelto.estado === ESTADO_INACTIVO
        && (clienteData.puntos ?? 0) > 0
        && (clienteResuelto.puntos ?? 0) === 0
      ) {
        setSuccessMessage('Cliente inactivo por más de 60 días: sus puntos se reiniciaron a 0.')
      }
    } catch (err) {
      setError('No se pudo consultar el cliente. Intenta nuevamente.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

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

      await updateDoc(clienteDocRef, {
        puntos: nextPoints,
        montoPendientePuntos: asignacion.montoPendienteNuevo,
        fechaUltimaCompra,
        estado: ESTADO_ACTIVO,
      })

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
    const puntosRequeridos = premio.puntosCosto ?? premio.costo
    const nivelRequerido = obtenerNivelPorId(premio.nivelId, clientLevels)

    if (!clienteAlcanzaNivel(puntosActuales, premio.nivelId, clientLevels)) {
      setError(`Este premio requiere nivel ${nivelRequerido.nombre} o superior.`)
      return
    }

    if (puntosActuales < puntosRequeridos) return

    setUpdatingPoints(true)
    setError('')
    setSuccessMessage('')

    try {
      const clienteDocRef = doc(db, 'clientes', cliente.id)
      const nextPoints = puntosActuales - puntosRequeridos
      const premioAsignado = {
        id: crypto.randomUUID(),
        premioId: premio.id,
        nombre: premio.nombre,
        descripcion: premio.descripcion || '',
        puntosCosto: puntosRequeridos,
        nivelId: premio.nivelId || 'bronce',
        fechaAsignacion: new Date().toISOString(),
        status: STATUS_PENDIENTE,
      }
      const nextPremios = [...(cliente.premios ?? []), premioAsignado]

      await updateDoc(clienteDocRef, {
        puntos: nextPoints,
        premios: nextPremios,
      })
      setCliente((currentCliente) => (
        currentCliente
          ? { ...currentCliente, puntos: nextPoints, premios: nextPremios }
          : currentCliente
      ))
      setSuccessMessage(`Premio "${premio.nombre}" asignado. Tienes 30 días para canjearlo.`)
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
      const nextPremios = (cliente.premios ?? []).map((premio) => (
        premio.id === premioAsignado.id
          ? { ...premio, status: STATUS_CANJEADO, fechaCanje: new Date().toISOString() }
          : premio
      ))
      const nextRedeemed = (cliente.premiosCanjeados ?? 0) + 1

      await updateDoc(clienteDocRef, {
        premios: nextPremios,
        premiosCanjeados: nextRedeemed,
      })
      setCliente((currentCliente) => (
        currentCliente
          ? { ...currentCliente, premios: nextPremios, premiosCanjeados: nextRedeemed }
          : currentCliente
      ))
      setSuccessMessage(`Premio "${premioAsignado.nombre}" canjeado correctamente.`)
    } catch (err) {
      setError('No se pudo canjear el premio. Intenta nuevamente.')
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
      const nextPremios = (clienteData.premios ?? []).map((premio) => (
        premio.id === solicitud.premioId
          ? {
              ...premio,
              status: STATUS_CANJEADO,
              fechaCanje: new Date().toISOString(),
              solicitudCanjeId: solicitud.id,
            }
          : premio
      ))
      const nextRedeemed = (clienteData.premiosCanjeados ?? 0) + 1
      const batch = writeBatch(db)

      batch.update(clienteDocRef, {
        premios: nextPremios,
        premiosCanjeados: nextRedeemed,
      })
      batch.update(doc(db, 'solicitudesCanje', solicitud.id), {
        status: SOLICITUD_APROBADA,
        resueltoAt: new Date().toISOString(),
      })
      await batch.commit()

      sincronizarClienteLocal(solicitud.clienteId, {
        premios: nextPremios,
        premiosCanjeados: nextRedeemed,
      })
      setSuccessMessage(
        `Canje aprobado: ${solicitud.clienteNombre} · ${solicitud.premioNombre}`,
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

      if (clienteSnap.exists()) {
        const clienteData = clienteSnap.data()
        nextPremios = (clienteData.premios ?? []).map((premio) => (
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
    const pointsCost = Number(rulePointsCost)
    const nivelId = obtenerNivelPorId(ruleNivelId, clientLevels).id

    if (!name || !description || Number.isNaN(threshold) || Number.isNaN(pointsCost) || threshold <= 0 || pointsCost <= 0) {
      setError('Completa todos los campos del premio con valores válidos.')
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

  const handleUpdateClientLevel = (levelId, puntosMinimos) => {
    const nextPoints = Number(puntosMinimos)

    setClientLevels((currentLevels) => currentLevels.map((level) => (
      level.id === levelId
        ? { ...level, puntosMinimos: Number.isNaN(nextPoints) || nextPoints < 0 ? 0 : nextPoints }
        : level
    )))
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
    const telefonoTrim = telefonoRegistro.trim()
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
      const clientesRef = collection(db, 'clientes')
      const clientesQuery = query(clientesRef, where('telefono', '==', telefonoTrim))
      const snapshot = await getDocs(clientesQuery)

      if (!snapshot.empty) {
        setError('¡Error: Este número de teléfono ya está registrado!')
        return
      }

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
                <div className="search-chip">Online</div>
              </div>

              <label htmlFor="telefono" className="field-label">
                Número de teléfono
              </label>
              <input
                id="telefono"
                name="telefono"
                type="tel"
                value={telefono}
                onChange={(event) => setTelefono(event.target.value)}
                placeholder="Ej. 5512345678"
                className="input-modern"
              />

              <button type="submit" disabled={loading} className="primary-btn">
                {loading ? 'Buscando...' : 'Buscar cliente'}
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
                        Configura premios por nivel (Bronce, Plata u Oro). El cliente solo puede canjear
                        premios de su nivel actual o inferiores.
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
                            placeholder="Costo en puntos"
                            className="input-modern"
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
                                  Nivel: {rule.nivelNombre} · Umbral: ₡{rule.umbral.toLocaleString('es-CR')} · Costo: {rule.puntosCosto} pts
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
                        Define los puntos mínimos de Bronce, Plata y Oro. Los premios usan estos umbrales
                        para decidir qué recompensas puede recibir cada cliente.
                      </p>

                      <div className="stacked-form">
                        {clientLevels.map((level) => (
                          <label key={level.id} className="field-label" htmlFor={`nivel-${level.id}`}>
                            {level.nombre}
                            <input
                              id={`nivel-${level.id}`}
                              type="number"
                              min="0"
                              value={level.puntosMinimos}
                              onChange={(event) => handleUpdateClientLevel(level.id, event.target.value)}
                              placeholder={`Puntos requeridos para ${level.nombre}`}
                              className="input-modern mt-2"
                            />
                          </label>
                        ))}
                      </div>

                      <div className="level-prize-summary">
                        {clientLevels.map((level) => {
                          const count = prizeRules.filter((rule) => (rule.nivelId || 'bronce') === level.id).length
                          return (
                            <div key={level.id} className="level-prize-summary-item">
                              <strong>{level.nombre}</strong>
                              <span>{count} premio{count === 1 ? '' : 's'} configurado{count === 1 ? '' : 's'}</span>
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
                    <button
                      type="button"
                      onClick={handleToggleClienteEstado}
                      disabled={updatingPoints}
                      className={`mt-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                        clienteEstaInactivo
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60'
                          : 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-60'
                      }`}
                    >
                      {updatingPoints
                        ? 'Actualizando...'
                        : clienteEstaInactivo
                          ? 'Activar Cliente'
                          : 'Desactivar Cliente'}
                    </button>
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
                    Solo se pueden asignar premios del nivel del cliente o inferiores. Al asignar se
                    descuentan puntos y quedan 30 días para canjear.
                  </p>

                  <div className="prizes-list">
                    {availablePrizeRules.map((premio) => {
                      const alcanzaNivel = premio.nivelAlcanzado !== false
                      const alcanzaPuntos = puntosDisponibles >= (premio.puntosCosto ?? premio.costo)
                      const esAsignable = alcanzaNivel && alcanzaPuntos

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
                              : !alcanzaPuntos
                                ? 'Puntos insuficientes'
                                : 'Asignar premio'
                          }
                        >
                          <div>
                            <p className="prize-name">{premio.nombre}</p>
                            <p className="prize-description">{premio.descripcion}</p>
                            <p className="prize-level-meta">
                              Nivel {premio.nivelNombre}
                              {!alcanzaNivel ? ' · No disponible para este cliente' : ''}
                            </p>
                          </div>
                          <span className="prize-cost">{premio.puntosCosto ?? premio.costo} pts</span>
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

                            <button
                              type="button"
                              onClick={() => handleRedeemAssignedPrize(premio)}
                              disabled={updatingPoints || !esCanjeable}
                              className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition ${
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
