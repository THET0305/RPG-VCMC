// app/src/features/livekit/join.ts
import { getAuth, signInAnonymously } from "firebase/auth";
import { loadConfig } from "../../config";
import {
  Room,
  RoomEvent,
  RemoteAudioTrack,
  RemoteVideoTrack,
  LocalTrackPublication,
  RemoteTrackPublication,
  Track,
  createLocalTracks,
  LocalVideoTrack,
  createLocalVideoTrack,
} from "livekit-client";

let currentRoom: Room | null = null;

// DOM mounts
let audioContainerEl: HTMLElement | undefined;
let remoteVideoContainerEl: HTMLElement | undefined;
let localVideoEl: HTMLVideoElement | undefined;

// bookkeeping for created elements
const audioEls = new Map<string, HTMLAudioElement>();
const videoEls = new Map<string, HTMLVideoElement>();

function attachRemoteAudio(track: RemoteAudioTrack, participantIdentity: string) {
  if (!audioContainerEl) return;
  const el = track.attach() as HTMLAudioElement;
  el.autoplay = true;
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
  [...audioEls.keys()].filter(k => k.startsWith(`${participantIdentity}:`)).forEach(k => {
    const el = audioEls.get(k);
    if (el?.parentNode) el.parentNode.removeChild(el);
    audioEls.delete(k);
  });
}
function detachAllRemoteAudio() {
  for (const [, el] of audioEls) if (el?.parentNode) el.parentNode.removeChild(el);
  audioEls.clear();
}

function attachRemoteVideo(track: RemoteVideoTrack, participantIdentity: string) {
  if (!remoteVideoContainerEl) return;
  const el = track.attach() as HTMLVideoElement;
  el.autoplay = true;
  el.playsInline = true; // valid on <video>
  el.style.maxWidth = "100%";
  el.style.borderRadius = "8px";
  el.dataset.participant = participantIdentity;
  remoteVideoContainerEl.appendChild(el);
  videoEls.set(`${participantIdentity}:${track.sid}`, el);
}
function detachRemoteVideo(participantIdentity: string, sid: string) {
  const key = `${participantIdentity}:${sid}`;
  const el = videoEls.get(key);
  if (el?.parentNode) el.parentNode.removeChild(el);
  videoEls.delete(key);
}
function detachAllRemoteVideoFor(participantIdentity: string) {
  [...videoEls.keys()].filter(k => k.startsWith(`${participantIdentity}:`)).forEach(k => {
    const el = videoEls.get(k);
    if (el?.parentNode) el.parentNode.removeChild(el);
    videoEls.delete(k);
  });
}
function detachAllRemoteVideo() {
  for (const [, el] of videoEls) if (el?.parentNode) el.parentNode.removeChild(el);
  videoEls.clear();
}

