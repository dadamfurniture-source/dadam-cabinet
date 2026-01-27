// Firebase Config
const firebaseConfig = {
  apiKey: 'AIzaSyAoTwIn902CXROs0arz_AlOYjgSAmVC6N4',
  authDomain: 'dadamfurniture-6370f.firebaseapp.com',
  projectId: 'dadamfurniture-6370f',
  storageBucket: 'dadamfurniture-6370f.firebasestorage.app',
  messagingSenderId: '187442540337',
  appId: '1:187442540337:web:dbf3570776dc1beb134a10',
  measurementId: 'G-DS44RZH7VS',
};

// Initialize Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
