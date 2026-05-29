import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCr0Y3kUwcHBM61CVTNhGJzZJgHZUX6zEs",
  authDomain: "habit-tracker-b709b.firebaseapp.com",
  projectId: "habit-tracker-b709b",
  storageBucket: "habit-tracker-b709b.firebasestorage.app",
  messagingSenderId: "91312143765",
  appId: "1:91312143765:web:8868653deae5f45e4f8a9c"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();