export async function joinLiveKit(
  roomId: string,
  mounts?: {
    audioContainer?: HTMLElement;
    remoteVideoContainer?: HTMLElement;
    localVideo?: HTMLVideoElement; // <video muted autoPlay> for local preview
  },
  opts?: {
    publishVideo?: boolean; // default false
    cameraFacingMode?: "user" | "environment"; // default "user"
  }
) {
  if (!roomId) throw new Error("roomId is required");
  if (currentRoom) await leaveLiveKit();

  const cfg = await loadConfig();
  const auth = getAuth();
  if (!auth.currentUser) await signInAnonymously(auth);
  const user = auth.currentUser!;
  const idToken = await user.getIdToken();

  const tokenUrl = `${cfg.livekit.tokenEndpoint}?room=${encodeURIComponent(roomId)}&identity=${encodeURIComponent(user.uid)}`;
  const resp = await fetch(tokenUrl, { headers: { Authorization: `Bearer ${idToken}` }, mode: "cors" });
  if (!resp.ok) throw new Error(`Token endpoint ${resp.status}: ${await resp.text()}`);
  const { token } = await resp.json();
  if (!token) throw new Error("Token endpoint did not return { token }");

  const host = cfg.livekit.host;
  if (!/^wss?:\/\//i.test(host)) throw new Error(`livekit.host must start with wss:// or ws://, got ${host}`);

  // capture mounts
  audioContainerEl = mounts?.audioContainer;
  remoteVideoContainerEl = mounts?.remoteVideoContainer;
  localVideoEl = mounts?.localVideo;

  const room = new Room();

  // subscribe handlers
  const onTrackSubscribed = (track: any, pub: RemoteTrackPublication, participant: any) => {
    if (track.kind === Track.Kind.Audio) {
      attachRemoteAudio(track as RemoteAudioTrack, participant.identity);
    } else if (track.kind === Track.Kind.Video) {
      attachRemoteVideo(track as RemoteVideoTrack, participant.identity);
    }
  };
  const onTrackUnsubscribed = (track: any, pub: RemoteTrackPublication, participant: any) => {
    if (track.kind === Track.Kind.Audio) {
      detachRemoteAudio(participant.identity, participant.sid);
    } else if (track.kind === Track.Kind.Video) {
      detachRemoteVideo(participant.identity, participant.sid);
    }
  };
  const onParticipantDisconnected = (p: any) => {
    detachAllRemoteAudioFor(p.identity);
    detachAllRemoteVideoFor(p.identity);
  };

  room
    .on(RoomEvent.TrackSubscribed, onTrackSubscribed)
    .on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
    .on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

  await room.connect(host, token);

  // Unlock audio playback after a user click; it's OK if this throws
  try { await room.startAudio(); } catch {}

  // Publish microphone always
  const baseTracks = await createLocalTracks({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  for (const t of baseTracks) await room.localParticipant.publishTrack(t);

  // Optionally publish camera now
  if (opts?.publishVideo) {
    await startCamera({ facingMode: opts.cameraFacingMode ?? "user" });
  }

  currentRoom = room;
  room.once(RoomEvent.Disconnected, () => {
    detachAllRemoteAudio();
    detachAllRemoteVideo();
    audioContainerEl = undefined;
    remoteVideoContainerEl = undefined;
    localVideoEl = undefined;
    currentRoom = null;
  });

  return room;
}

export async function preflightCameraPermission(): Promise<void> {
  // Must be called from a user gesture (e.g., button click)
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera not supported in this browser');
  }
  // Trigger the permission prompt ASAP
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  // We only needed the prompt; release the temp stream
  for (const t of stream.getTracks()) t.stop();
}

/** Start (or restart) the local camera and publish it. Shows preview in mounted localVideoEl if provided. */
export async function startCamera(params?: { facingMode?: "user" | "environment" }) {
  if (!currentRoom) throw new Error("Not connected");
  const vtrack: LocalVideoTrack = await createLocalVideoTrack({
    facingMode: params?.facingMode ?? "user",
    resolution: { width: 1280, height: 720 },
  });
  // publish
  await currentRoom.localParticipant.publishTrack(vtrack);
  // local preview
  if (localVideoEl) {
    vtrack.attach(localVideoEl);
    localVideoEl.muted = true;
    localVideoEl.autoplay = true;
    localVideoEl.playsInline = true;
  }
}

/** Stop/unpublish the local camera and clear local preview. */
export async function stopCamera() {
  if (!currentRoom) return;
  const pubs = [...currentRoom.localParticipant.videoTrackPublications.values()] as LocalTrackPublication[];
  for (const pub of pubs) {
    const track = pub.track;
    await currentRoom.localParticipant.unpublishTrack(track!, true /* stopOnUnpublish */);
    track?.stop();
  }
  if (localVideoEl) {
    try {
      localVideoEl.srcObject = null;
      localVideoEl.removeAttribute("src");
      localVideoEl.load();
    } catch {}
  }
}

/** Leave room: stop/unpublish local tracks, disconnect, and clean DOM. */
export async function leaveLiveKit() {
  if (!currentRoom) return;
  const room = currentRoom;

  // Unpublish + stop local tracks (mic & cam)
  try {
    const pubs = [...room.localParticipant.trackPublications.values()] as LocalTrackPublication[];
    for (const pub of pubs) {
      const track = pub.track;
      await room.localParticipant.unpublishTrack(track!, true);
      track?.stop();
    }
  } catch {}

  detachAllRemoteAudio();
  detachAllRemoteVideo();

  try { await room.disconnect(); } catch {}

  audioContainerEl = undefined;
  remoteVideoContainerEl = undefined;
  localVideoEl = undefined;
  currentRoom = null;
}

/** Expose the active room if needed */
export function getActiveRoom(): Room | null {
  return currentRoom;
}
