import { useEffect, useRef, useState } from 'react'
import { createRoom, joinRoom } from './api'
import {
  collection, onSnapshot, query, orderBy, getFirestore
} from 'firebase/firestore'
import { ensureFirebase } from '../../firebase'
import {
  joinLiveKit,
  leaveLiveKit,
  getActiveRoom,
  startCamera,
  stopCamera,
  preflightCameraPermission, // 👈 NEW
} from '../livekit/join'

type Member = { id: string; role: string; displayName: string }

function randomRoomCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
  return Array.from({ length: len }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

export default function RoomPanel() {
  const [roomId, setRoomId] = useState(localStorage.getItem('roomId') || '')
  const [displayName, setDisplayName] = useState(localStorage.getItem('displayName') || '')
  const [members, setMembers] = useState<Member[]>([])
  const [status, setStatus] = useState<string>('')

  // A/V state + mounts
  const audioRef = useRef<HTMLDivElement>(null)               // remote <audio> elements mount here
  const remoteVideoRef = useRef<HTMLDivElement>(null)         // remote <video> elements grid
  const localVideoRef = useRef<HTMLVideoElement>(null)        // local preview <video>
  const [avStatus, setAvStatus] = useState<'idle'|'joining'|'joined'>('idle')
  const [avError, setAvError] = useState<string>('')

  // Init Firebase (and sign-in anon inside join.ts when needed)
  useEffect(() => {
    ensureFirebase().catch((e) => setStatus(`Init error: ${String(e)}`))
  }, [])

  // Live members list when roomId is present
  useEffect(() => {
    if (!roomId) { setMembers([]); return }
    const db = getFirestore()
    const q = query(collection(db, 'rooms', roomId, 'members'), orderBy('displayName'))
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Member[]
      setMembers(rows)
    }, (err) => setStatus(`Members error: ${err.message}`))
    return () => unsub()
  }, [roomId])

  // ----- Room create/join/leave (Firestore presence) -----
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

  async function handleLeave() {
    // Leave LiveKit if connected
    if (getActiveRoom()) {
      try { await leaveLiveKit() } catch {}
      setAvStatus('idle'); setAvError('')
    }
    // Simple client-side room leave (presence rules may clean server-side)
    localStorage.removeItem('roomId')
    setRoomId('')
    setMembers([])
    setStatus('Left room (client-only)')
  }

  // ----- A/V controls -----
  const avConnected = !!getActiveRoom()

  async function handleJoinAV() {
    if (!roomId) { setAvError('Enter or create a room first'); return }
    setAvError(''); setAvStatus('joining')
    try {
      // 1) Prompt camera **immediately on click** to guarantee the browser permission dialog
      await preflightCameraPermission();

      // 2) Join LiveKit (don’t publish video yet)
      const room = await joinLiveKit(
        roomId,
        {
          audioContainer: audioRef.current || undefined,
          remoteVideoContainer: remoteVideoRef.current || undefined,
          localVideo: localVideoRef.current || undefined,
        },
        {
          publishVideo: false,     // we'll start camera right after join
          cameraFacingMode: 'user'
        }
      );
      (window as any).__room = room; // debug handle

      // 3) Unlock audio playback and **start the camera** (still in the same click chain)
      try { await room.startAudio() } catch {}
      await startCamera({ facingMode: 'user' });

      setAvStatus('joined')
    } catch (e:any) {
      // Give specific hint if the user blocked the camera
      setAvError(
        e?.name === 'NotAllowedError'
          ? 'Camera permission blocked. Click the lock icon in the address bar → Site settings → Allow Camera.'
          : (e?.message || 'Failed to join A/V')
      )
      setAvStatus('idle')
    }
  }

  async function handleLeaveAV() {
    try { await leaveLiveKit() } finally {
      setAvStatus('idle'); setAvError('')
    }
  }

  async function handleStartCam() {
    try { await startCamera({ facingMode: 'user' }) }
    catch (e:any) { setAvError(e?.message || 'Failed to start camera') }
  }

  async function handleStopCam() {
    try { await stopCamera() }
    catch (e:any) { setAvError(e?.message || 'Failed to stop camera') }
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

      {/* A/V controls appear when a room code exists */}
      {roomId && (
        <div style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <h3>A/V</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {!avConnected ? (
              <button onClick={handleJoinAV} disabled={avStatus === 'joining'}>
                {avStatus === 'joining' ? 'Joining A/V…' : 'Join A/V'}
              </button>
            ) : (
              <>
                <button onClick={handleLeaveAV}>Leave A/V</button>
                <button onClick={handleStartCam}>Start Camera</button>
                <button onClick={handleStopCam}>Stop Camera</button>
              </>
            )}
            {avConnected && <span>✅ Connected</span>}
            {avError && <span style={{ color: 'crimson' }}>⚠️ {avError}</span>}
          </div>

          {/* Local preview */}
          <div style={{ marginTop: 12 }}>
            <h4 style={{ margin: '8px 0' }}>Your Camera</h4>
            <video
              ref={localVideoRef}
              muted
              autoPlay
              playsInline
              style={{ width: '100%', maxHeight: 240, background: '#000', borderRadius: 8 }}
            />
          </div>

          {/* Remote videos grid */}
          <div style={{ marginTop: 12 }}>
            <h4 style={{ margin: '8px 0' }}>Remote Participants</h4>
            <div
              ref={remoteVideoRef}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 8
              }}
            />
          </div>

          {/* Remote <audio> elements (invisible) */}
          <div ref={audioRef} />
        </div>
      )}

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
