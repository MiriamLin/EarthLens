import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

export function readStored<T>(key: string, fallback: T, accept: (value: unknown) => boolean = (value) => sameShape(value, fallback)): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const value: unknown = JSON.parse(raw)
    return accept(value) ? value as T : fallback
  } catch {
    return fallback
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

function sameShape(value: unknown, fallback: unknown) {
  if (Array.isArray(fallback)) return Array.isArray(value)
  if (fallback === null) return value === null
  return typeof value === typeof fallback && value !== null
}

export function usePersistentState<T>(key: string, initial: T, accept?: (value: unknown) => boolean): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readStored(key, initial, accept))

  useEffect(() => {
    writeStored(key, value)
  }, [key, value])

  return [value, setValue]
}
