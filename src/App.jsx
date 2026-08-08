import { useEffect, useState } from 'react'
import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from './lib/firebase'
import { getAvailablePrizeRules, normalizePrizeRules } from './lib/prizeRules'
import './App.css'

const initialPrizeRules = [
  {
    id: 'descuento-10',
    nombre: 'Descuento 10%',
    descripcion: 'Vale para tu próxima compra.',
    umbral: 500,
    puntosCosto: 300,
  },
  {
    id: 'producto-gratis',
    nombre: 'Producto gratis',
    descripcion: 'Un producto sorpresa en tienda.',
    umbral: 1500,
    puntosCosto: 800,
  },
  {
    id: 'visita-premium',
    nombre: 'Visita premium',
    descripcion: 'Atención especial y beneficios exclusivos.',
    umbral: 2500,
    puntosCosto: 1500,
  },
]

const initialClientLevels = [
  { id: 'bronce', nombre: 'Bronce', puntosMinimos: 0 },
  { id: 'plata', nombre: 'Plata', puntosMinimos: 500 },
  { id: 'oro', nombre: 'Oro', puntosMinimos: 1500 },
  { id: 'platino', nombre: 'Platino', puntosMinimos: 2500 },
]

const obtenerNivelCliente = (puntos) => {
  if (puntos >= 500) return '👑 VIP / Oro'
  if (puntos >= 200) return '🥈 Plata'
  return '🥉 Bronce'
}

