import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { AccessToken } from "livekit-server-sdk";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params"; 

setGlobalOptions({ region: "us-central1" });

// Declare secrets (names must match what you set via CLI)
const LIVEKIT_API_KEY   = defineSecret("LIVEKIT_API_KEY");
const LIVEKIT_API_SECRET= defineSecret("LIVEKIT_API_SECRET");
const LIVEKIT_HOST      = defineSecret("LIVEKIT_HOST"); // optional if you need it

// Initialize Admin once
try { admin.app(); } catch { admin.initializeApp(); }
const fs = admin.firestore();

export const livekitToken = onRequest(
  // Public at the edge so browsers can reach it;
  // actual security is enforced below via Firebase Auth verification.
  { 
    invoker: "public",
    // Ensure secrets are mounted for this function
    secrets: [LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_HOST],
  },
  
  async (req, res) => {
    // ----- CORS -----
    const allowed = new Set([
      "http://localhost:5173",               // dev
      // "https://your-prod-domain.com",     // add prod domain when ready
    ]);
    const origin = req.headers.origin || "";
    if (allowed.has(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
    } else {
      // During dev you can use '*', but locking to known origins is safer.
      res.set("Access-Control-Allow-Origin", "*");
    }
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return; // IMPORTANT: stop here
    }

    try {
      // ----- AuthN: verify Firebase ID token from Authorization: Bearer <idToken> -----
      const authz = req.headers.authorization || "";
      const m = authz.match(/^Bearer (.+)$/);
      if (!m) {
        res.status(401).json({ error: "missing_bearer_token" });
        return;
      }
      const idToken = m[1];
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;

      // ----- Params -----
      const room = String(req.query.room || "");
      if (!room) {
        res.status(400).json({ error: "missing_room" });
        return;
      }

      // ----- AuthZ: ensure caller is a member of this room -----
      const memberDoc = await fs.doc(`rooms/${room}/members/${uid}`).get();
      if (!memberDoc.exists) {
        res.status(403).json({ error: "not_a_room_member" });
        return;
      }
      const role = (memberDoc.data()?.role as string) || "player";

      // ----- Secrets -----
      const apiKey = process.env.LIVEKIT_API_KEY!;
      const apiSecret = process.env.LIVEKIT_API_SECRET!;
      if (!apiKey || !apiSecret) {
        res.status(500).json({ error: "server_secrets_not_configured" });
        return;
      }

      // ----- Mint LiveKit token -----
      const at = new AccessToken(apiKey, apiSecret, { identity: uid /* metadata?: ... */ });
      at.addGrant({
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
      });

      const token = await at.toJwt();
      res.status(200).json({ token, role });
      return; // ensure handler returns void
    } catch (e) {
      logger.error(e);
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }
);
