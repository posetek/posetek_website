import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";
import "firebase/compat/storage";
import "firebase/compat/functions";
import { configureIssueIdentity, instrumentIssueCallable } from "./user-issues";
import { websiteEmulatorConfig } from "./firebase-emulator-config";

const firebaseConfig = {
  apiKey: "AIzaSyBSfyXyhmD4kYGRSg-jOmGeLeOO8hX0-Gs",
  authDomain: "kickai-69dd0.firebaseapp.com",
  projectId: "kickai-69dd0",
  storageBucket: "kickai-69dd0.firebasestorage.app",
  messagingSenderId: "839600313930",
  appId: "1:839600313930:web:13b1e94c2c540561e3f8b3",
};

// This mode exists only for local synthetic browser journeys. Missing or invalid
// ports fail before a client can fall through to the production project.
const emulator = import.meta.env.MODE === "posetek-emulator-e2e"
  ? websiteEmulatorConfig({ mode: import.meta.env.MODE, dev: import.meta.env.DEV,
    portOffset: import.meta.env.VITE_FIREBASE_EMULATOR_PORT_OFFSET ?? "" })
  : null;
if (emulator && firebase.apps.length) throw new Error("Emulator mode requires a fresh demo Firebase app");
if (!firebase.apps.length) firebase.initializeApp(emulator?.firebase ?? firebaseConfig);

const authClient = firebase.auth();
export const db = firebase.firestore();
export const storage = firebase.storage();
const functionsClient = firebase.app().functions("us-central1");
if (emulator) {
  const { auth: authEndpoint, firestore, storage: storageEndpoint, functions } = emulator.services;
  authClient.useEmulator(`http://${authEndpoint.host}:${authEndpoint.port}`);
  db.useEmulator(firestore.host, firestore.port);
  storage.useEmulator(storageEndpoint.host, storageEndpoint.port);
  functionsClient.useEmulator(functions.host, functions.port);
}
export const auth = new Proxy(authClient, { get(target, key) {
  const value = Reflect.get(target, key);
  if (typeof value !== "function") return value;
  const bound = value.bind(target);
  return /^(signInWithEmailAndPassword|createUserWithEmailAndPassword|sendPasswordResetEmail)$/.test(String(key)) ? instrumentIssueCallable(`auth_${String(key)}`, bound) : bound;
} });
configureIssueIdentity(() => auth.currentUser?.uid || null);
export const cloud = new Proxy(functionsClient, { get(target, key) {
  if (key === "httpsCallable") return (name: string, options?: firebase.functions.HttpsCallableOptions) => instrumentIssueCallable(name, target.httpsCallable(name, options));
  const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
} });
export default firebase;