const App = () => {
  const [telefono, setTelefono] = useState('')
  const [cliente, setCliente] = useState(null)
  const [loading, setLoading] = useState(false)
  const [updatingPoints, setUpdatingPoints] = useState(false)
  const [error, setError] = useState('')
  const [nombre, setNombre] = useState('')
  const [telefonoRegistro, setTelefonoRegistro] = useState('')
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
  const [ruleName, setRuleName] = useState('')
  const [ruleDescription, setRuleDescription] = useState('')
  const [ruleThreshold, setRuleThreshold] = useState('')
  const [rulePointsCost, setRulePointsCost] = useState('')
  const [editingRuleId, setEditingRuleId] = useState(null)
  const [isOpenConfigModal, setIsOpenConfigModal] = useState(false)
  const [configModalTab, setConfigModalTab] = useState('premios')
  const [clientLevels, setClientLevels] = useState(initialClientLevels)
  const [levelName, setLevelName] = useState('')
  const [levelMinPoints, setLevelMinPoints] = useState('')
  const [editingLevelId, setEditingLevelId] = useState(null)
  const [showRegisterModal, setShowRegisterModal] = useState(false)

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
    setCliente(null)

    try {
      const clientesRef = collection(db, 'clientes')
      const clientesQuery = query(clientesRef, where('telefono', '==', telefonoBuscado))
      const snapshot = await getDocs(clientesQuery)

      if (snapshot.empty) {
        setError('No se encontró ningún cliente con ese teléfono.')
        return
      }

      const clienteDoc = snapshot.docs[0]
      setCliente({ id: clienteDoc.id, ...clienteDoc.data() })
    } catch (err) {
      setError('No se pudo consultar el cliente. Intenta nuevamente.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdatePoints = async (amount) => {
    if (!cliente?.id) return

    setUpdatingPoints(true)
    setError('')

    try {
      const clienteDocRef = doc(db, 'clientes', cliente.id)
      const nextPoints = (cliente.puntos ?? 0) + amount

      await updateDoc(clienteDocRef, { puntos: nextPoints })
      setCliente((currentCliente) => (
        currentCliente ? { ...currentCliente, puntos: nextPoints } : currentCliente
      ))
    } catch (err) {
      setError('No se pudieron actualizar los puntos. Intenta nuevamente.')
      console.error(err)
    } finally {
      setUpdatingPoints(false)
    }
  }

  const handleRedeemPrize = async (premio) => {
    if (!cliente?.id) return

    const puntosActuales = cliente.puntos ?? 0
    const puntosRequeridos = premio.puntosCosto ?? premio.costo

    if (puntosActuales < puntosRequeridos) return

    setUpdatingPoints(true)
    setError('')

    try {
      const clienteDocRef = doc(db, 'clientes', cliente.id)
      const nextPoints = puntosActuales - puntosRequeridos

      const premiosCanjeadosActuales = cliente.premiosCanjeados ?? 0
      const nextRedeemed = premiosCanjeadosActuales + 1

      await updateDoc(clienteDocRef, { puntos: nextPoints, premiosCanjeados: nextRedeemed })
      setCliente((currentCliente) => (
        currentCliente
          ? { ...currentCliente, puntos: nextPoints, premiosCanjeados: nextRedeemed }
          : currentCliente
      ))
    } catch (err) {
      setError('No se pudo canjear el premio. Intenta nuevamente.')
      console.error(err)
    } finally {
      setUpdatingPoints(false)
    }
  }

  const handleAddPrizeRule = (event) => {
    event.preventDefault()

    const name = ruleName.trim()
    const description = ruleDescription.trim()
    const threshold = Number(ruleThreshold)
    const pointsCost = Number(rulePointsCost)

    if (!name || !description || Number.isNaN(threshold) || Number.isNaN(pointsCost) || threshold <= 0 || pointsCost <= 0) {
      setError('Completa todos los campos del premio con valores válidos.')
      return
    }

    if (editingRuleId) {
      setPrizeRules((currentRules) => currentRules.map((rule) => (
        rule.id === editingRuleId
          ? { ...rule, nombre: name, descripcion: description, umbral: threshold, puntosCosto: pointsCost }
          : rule
      )))
      setEditingRuleId(null)
      setSuccessMessage('¡Regla de premio actualizada correctamente!')
    } else {
      const newRule = {
        id: crypto.randomUUID(),
        nombre: name,
        descripcion: description,
        umbral: threshold,
        puntosCosto: pointsCost,
      }

      setPrizeRules((currentRules) => [...currentRules, newRule])
      setSuccessMessage('¡Regla de premio agregada correctamente!')
    }

    setRuleName('')
    setRuleDescription('')
    setRuleThreshold('')
    setRulePointsCost('')
    setError('')
  }

  const handleEditRule = (rule) => {
    setEditingRuleId(rule.id)
    setRuleName(rule.nombre)
    setRuleDescription(rule.descripcion)
    setRuleThreshold(String(rule.umbral))
    setRulePointsCost(String(rule.puntosCosto))
    setError('')
    setSuccessMessage('')
  }

  const handleDeleteRule = (ruleId) => {
    setPrizeRules((currentRules) => currentRules.filter((rule) => rule.id !== ruleId))
    if (editingRuleId === ruleId) {
      setEditingRuleId(null)
      setRuleName('')
      setRuleDescription('')
      setRuleThreshold('')
      setRulePointsCost('')
    }
    setSuccessMessage('¡Regla de premio eliminada correctamente!')
    setError('')
  }

  const handleRestoreDefaultRules = () => {
    setPrizeRules(initialPrizeRules)
    setEditingRuleId(null)
    setRuleName('')
    setRuleDescription('')
    setRuleThreshold('')
    setRulePointsCost('')
    setSuccessMessage('¡Reglas restauradas a los valores por defecto!')
    setError('')
  }

  const resetLevelForm = () => {
    setEditingLevelId(null)
    setLevelName('')
    setLevelMinPoints('')
  }

  const handleAddClientLevel = (event) => {
    event.preventDefault()

    const name = levelName.trim()
    const minPoints = Number(levelMinPoints)

    if (!name || Number.isNaN(minPoints) || minPoints < 0) {
      setError('Completa el nombre del nivel y los puntos mínimos con valores válidos.')
      setSuccessMessage('')
      return
    }

    const duplicatePoints = clientLevels.some(
      (level) => level.puntosMinimos === minPoints && level.id !== editingLevelId,
    )

    if (duplicatePoints) {
      setError('Ya existe un nivel con esos puntos mínimos.')
      setSuccessMessage('')
      return
    }

    if (editingLevelId) {
      setClientLevels((currentLevels) => currentLevels.map((level) => (
        level.id === editingLevelId
          ? { ...level, nombre: name, puntosMinimos: minPoints }
          : level
      )))
      setSuccessMessage('¡Nivel de cliente actualizado correctamente!')
    } else {
      setClientLevels((currentLevels) => [
        ...currentLevels,
        {
          id: crypto.randomUUID(),
          nombre: name,
          puntosMinimos: minPoints,
        },
      ])
      setSuccessMessage('¡Nivel de cliente agregado correctamente!')
    }

    resetLevelForm()
    setError('')
  }

  const handleEditLevel = (level) => {
    setEditingLevelId(level.id)
    setLevelName(level.nombre)
    setLevelMinPoints(String(level.puntosMinimos))
    setError('')
    setSuccessMessage('')
  }

  const handleDeleteLevel = (levelId) => {
    setClientLevels((currentLevels) => currentLevels.filter((level) => level.id !== levelId))
    if (editingLevelId === levelId) {
      resetLevelForm()
    }
    setSuccessMessage('¡Nivel de cliente eliminado correctamente!')
    setError('')
  }

  const handleRegisterClient = async (event) => {
    event.preventDefault()

    const nombreTrim = nombre.trim()
    const telefonoTrim = telefonoRegistro.trim()

    if (!nombreTrim || !telefonoTrim) {
      setError('Completa nombre y teléfono para registrar al cliente.')
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

      await addDoc(clientesRef, {
        nombre: nombreTrim,
        telefono: telefonoTrim,
        puntos: 0,
      })

      setNombre('')
      setTelefonoRegistro('')
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
          const rulesFromFirestore = normalizePrizeRules(rulesDoc.data().reglas || [])
          setPrizeRules(rulesFromFirestore)

          if (typeof window !== 'undefined') {
            window.localStorage.setItem('fidelidad-prize-rules', JSON.stringify(rulesFromFirestore))
          }
        } else if (typeof window !== 'undefined') {
          const storedRules = window.localStorage.getItem('fidelidad-prize-rules')

          if (storedRules) {
            try {
              const parsedRules = normalizePrizeRules(JSON.parse(storedRules))
              setPrizeRules(parsedRules)
            } catch {
              setPrizeRules(initialPrizeRules)
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

    window.localStorage.setItem('fidelidad-prize-rules', JSON.stringify(prizeRules))

    const syncPrizeRules = async () => {
      try {
        const rulesDocRef = doc(db, 'configuracionPremios', 'reglas')
        await setDoc(rulesDocRef, {
          reglas: prizeRules,
          updatedAt: new Date().toISOString(),
        })
      } catch (err) {
        console.error(err)
      }
    }

    syncPrizeRules()
  }, [prizeRules, rulesLoaded])

  const puntosDisponibles = cliente ? (cliente.puntos ?? 0) : 0
  const premiosCanjeados = cliente ? (cliente.premiosCanjeados ?? 0) : 0
  const availablePrizeRules = getAvailablePrizeRules(prizeRules, purchaseAmount)
  const initials = cliente?.nombre?.charAt(0)?.toUpperCase() ?? 'C'

  return (
    <main className="app-shell">
      <section className="app-card">
        <div className="app-title-bar">
          <h1 className="app-main-title">EL BAJONAZO</h1>
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

            <div className="action-row">
              <button
                type="button"
                className="floating-config-btn"
                onClick={() => {
                  setIsOpenConfigModal(true)
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

            {isOpenConfigModal ? (
              <div className="modal-overlay" onClick={() => setIsOpenConfigModal(false)}>
                <div className="config-card modal-card" onClick={(event) => event.stopPropagation()}>
                  <div className="card-title-row">
                    <div>
                      <p className="eyebrow">Ajustes</p>
                      <h3>Configuración General</h3>
                    </div>
                    <button type="button" className="close-modal-btn" onClick={() => setIsOpenConfigModal(false)}>
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
                        Define reglas de premios según el monto acumulado y visualiza qué recompensas se activan.
                      </p>

                      <div className="config-grid">
                        <label className="field-label">Monto de compra</label>
                        <input
                          type="number"
                          min="0"
                          value={purchaseAmount}
                          onChange={(event) => setPurchaseAmount(Number(event.target.value) || 0)}
                          className="input-modern"
                          placeholder="Ej. 1200"
                        />
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
                              setEditingRuleId(null)
                              setRuleName('')
                              setRuleDescription('')
                              setRuleThreshold('')
                              setRulePointsCost('')
                              setError('')
                              setSuccessMessage('')
                            }}
                            className="ghost-btn"
                          >
                            Cancelar
                          </button>
                        ) : null}
                      </form>

                      <div className="rules-list">
                        {availablePrizeRules.map((rule) => (
                          <div key={rule.id} className={`rule-item ${rule.unlocked ? 'rule-item-active' : ''}`}>
                            <div>
                              <p className="rule-name">{rule.nombre}</p>
                              <p className="rule-description">{rule.descripcion}</p>
                              <p className="rule-meta">
                                Umbral: ₡{rule.umbral.toLocaleString('es-CR')} · Costo: {rule.puntosCosto} pts
                              </p>
                            </div>
                            <div className="rule-actions">
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
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="config-tab-panel">
                      <p className="card-description">
                        Define el nombre de cada nivel y los puntos mínimos requeridos para alcanzarlo.
                      </p>

                      <form className="stacked-form" onSubmit={handleAddClientLevel}>
                        <input
                          type="text"
                          value={levelName}
                          onChange={(event) => setLevelName(event.target.value)}
                          placeholder="Nombre del nivel"
                          className="input-modern"
                        />
                        <input
                          type="number"
                          min="0"
                          value={levelMinPoints}
                          onChange={(event) => setLevelMinPoints(event.target.value)}
                          placeholder="Puntos mínimos requeridos"
                          className="input-modern"
                        />
                        <button type="submit" className="secondary-btn">
                          {editingLevelId ? 'Guardar cambios' : 'Agregar nivel'}
                        </button>
                        {editingLevelId ? (
                          <button
                            type="button"
                            onClick={() => {
                              resetLevelForm()
                              setError('')
                              setSuccessMessage('')
                            }}
                            className="ghost-btn"
                          >
                            Cancelar
                          </button>
                        ) : null}
                      </form>

                      <div className="rules-list">
                        {[...clientLevels]
                          .sort((a, b) => a.puntosMinimos - b.puntosMinimos)
                          .map((level) => (
                            <div key={level.id} className="rule-item">
                              <div>
                                <p className="rule-name">{level.nombre}</p>
                                <p className="rule-meta">
                                  Puntos mínimos: {level.puntosMinimos.toLocaleString('es-CR')} pts
                                </p>
                              </div>
                              <div className="rule-actions">
                                <button type="button" className="mini-btn" onClick={() => handleEditLevel(level)}>
                                  Editar
                                </button>
                                <button type="button" className="mini-btn danger" onClick={() => handleDeleteLevel(level.id)}>
                                  Eliminar
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {!cliente ? (
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

            {showRegisterModal ? (
              <div className="modal-overlay" onClick={() => setShowRegisterModal(false)}>
                <div className="config-card modal-card" onClick={(event) => event.stopPropagation()}>
                  <div className="card-title-row">
                    <div>
                      <p className="eyebrow">Nuevo ingreso</p>
                      <h3>Registrar cliente</h3>
                    </div>
                    <button type="button" className="close-modal-btn" onClick={() => setShowRegisterModal(false)}>
                      ✕
                    </button>
                  </div>
                  <p className="card-description">
                    Completa los datos del cliente para crear su perfil y comenzar su recorrido de puntos.
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
                  <div>
                    <p className="eyebrow">Cliente activo</p>
                    <h3>{cliente.nombre}</h3>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Puntos Disponibles
                    </p>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                      {puntosDisponibles.toLocaleString('es-CR')}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Premios Canjeados
                    </p>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                      {premiosCanjeados}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Nivel de Cliente
                    </p>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-amber-700">
                      {obtenerNivelCliente(puntosDisponibles)}
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

                <div className="quick-actions">
                  {[100, 250, 500].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => handleUpdatePoints(amount)}
                      disabled={updatingPoints}
                      className="quick-action-btn"
                    >
                      +{amount} pts
                    </button>
                  ))}
                </div>

                <div className="prizes-card">
                  <div className="card-title-row">
                    <div>
                      <p className="eyebrow">Catálogo</p>
                      <h3>Canjea tus puntos</h3>
                    </div>
                    <span className="points-pill">{puntosDisponibles} pts</span>
                  </div>

                  <div className="prizes-list">
                    {availablePrizeRules.map((premio) => {
                      const esCanjeable = puntosDisponibles >= (premio.puntosCosto ?? premio.costo)

                      return (
                        <button
                          key={premio.id}
                          type="button"
                          onClick={() => handleRedeemPrize(premio)}
                          disabled={updatingPoints || !esCanjeable}
                          className="prize-item"
                        >
                          <div>
                            <p className="prize-name">{premio.nombre}</p>
                            <p className="prize-description">{premio.descripcion}</p>
                          </div>
                          <span className="prize-cost">{premio.puntosCosto ?? premio.costo} pts</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
