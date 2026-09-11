/** Deja solo dígitos para comparar teléfonos sin importar espacios o guiones. */
export const normalizeClientPhone = (value) => String(value ?? '').replace(/\D/g, '')
