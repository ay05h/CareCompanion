// src/lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// 🔧 Replace with your Firebase project config from the Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyDT49dAyMFSn-0ZFZn2gx1KyEEeukXohME",
  authDomain: "medical-ai-f790e.firebaseapp.com",
  projectId: "medical-ai-f790e",
  storageBucket: "medical-ai-f790e.firebasestorage.app",
  messagingSenderId: "868575767867",
  appId: "1:868575767867:web:f62e760cfdd2db6e265b1e",
  measurementId: "G-VM2YWMXL80"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
