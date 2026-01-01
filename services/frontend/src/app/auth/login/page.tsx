'use client'
import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { FrontendApi, Configuration, LoginFlow } from '@ory/client'

const ory = new FrontendApi(new Configuration({ basePath: '/kratos', baseOptions: { withCredentials: true } }))

export default function LoginPage() {
  const [flow, setFlow] = useState<LoginFlow>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const flowId = searchParams?.get('flow')

  useEffect(() => {
    if (flowId) {
      ory.getLoginFlow({ id: flowId }).then(({ data }) => setFlow(data)).catch(() => router.push('/auth/login'))
    } else {
      ory.createBrowserLoginFlow().then(({ data }) => router.push(`/auth/login?flow=${data.id}`))
    }
  }, [flowId, router])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!flow) return
    const formData = new FormData(e.currentTarget)
    try {
      await ory.updateLoginFlow({ flow: flow.id, updateLoginFlowBody: { method: 'password', password: formData.get('password') as string, identifier: formData.get('identifier') as string } })
      router.push('/')
    } catch (err: any) {
      setFlow(err.response?.data)
    }
  }

  if (!flow) return <div>Loading...</div>

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-md p-8 bg-white shadow rounded">
        <h1 className="text-2xl mb-6">Sign In</h1>
        {flow.ui.messages?.map((msg, i) => <div key={i} className="mb-4 text-red-600">{msg.text}</div>)}
        <input name="identifier" type="text" placeholder="Email" className="w-full mb-4 p-2 border rounded" required />
        <input name="password" type="password" placeholder="Password" className="w-full mb-4 p-2 border rounded" required />
        <button type="submit" className="w-full bg-blue-600 text-white p-2 rounded">Sign In</button>
        <a href="/auth/registration" className="block mt-4 text-center text-blue-600">Create Account</a>
      </form>
    </div>
  )
}
