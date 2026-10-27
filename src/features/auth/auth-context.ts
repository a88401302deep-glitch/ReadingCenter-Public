import { createContext, useContext } from 'react'

export interface AuthContextValue {
  authEnabled: boolean
  localAccess?: boolean
  previewReadOnly?: boolean
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({ authEnabled: false, logout: async () => undefined })

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
