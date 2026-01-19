import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Handle Auth State Changes
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // User is signed in
        let role = 'customer';
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                role = userDoc.data().role || 'customer';
            }
        } catch (e) {
            console.error("Error fetching user role:", e);
        }

        console.log("Logged in as:", user.email, "Role:", role);
        updateUIForUser(user, role);
    } else {
        // User is signed out
        console.log("Logged out");
        updateUIForGuest();
    }
});

function updateUIForUser(user, role) {
    // Defines UI elements that might exist on various pages
    const loginLink = document.getElementById('nav-login-link');
    if (loginLink) {
        loginLink.innerHTML = `<span>프로필</span>`;
        loginLink.href = 'profile.html';
    }

    // Profile page specific updates
    const userEmailEl = document.getElementById('user-email');
    const userRoleEl = document.getElementById('user-role');
    const proSection = document.getElementById('pro-upgrade-section');

    if (userEmailEl) userEmailEl.textContent = user.email;
    if (userRoleEl) {
        const roleName = role === 'professional' ? '전문가 (Professional)' :
            role === 'admin' ? '관리자 (Admin)' : '고객 (Customer)';
        userRoleEl.textContent = roleName;
    }

    if (proSection) {
        if (role === 'professional' || role === 'admin') {
            proSection.style.display = 'none';
        } else {
            proSection.style.display = 'block';
        }
    }
}

function updateUIForGuest() {
    const loginLink = document.getElementById('nav-login-link');
    if (loginLink) {
        loginLink.innerHTML = `<span>로그인</span>`;
        loginLink.href = 'login.html';
    }
}

// Auth Actions
export async function login(email, password) {
    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'index.html';
    } catch (error) {
        console.error("Login failed", error);
        alert("로그인 실패: " + error.code);
        throw error;
    }
}

export async function signup(email, password) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Create user doc
        await setDoc(doc(db, "users", user.uid), {
            email: email,
            role: 'customer',
            createdAt: new Date()
        });

        alert("회원가입 환영합니다!");
        window.location.href = 'index.html';
    } catch (error) {
        console.error("Signup failed", error);
        alert("회원가입 실패: " + error.code);
        throw error;
    }
}

export async function logout() {
    try {
        await signOut(auth);
        window.location.href = 'index.html';
    } catch (error) {
        console.error("Logout failed", error);
    }
}

export async function upgradeToProfessional() {
    const user = auth.currentUser;
    if (!user) return;

    const confirmUpgrade = confirm("전문가로 전환하시겠습니까?");
    if (!confirmUpgrade) return;

    try {
        await setDoc(doc(db, "users", user.uid), {
            role: 'professional'
        }, { merge: true });

        alert("전문가 등급으로 전환되었습니다!");
        window.location.reload();
    } catch (error) {
        console.error("Upgrade failed", error);
        alert("전환 실패: " + error.message);
    }
}

// Expose functions globally for HTML event handlers if needed, 
// strictly creating a module-based architecture is better but inline handlers are easier for static sites.
window.dadamAuth = {
    login,
    signup,
    logout,
    upgradeToProfessional
};
