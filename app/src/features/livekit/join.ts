// app/src/features/livekit/join.ts
import { getAuth, signInAnonymously } from "firebase/auth";
import { loadConfig } from "../../config";
import { Room, RoomEvent, createLocalTracks } from 'livekit-client';

export async function fetchLiveKitToken(roomId: string) {
  if (!roomId) throw new Error("roomId is required");

  const cfg = await loadConfig();
  if (!cfg?.livekit?.host || !cfg?.livekit?.tokenEndpoint) {
    throw new Error("Missing livekit.host or livekit.tokenEndpoint in config.");
  }

  // Ensure we have an auth’d user
  const auth = getAuth();
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  const user = auth.currentUser!;
  const uid = user.uid;
  const idToken = await user.getIdToken();

  // Ask your backend for a LiveKit access token
  const url = `${cfg.livekit.tokenEndpoint}?room=${encodeURIComponent(roomId)}&identity=${encodeURIComponent(uid)}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${idToken}` },
    mode: "cors",
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Token endpoint ${resp.status}: ${text || resp.statusText}`);
  }

  const data = await resp.json().catch(() => ({} as any));
  const token: string | undefined = (data as any).token;
  if (!token) {
    throw new Error(`Token endpoint did not return { token }. Got: ${JSON.stringify(data)}`);
  }

  // Must be wss:// (or ws:// for localhost LiveKit server)
  const host = cfg.livekit.host;
  if (!/^wss?:\/\//i.test(host)) {
    throw new Error(`livekit.host must start with wss:// (or ws:// for localhost). Got: ${host}`);
  }

  // Connect & publish mic
  const room = new Room();
  room.on(RoomEvent.Connected, () => console.log("[LiveKit] connected"));
  room.on(RoomEvent.ConnectionStateChanged, (s) => console.log("[LiveKit] state:", s));
  room.on(RoomEvent.TrackSubscribed, (_t, _pub, p) => console.log("[LiveKit] track from", p.identity));

  await room.connect(host, token);

  const tracks = await createLocalTracks({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  for (const t of tracks) {
    await room.localParticipant.publishTrack(t);
  }

  return room;
}
