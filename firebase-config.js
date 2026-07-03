import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyDC3XkjGSipCoVgTKuGSHpTl-H80ehcBCg",
  authDomain: "earninmath.firebaseapp.com",
  databaseURL: "https://earninmath-default-rtdb.firebaseio.com",
  projectId: "earninmath",
  storageBucket: "earninmath.firebasestorage.app",
  messagingSenderId: "116671428757",
  appId: "1:116671428757:web:e78bb972a20e6f1fe4039c",
  measurementId: "G-YSG0NVLFP3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const fn = getFunctions(app);

export { app, auth, db, fn };