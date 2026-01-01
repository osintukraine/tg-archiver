'use client'
import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { FrontendApi, Configuration, RecoveryFlow } from '@ory/client'

const ory = new FrontendApi(new Configuration({ basePath: '/kratos', baseOptions: { withCredentials: true } }))

export default function RecoveryPage() {
  const [flow, setFlow] = useState<RecoveryFlow>()
  const [submitted, setSubmitted] = useState(false)
  const searchParams = useSearchParams()
  const router = useRouter()
  const flowId = searchParams?.get('flow')

  useEffect(() => {
    if (flowId) {
      ory.getRecoveryFlow({ id: flowId }).then(({ data }) => setFlow(data)).catch(() => router.push('/auth/recovery'))
    } else {
      ory.createBrowserRecoveryFlow().then(({ data }) => router.push(`/auth/recovery?flow=${data.id}`))
    }
  }, [flowId, router])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!flow) return
    const formData = new FormData(e.currentTarget)
    try {
      await ory.updateRecoveryFlow({ flow: flow.id, updateRecoveryFlowBody: { method: 'code', email: formData.get('email') as string } })
      setSubmitted(true)
    } catch (err: any) {
      setFlow(err.response?.data)
    }
  }

  if (!flow) return <div>Loading...</div>
  if (submitted) return <div className="min-h-screen flex items-center justify-center"><div className="text-center"><h1 className="text-2xl mb-4">Check Your Email</h1><p>Recovery instructions sent.</p></div></div>

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-md p-8 bg-white shadow rounded">
        <h1 className="text-2xl mb-6">Recover Account</h1>
        {flow.ui.messages?.map((msg, i) => <div key={i} className="mb-4 text-red-600">{msg.text}</div>)}
        <input name="email" type="email" placeholder="Email" className="w-full mb-4 p-2 border rounded" required />
        <button type="submit" className="w-full bg-blue-600 text-white p-2 rounded">Send Recovery Email</button>
        <a href="/auth/login" className="block mt-4 text-center text-blue-600">Back to Sign In</a>
      </form>
    </div>
  )
}
