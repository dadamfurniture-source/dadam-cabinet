/**
 * Firebase 설정
 *
 * 주의: js/config.js 파일이 먼저 로드되어야 합니다.
 * 설정값은 window.DADAM_CONFIG.firebase에서 가져옵니다.
 */

// 설정은 window.DADAM_CONFIG에서 가져옴 (js/config.js에서 정의)
const firebaseConfig = window.DADAM_CONFIG?.firebase || {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
  measurementId: '',
};

if (!window.DADAM_CONFIG?.firebase?.apiKey) {
  console.error('Firebase 설정이 없습니다. js/config.js 파일을 확인하세요.');
}

// Initialize Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
