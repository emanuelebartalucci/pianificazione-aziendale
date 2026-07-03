import { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { Mail, Lock, AlertCircle, ArrowRight } from 'lucide-react';

export default function Login() {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (isLoginMode) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        if (password !== confirmPassword) {
          setError("Le password inserite non coincidono.");
          setLoading(false);
          return;
        }
        // Verifica se l'email esiste nell'anagrafica
        const q = query(collection(db, "dipendenti"), where("email", "==", email.toLowerCase()));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
          setError("La tua email non risulta nell'anagrafica aziendale. Chiedi a un amministratore di inserirla.");
          setLoading(false);
          return;
        }
        
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      if (isLoginMode) {
        setError("Credenziali non valide. Riprova.");
      } else {
        console.error("Errore di registrazione:", err);
        if (err.code === 'auth/weak-password') {
          setError("La password è troppo corta. Deve essere di almeno 6 caratteri.");
        } else if (err.code === 'auth/email-already-in-use') {
          setError("Questo indirizzo email è già registrato.");
        } else if (err.code === 'auth/invalid-email') {
          setError("L'indirizzo email inserito non è valido.");
        } else {
          setError(`Errore durante la registrazione: ${err.message || err}`);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email) {
      setError("Inserisci prima la tua email nel campo qui sopra.");
      return;
    }
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setMessage("Ti abbiamo inviato un'email per resettare la password.");
    } catch (err) {
      setError("Errore nell'invio della mail. Verifica l'indirizzo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-55 relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/20 rounded-full blur-3xl"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-400/20 rounded-full blur-3xl"></div>
      
      <div className="flex-1 flex items-center justify-center w-full relative z-10">
        <div className="bg-white/80 backdrop-blur-xl p-8 sm:p-10 rounded-[2rem] shadow-2xl border border-white/50 w-full max-w-md">
          <div className="flex justify-center mb-8">
            <img src="/Logo.png" alt="Ingegno06" className="h-20 object-contain drop-shadow-md" onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }} />
          </div>
          
          <h1 className="text-2xl font-extrabold text-center text-gray-900 mb-2">
            {isLoginMode ? 'Bentornato' : 'Crea il tuo Account'}
          </h1>
          <p className="text-center text-gray-500 mb-8 text-sm">
            {isLoginMode ? 'Inserisci le tue credenziali per accedere' : 'Usa l\'email aziendale per registrarti'}
          </p>
          
          {error && (
            <div className="bg-red-50/80 border border-red-100 text-red-600 p-4 rounded-xl text-sm mb-6 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          {message && (
            <div className="bg-green-50/80 border border-green-100 text-green-700 p-4 rounded-xl text-sm mb-6 flex items-start gap-3">
              <div className="w-5 h-5 shrink-0 mt-0.5 flex items-center justify-center bg-green-200 rounded-full text-green-800 font-bold">✓</div>
              <p>{message}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5 ml-1">Email Aziendale</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>
                <input 
                  type="email" 
                  required 
                  placeholder="nome@ingegno06.it" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 border-none rounded-xl bg-gray-100/80 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all shadow-inner"
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1.5 ml-1 pr-1">
                <label className="block text-sm font-semibold text-gray-700">Password</label>
                {isLoginMode && (
                  <button type="button" onClick={handleResetPassword} className="text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors">
                    Password dimenticata?
                  </button>
                )}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input 
                  type="password" 
                  required 
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 border-none rounded-xl bg-gray-100/80 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all shadow-inner"
                />
              </div>
            </div>
            {!isLoginMode && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5 ml-1">Conferma Password</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input 
                    type="password" 
                    required 
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-11 pr-4 py-3.5 border-none rounded-xl bg-gray-100/80 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all shadow-inner"
                  />
                </div>
              </div>
            )}
            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-gray-900 text-white font-bold py-3.5 rounded-xl hover:bg-gray-800 transition-all shadow-lg flex items-center justify-center gap-2 group active:scale-[0.98]"
            >
              {loading ? 'Caricamento...' : isLoginMode ? 'Accedi' : 'Registrati'}
              {!loading && <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />}
            </button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-sm text-gray-600">
              {isLoginMode ? "Non hai ancora un account?" : "Hai già un account?"}
              <button 
                onClick={() => { setIsLoginMode(!isLoginMode); setError(''); setMessage(''); setConfirmPassword(''); }} 
                className="ml-2 font-bold text-blue-600 hover:text-blue-800 transition-colors"
              >
                {isLoginMode ? "Registrati ora" : "Accedi"}
              </button>
            </p>
          </div>
        </div>
      </div>

      <footer className="text-center py-6 text-xs text-gray-400 opacity-40 select-none relative z-10">
        Sviluppato da Emanuele Bartalucci
      </footer>
    </div>
  );
}
