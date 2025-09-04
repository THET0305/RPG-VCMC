import { getFirestore, doc, setDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

export async function createRoom(roomId: string) {
  const fs = getFirestore();
  const uid = getAuth().currentUser!.uid;
  await setDoc(doc(fs, 'rooms', roomId), {
    code: roomId,
    createdBy: uid,
    createdAt: serverTimestamp(),
  }, { merge: true });

  // Add the creator as GM
  await setDoc(doc(fs, 'rooms', roomId, 'members', uid), {
    role: 'gm',
    displayName: 'GM',
  }, { merge: true });
}

export async function joinRoom(roomId: string, displayName: string) {
  const fs = getFirestore();
  const uid = getAuth().currentUser!.uid;

  const room = await getDoc(doc(fs, 'rooms', roomId));
  if (!room.exists()) throw new Error('Room not found');

  await setDoc(doc(fs, 'rooms', roomId, 'members', uid), {
    role: 'player',
    displayName,
  }, { merge: true });
}
