import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAStjVwPaFvU2ukZ_8udLb3IXFudW8owAo",
  authDomain: "pianificazione-aziendale.firebaseapp.com",
  projectId: "pianificazione-aziendale",
  storageBucket: "pianificazione-aziendale.firebasestorage.app",
  messagingSenderId: "440329790823",
  appId: "1:440329790823:web:5eeb0ba31e4fa41b393bc2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  try {
    const docRef = doc(db, 'risorse', 'pc_ing_pc_13');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      console.log("ING_PC_13 data:", JSON.stringify(snap.data(), null, 2));
    } else {
      console.log("ING_PC_13 doc does not exist!");
    }
  } catch (err) {
    console.error("Error reading doc:", err);
  }
  process.exit(0);
}
run();
