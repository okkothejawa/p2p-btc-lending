const isLocalStorageAvailable = (): boolean =>
    typeof window !== 'undefined' && 'localStorage' in window
  
  export const getFromLocalStorage = <T>(key: string, defaultValue: T): T => {
    try {
      if (isLocalStorageAvailable()) {
        const item = localStorage.getItem(key)
        if (item !== null) {
          return JSON.parse(item) as T
        }
      }
    } catch (error) {
      console.warn(`Error parsing localStorage item "${key}":`, error)
    }
    return defaultValue
  }
  
  export const addToLocalStorage = <T>(key: string, item: T): void => {
    if (isLocalStorageAvailable()) {
      const items = getFromLocalStorage<T[]>(key, [])
      // Add item only if it's not already present (works for primitives).
      if (
        !items.some(
          (existing) => JSON.stringify(existing) === JSON.stringify(item)
        )
      ) {
        items.push(item)
        localStorage.setItem(key, JSON.stringify(items))
      }
    }
  }
  
  export const setInLocalStorage = <T>(key: string, value: T): void => {
    if (isLocalStorageAvailable()) {
      localStorage.setItem(key, JSON.stringify(value))
    }
  }