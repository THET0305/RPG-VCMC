// app/src/firebase.ts
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { loadConfig } from './config';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Database | null = null;
let fs: Firestore | null = null;

export async function ensureFirebase() {
  if (app && auth && db && fs) return { app, auth, db, fs };

console.log('[firebase] calling loadConfig()');
const cfg = await loadConfig();
console.log('[firebase] got config (projectId=', cfg.firebase.projectId, ')');

  app = initializeApp(cfg.firebase);
  auth = getAuth(app);
  await signInAnonymously(auth);
  db = getDatabase(app);
  fs = getFirestore(app);

  return { app, auth, db, fs };
}
