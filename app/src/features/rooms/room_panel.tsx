import { useEffect, useMemo, useState } from 'react'
import { createRoom, joinRoom } from './api'
import {
  collection, onSnapshot, query, orderBy, getFirestore
} from 'firebase/firestore'
import { ensureFirebase } from '../../firebase'

function randomRoomCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
  return Array.from({ length: len }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

export default function RoomPanel() {
  const [roomId, setRoomId] = useState(localStorage.getItem('roomId') || '')
  const [displayName, setDisplayName] = useState(localStorage.getItem('displayName') || '')
  const [members, setMembers] = useState<{id:string; role:string; displayName:string}[]>([])
  const [status, setStatus] = useState<string>('')

  useEffect(() => {
    // Ensure Firebase initialized & user signed in
    ensureFirebase().catch((e) => setStatus(`Init error: ${String(e)}`))
  }, [])

  // Live members list when roomId is set
  useEffect(() => {
    if (!roomId) { setMembers([]); return }
    const db = getFirestore()
    const q = query(collection(db, 'rooms', roomId, 'members'), orderBy('displayName'))
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
      setMembers(rows)
    }, (err) => setStatus(`Members error: ${err.message}`))
    return () => unsub()
  }, [roomId])

  async function handleCreate() {
    const code = roomId || randomRoomCode()
    try {
      setStatus('Creating room…')
      await createRoom(code)
      setRoomId(code)
      localStorage.setItem('roomId', code)
      setStatus(`Room ${code} created`)
    } catch (e:any) {
      setStatus(`Create failed: ${e.message || String(e)}`)
    }
  }

  async function handleJoin() {
    if (!roomId) return setStatus('Enter a room code')
    if (!displayName.trim()) return setStatus('Enter a display name')
    try {
      setStatus('Joining room…')
      await joinRoom(roomId, displayName.trim())
      localStorage.setItem('roomId', roomId)
      localStorage.setItem('displayName', displayName.trim())
      setStatus(`Joined ${roomId} as ${displayName.trim()}`)
    } catch (e:any) {
      setStatus(`Join failed: ${e.message || String(e)}`)
    }
  }

  function handleLeave() {
    // simple client-side leave (clear local state)
    localStorage.removeItem('roomId')
    setRoomId('')
    setMembers([])
    setStatus('Left room (client-only)')
  }

  return (
    <div className="card" style={{ maxWidth: 720, margin: '1rem auto', textAlign: 'left' }}>
      <h2 style={{ marginTop: 0 }}>Rooms</h2>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
        {/* Create */}
        <div>
          <h3>Create a room</h3>
          <label>
            Room Code (optional — leave blank to auto-generate)
            <input
              style={{ width: '100%' }}
              placeholder="e.g. ABC123"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            />
          </label>
          <button onClick={handleCreate} style={{ marginTop: 8 }}>Create room</button>
        </div>

        {/* Join */}
        <div>
          <h3>Join a room</h3>
          <label>
            Room Code
            <input
              style={{ width: '100%' }}
              placeholder="ABC123"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            />
          </label>
          <label>
            Display Name
            <input
              style={{ width: '100%' }}
              placeholder="Your name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={handleJoin}>Join room</button>
            <button onClick={handleLeave} type="button">Leave</button>
          </div>
        </div>
      </div>

      <p style={{ marginTop: 12, minHeight: 24 }}>
        <em>Status:</em> {status || 'Ready'}
      </p>

      {roomId && (
        <>
          <h3>Members in {roomId}</h3>
          {members.length === 0 ? (
            <p>No members yet.</p>
          ) : (
            <ul>
              {members.map(m => (
                <li key={m.id}>
                  <strong>{m.displayName || '(unnamed)'}</strong> — {m.role} <small>({m.id})</small>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
