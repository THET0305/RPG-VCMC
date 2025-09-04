import { useEffect, useState } from 'react'
import './App.css'
import { ensureFirebase } from './firebase'
import RoomPanel from './features/rooms/room_panel'

type BootStatus = 'boot' | 'ready' | 'error'

export default function App() {
  const [status, setStatus] = useState<BootStatus>('boot')
  const [err, setErr] = useState<string>('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await ensureFirebase()
        if (alive) setStatus('ready')
      } catch (e: any) {
        if (alive) {
          setErr(e?.message || String(e))
          setStatus('error')
        }
      }
    })()
    return () => { alive = false }
  }, [])

  if (status === 'boot') return <BootScreen />
  if (status === 'error') return <ErrorScreen message={err} />

  // status === 'ready'
  return (
    <>
      <h1>My App</h1>
      <RoomPanel />
    </>
  )
}

function BootScreen() {
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Loading…</h2>
      <p>Initializing app and loading <code>config.json</code>.</p>
    </div>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui', color: '#a00' }}>
      <h2>Startup error</h2>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{message}</pre>
      <p>
        Make sure <code>public/config.json</code> exists at the app root and is reachable.
      </p>
    </div>
  )
}
