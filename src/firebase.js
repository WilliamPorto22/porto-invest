import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyB7aeZnsTbfrsOyPBRL6FBvIKJgrkBkg1E",
  authDomain: "william-porto.firebaseapp.com",
  projectId: "william-porto",
  storageBucket: "william-porto.firebasestorage.app",
  messagingSenderId: "169446627134",
  appId: "1:169446627134:web:d1922bb76f65790217fe6f",
  measurementId: "G-QJPPFDWJ50"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, "southamerica-east1");
