const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const envContent = fs.readFileSync('.env', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] ? match[2].trim() : '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    env[match[1]] = value;
  }
});

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const adminsSnap = await getDocs(collection(db, 'admins'));
  console.log('--- ADMINS ---');
  adminsSnap.forEach(doc => console.log(doc.id, '=>', doc.data()));

  const hrSnap = await getDocs(collection(db, 'hr'));
  console.log('--- HR ---');
  hrSnap.forEach(doc => console.log(doc.id, '=>', doc.data()));

  const coordSnap = await getDocs(collection(db, 'coordinatori'));
  console.log('--- COORDINATORI ---');
  coordSnap.forEach(doc => console.log(doc.id, '=>', doc.data()));

  const dipSnap = await getDocs(collection(db, 'dipendenti'));
  console.log('--- DIPENDENTI ---');
  dipSnap.forEach(doc => console.log(doc.id, '=>', doc.data()));
}

run().catch(console.error);
