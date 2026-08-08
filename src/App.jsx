import { useState } from 'react'
import { addDoc, collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { db } from './lib/firebase'

const premios = [
  {
    id: 'descuento-10',
    nombre: 'Descuento 10%',
    descripcion: 'Vale para tu próxima compra.',
    costo: 300,
  },
  {
    id: 'producto-gratis',
    nombre: 'Producto gratis',
    descripcion: 'Un producto sorpresa en tienda.',
    costo: 800,
  },
  {
    id: 'visita-premium',
    nombre: 'Visita premium',
    descripcion: 'Atención especial y beneficios exclusivos.',
    costo: 1500,
  },
]

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

    if (puntosActuales < premio.costo) return

    setUpdatingPoints(true)
    setError('')

    try {
      const clienteDocRef = doc(db, 'clientes', cliente.id)
      const nextPoints = puntosActuales - premio.costo

      await updateDoc(clienteDocRef, { puntos: nextPoints })
      setCliente((currentCliente) => (
        currentCliente ? { ...currentCliente, puntos: nextPoints } : currentCliente
      ))
    } catch (err) {
      setError('No se pudo canjear el premio. Intenta nuevamente.')
      console.error(err)
    } finally {
      setUpdatingPoints(false)
    }
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
      setSuccessMessage('¡Cliente registrado con éxito!')
    } catch (err) {
      setError('No se pudo registrar al cliente. Intenta nuevamente.')
      console.error(err)
    } finally {
      setRegistroLoading(false)
    }
  }

  const puntosDisponibles = cliente ? (cliente.puntos ?? 0) : 0

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-100 via-rose-50 to-fuchsia-100 px-4 py-10 text-slate-800">
      <section className="w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 shadow-[0_25px_80px_-20px_rgba(15,23,42,0.35)] backdrop-blur-xl">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="bg-gradient-to-br from-fuchsia-600 via-violet-600 to-indigo-700 p-8 text-white sm:p-10 lg:p-12">
            <p className="mb-4 inline-flex rounded-full bg-white/20 px-3 py-1 text-sm font-semibold uppercase tracking-[0.3em]">
              Sistema de fidelidad
            </p>
            <h1 className="mb-4 text-4xl font-black leading-tight sm:text-5xl">
              Busca a tus clientes en segundos.
            </h1>
            <p className="max-w-md text-lg text-fuchsia-50/90">
              Consulta el estado de puntos y canjea premios con una sola búsqueda.
            </p>
          </div>

          <div className="p-8 sm:p-10 lg:p-12">
            <form className="space-y-5" onSubmit={handleSearch}>
              <div>
                <label htmlFor="telefono" className="mb-2 block text-sm font-semibold text-slate-700">
                  Número de teléfono
                </label>
                <input
                  id="telefono"
                  name="telefono"
                  type="tel"
                  value={telefono}
                  onChange={(event) => setTelefono(event.target.value)}
                  placeholder="Ej. 5512345678"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base shadow-sm outline-none transition focus:border-fuchsia-500 focus:bg-white focus:ring-4 focus:ring-fuchsia-200"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-4 py-3 text-base font-semibold text-white shadow-lg transition hover:scale-[1.01] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? 'Buscando...' : 'Buscar cliente'}
              </button>
            </form>

            <div className="mt-6 min-h-[280px]">
              {error ? (
                <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm font-medium text-rose-700">
                  {error}
                </div>
              ) : null}

              {successMessage ? (
                <div className="mb-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-medium text-emerald-700">
                  {successMessage}
                </div>
              ) : null}

              {!cliente ? (
                <div className="rounded-[1.5rem] border border-gray-100 bg-white p-6 shadow-md">
                  <h2 className="mb-2 text-xl font-black text-slate-900">Registrar nuevo cliente</h2>
                  <p className="mb-5 text-sm text-slate-500">
                    Ingresa los datos del cliente para crear su perfil y empezar con 0 puntos.
                  </p>

                  <form className="space-y-4" onSubmit={handleRegisterClient}>
                    <div>
                      <input
                        id="nombre"
                        name="nombre"
                        type="text"
                        value={nombre}
                        onChange={(event) => setNombre(event.target.value)}
                        placeholder="Nombre del cliente"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-purple-500 focus:bg-white focus:ring-2 focus:ring-purple-200"
                      />
                    </div>

                    <div>
                      <input
                        id="telefonoRegistro"
                        name="telefonoRegistro"
                        type="tel"
                        value={telefonoRegistro}
                        onChange={(event) => setTelefonoRegistro(event.target.value)}
                        placeholder="Número de teléfono"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-purple-500 focus:bg-white focus:ring-2 focus:ring-purple-200"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={registroLoading}
                      className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {registroLoading ? 'Registrando...' : 'Registrar cliente'}
                    </button>
                  </form>
                </div>
              ) : null}

              {cliente ? (
                <div className="rounded-[1.75rem] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-700">
                      Cliente encontrado
                    </span>
                    <span className="text-sm font-medium text-slate-500">{cliente.telefono}</span>
                  </div>

                  <h2 className="mb-2 text-3xl font-black text-slate-900">{cliente.nombre}</h2>
                  <p className="mb-6 text-sm text-slate-500">Cliente activo en tu programa de fidelidad</p>

                  <div className="rounded-3xl bg-slate-900 p-6 text-white shadow-inner">
                    <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">
                      Puntos actuales
                    </p>
                    <p className="mt-2 text-5xl font-black sm:text-6xl">{cliente.puntos ?? 0}</p>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-3">
                    {[100, 250, 500].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => handleUpdatePoints(amount)}
                        disabled={updatingPoints}
                        className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 px-4 py-2 text-sm font-semibold text-fuchsia-700 transition hover:bg-fuchsia-100 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        +{amount} pts
                      </button>
                    ))}
                  </div>

                  <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-fuchsia-600">
                          Catálogo de premios
                        </p>
                        <h3 className="mt-1 text-xl font-black text-slate-900">Canjea tus puntos</h3>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                        {puntosDisponibles} pts
                      </span>
                    </div>

                    <div className="space-y-3">
                      {premios.map((premio) => {
                        const esCanjeable = puntosDisponibles >= premio.costo

                        return (
                          <button
                            key={premio.id}
                            type="button"
                            onClick={() => handleRedeemPrize(premio)}
                            disabled={updatingPoints || !esCanjeable}
                            className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-fuchsia-300 hover:bg-fuchsia-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{premio.nombre}</p>
                              <p className="text-sm text-slate-500">{premio.descripcion}</p>
                            </div>
                            <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700 shadow-sm">
                              {premio.costo} pts
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
