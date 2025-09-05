// app/src/features/livekit/join.ts
import { getAuth, signInAnonymously } from "firebase/auth";
import { loadConfig } from "../../config";
import {
  Room,
  RoomEvent,
  RemoteAudioTrack,
  Track,
  createLocalTracks,
  LocalTrackPublication,
  RemoteTrackPublication,
} from "livekit-client";

/** Hold the active room + audio elements so we can clean them up on leave */
let currentRoom: Room | null = null;
const audioEls = new Map<string, HTMLAudioElement>();
let audioContainerEl: HTMLElement | undefined;

function attachRemoteAudio(track: RemoteAudioTrack, participantIdentity: string) {
  if (!audioContainerEl) return;
  const el = track.attach() as HTMLAudioElement; // LiveKit returns an <audio> for audio tracks
  el.autoplay = true;
  // el.playsInline = true; // not needed/valid for <audio>
  audioContainerEl.appendChild(el);
  audioEls.set(`${participantIdentity}:${track.sid}`, el);
}

function detachRemoteAudio(participantIdentity: string, sid: string) {
  const key = `${participantIdentity}:${sid}`;
  const el = audioEls.get(key);
  if (el?.parentNode) el.parentNode.removeChild(el);
  audioEls.delete(key);
}

function detachAllRemoteAudioFor(participantIdentity: string) {
  [...audioEls.keys()]
    .filter((k) => k.startsWith(`${participantIdentity}:`))
    .forEach((k) => {
      const el = audioEls.get(k);
      if (el?.parentNode) el.parentNode.removeChild(el);
      audioEls.delete(k);
    });
}

function detachAllRemoteAudio() {
  for (const [, el] of audioEls) {
    if (el?.parentNode) el.parentNode.removeChild(el);
  }
  audioEls.clear();
}

/**
 * Joins a LiveKit room, publishes mic, and attaches remote audio.
 * Returns the connected Room.
 */
export async function joinLiveKit(roomId: string, audioContainer?: HTMLElement) {
  if (!roomId) throw new Error("roomId is required");
  if (currentRoom) {
    // Already connected — leave first to avoid double connections
    await leaveLiveKit();
  }

  const cfg = await loadConfig();
  const auth = getAuth();
  if (!auth.currentUser) await signInAnonymously(auth);
  const user = auth.currentUser!;
  const idToken = await user.getIdToken();

  const tokenUrl = `${cfg.livekit.tokenEndpoint}?room=${encodeURIComponent(
    roomId
  )}&identity=${encodeURIComponent(user.uid)}`;

  const resp = await fetch(tokenUrl, {
    headers: { Authorization: `Bearer ${idToken}` },
    mode: "cors",
  });
  if (!resp.ok) throw new Error(`Token endpoint ${resp.status}: ${await resp.text()}`);
  const { token } = await resp.json();
  if (!token) throw new Error("Token endpoint did not return { token }");

  const host = cfg.livekit.host;
  if (!/^wss?:\/\//i.test(host)) {
    throw new Error(`livekit.host must start with wss:// or ws://, got ${host}`);
  }

  const room = new Room();
  audioContainerEl = audioContainer;

  // Wire essential listeners (for audio attach/detach + basic visibility)
  const onTrackSubscribed = (track: any, pub: RemoteTrackPublication, participant: any) => {
    if (track.kind === Track.Kind.Audio) {
      attachRemoteAudio(track as RemoteAudioTrack, participant.identity);
    }
  };
  const onTrackUnsubscribed = (_track: any, pub: RemoteTrackPublication, participant: any) => {
    detachRemoteAudio(participant.identity, participant.sid);
  };
  const onParticipantDisconnected = (p: any) => {
    detachAllRemoteAudioFor(p.identity);
  };

  room
    .on(RoomEvent.TrackSubscribed, onTrackSubscribed)
    .on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
    .on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

  // Connect
  await room.connect(host, token);

  // Unlock audio after a user gesture; in most UIs this is called right after the click
  try {
    await room.startAudio();
  } catch {
    // ignore; UI can offer a "click to unmute" button that calls room.startAudio()
  }

  // Publish mic
  const tracks = await createLocalTracks({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  for (const t of tracks) {
    await room.localParticipant.publishTrack(t);
  }

  // Save room + add a cleanup listener if server disconnects
  currentRoom = room;
  room.once(RoomEvent.Disconnected, () => {
    detachAllRemoteAudio();
    audioContainerEl = undefined;
    currentRoom = null;
  });

  return room;
}

/**
 * Leaves the active LiveKit room, unpublishing/stopping local tracks,
 * disconnecting, removing listeners, and cleaning DOM audio elements.
 */
export async function leaveLiveKit() {
  if (!currentRoom) return;

  const room = currentRoom;

  // Unpublish + stop local tracks to release mic
  try {
    const pubs = [...room.localParticipant.trackPublications.values()] as LocalTrackPublication[];
    for (const pub of pubs) {
      try {
        const track = pub.track;
        await room.localParticipant.unpublishTrack(track!, true /* stopOnUnpublish */);
        // stopOnUnpublish covers stopping; but double-stop safely if needed:
        track?.stop();
      } catch {}
    }
  } catch {}

  // Detach all remote audio <audio> els from the DOM
  detachAllRemoteAudio();

  // Disconnect the room (removes server resources + subscribers)
  try {
    await room.disconnect();
  } catch {}

  // Clear refs
  audioContainerEl = undefined;
  currentRoom = null;
}

/** Helper if your UI wants to know whether we’re currently connected */
export function getActiveRoom(): Room | null {
  return currentRoom;
}
