'use client'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Configuration, FrontendApi, Session, Identity } from '@ory/client'

const ory = new FrontendApi(new Configuration({ basePath: '/kratos', baseOptions: { withCredentials: true } }))

interface AuthContextType {
  session: Session | null
  identity: Identity | null
  loading: boolean
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ory.toSession().then(({ data }) => setSession(data)).catch(() => setSession(null)).finally(() => setLoading(false))
  }, [])

  const logout = async () => {
    const { data } = await ory.createBrowserLogoutFlow()
    window.location.href = data.logout_url
  }

  return <AuthContext.Provider value={{ session, identity: session?.identity || null, loading, logout }}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
