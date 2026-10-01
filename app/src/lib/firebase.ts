import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";
import "firebase/compat/storage";
import "firebase/compat/functions";
import { configureIssueIdentity, instrumentIssueCallable } from "./user-issues";

const firebaseConfig = {
  apiKey: "AIzaSyBSfyXyhmD4kYGRSg-jOmGeLeOO8hX0-Gs",
  authDomain: "kickai-69dd0.firebaseapp.com",
  projectId: "kickai-69dd0",
  storageBucket: "kickai-69dd0.firebasestorage.app",
  messagingSenderId: "839600313930",
  appId: "1:839600313930:web:13b1e94c2c540561e3f8b3",
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

const authClient = firebase.auth();
export const auth = new Proxy(authClient, { get(target, key) {
  const value = Reflect.get(target, key);
  if (typeof value !== "function") return value;
  const bound = value.bind(target);
  return /^(signInWithEmailAndPassword|createUserWithEmailAndPassword|sendPasswordResetEmail)$/.test(String(key)) ? instrumentIssueCallable(`auth_${String(key)}`, bound) : bound;
} });
configureIssueIdentity(() => auth.currentUser?.uid || null);
export const db = firebase.firestore();
export const storage = firebase.storage();
const functionsClient = firebase.app().functions("us-central1");
export const cloud = new Proxy(functionsClient, { get(target, key) {
  if (key === "httpsCallable") return (name: string, options?: firebase.functions.HttpsCallableOptions) => instrumentIssueCallable(name, target.httpsCallable(name, options));
  const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
} });
export default firebase;
