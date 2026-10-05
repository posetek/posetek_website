// Isolated Auth only. The public form must never import the main Firebase
// module, Firestore, Functions, Storage, issue reporting or usage tracking.
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence, browserSessionPersistence, getAuth, getIdToken,
  indexedDBLocalPersistence, initializeAuth, onAuthStateChanged,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { feedbackAccountLabel } from "./feedback-identity";
import type { FeedbackAccount, FeedbackAuthAdapter } from "./feedback-identity";

const firebaseConfig = {
  apiKey: "AIzaSyBSfyXyhmD4kYGRSg-jOmGeLeOO8hX0-Gs",
  authDomain: "kickai-69dd0.firebaseapp.com",
  projectId: "kickai-69dd0",
  storageBucket: "kickai-69dd0.firebasestorage.app",
  messagingSenderId: "839600313930",
  appId: "1:839600313930:web:13b1e94c2c540561e3f8b3",
};

function account(user: User | null): FeedbackAccount | null {
  return user && !user.isAnonymous ? { uid: user.uid, label: feedbackAccountLabel(user) } : null;
}

export function createFeedbackAuthAdapter(): FeedbackAuthAdapter {
  const app = getApps().some(candidate => candidate.name === "[DEFAULT]") ? getApp() : initializeApp(firebaseConfig);
  let auth;
  try {
    // The main compat client uses these same default browser persistence layers
    // and app name. Omit popup/redirect resolvers: this page never signs in itself.
    auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] });
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "auth/already-initialized") throw error;
    auth = getAuth(app);
  }
  const client = auth;
  return {
    async ready() { await client.authStateReady(); return account(client.currentUser); },
    subscribe(listener, onError) { return onAuthStateChanged(client, user => listener(account(user)), onError); },
    isCurrent(uid) { return (account(client.currentUser)?.uid ?? null) === uid; },
    async tokenFor(uid) {
      const user = client.currentUser;
      if (!user || user.isAnonymous || user.uid !== uid) throw new Error("The signed-in account changed.");
      const token = await getIdToken(user, true);
      if (account(client.currentUser)?.uid !== uid) throw new Error("The signed-in account changed.");
      return token;
    },
  };
}
