import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { Shield, UserCheck, Star, Briefcase, Users, Plus, Trash2, Settings } from 'lucide-react';

export default function Impostazioni() {
  const { isAdmin, dipendenti, commesse } = useAuth();
  
  // States per i form
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [hrEmailSelect, setHrEmailSelect] = useState('');
  const [newSeniorEmail, setNewSeniorEmail] = useState('');
  
  const [newCommessaName, setNewCommessaName] = useState('');
  const [newCommessaColor, setNewCommessaColor] = useState('#3b82f6');
  
  const [newDipNome, setNewDipNome] = useState('');
  const [newDipEmail, setNewDipEmail] = useState('');

  // Liste dinamiche da visualizzare (caricate da context o listener locali per eliminazione)
  const [adminsList, setAdminsList] = useState<{id: string, email: string}[]>([]);
  const [seniorsList, setSeniorsList] = useState<{id: string, email: string}[]>([]);
  // const [currentHR, setCurrentHR] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    const unsubA = onSnapshot(collection(db, 'admins'), (snap) => setAdminsList(snap.docs.map(d => ({id: d.id, email: d.data().email}))));
    const unsubS = onSnapshot(collection(db, 'seniors'), (snap) => setSeniorsList(snap.docs.map(d => ({id: d.id, email: d.data().email}))));
    const unsubH = onSnapshot(doc(db, 'configurazione_sistema', 'hr'), (doc) => {
      if(doc.exists()) setHrEmailSelect(doc.data().email);
    });
    return () => { unsubA(); unsubS(); unsubH(); };
  }, [isAdmin]);

  if (!isAdmin) {
    return <div className="p-8 text-center text-gray-500">Accesso negato. Solo gli amministratori possono vedere questa pagina.</div>;
  }

  // Handlers
  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newAdminEmail) await addDoc(collection(db, 'admins'), { email: newAdminEmail.toLowerCase() });
    setNewAdminEmail('');
  };
  
  const handleRemoveAdmin = async (id: string) => {
    await deleteDoc(doc(db, 'admins', id));
  };

  const handleSaveHR = async (email: string) => {
    setHrEmailSelect(email);
    await setDoc(doc(db, 'configurazione_sistema', 'hr'), { email: email.toLowerCase() });
  };

  const handleAddSenior = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newSeniorEmail) await addDoc(collection(db, 'seniors'), { email: newSeniorEmail.toLowerCase() });
    setNewSeniorEmail('');
  };

  const handleRemoveSenior = async (id: string) => {
    await deleteDoc(doc(db, 'seniors', id));
  };

  const handleAddCommessa = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newCommessaName) await addDoc(collection(db, 'catalogo_commesse'), { nome: newCommessaName, colore: newCommessaColor });
    setNewCommessaName('');
  };

  const handleRemoveCommessa = async (id: string) => {
    await deleteDoc(doc(db, 'catalogo_commesse', id));
  };

  const handleAddDipendente = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newDipNome) {
      await addDoc(collection(db, 'dipendenti'), { nome: newDipNome, email: newDipEmail.toLowerCase() });
      setNewDipNome('');
      setNewDipEmail('');
    }
  };

  const handleRemoveDipendente = async (id: string) => {
    if(window.confirm("Sei sicuro di voler rimuovere questo dipendente?")) {
      await deleteDoc(doc(db, 'dipendenti', id));
    }
  };

  return (
    <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 no-print">
      <h2 className="text-3xl font-extrabold mb-8 text-gray-900 flex items-center gap-3">
        <div className="p-3 bg-gray-100 rounded-2xl"><Settings className="w-8 h-8 text-gray-700" /></div>
        Impostazioni Piattaforma
      </h2>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* COLONNA 1 */}
        <div className="space-y-8">
          {/* Admins */}
          <section className="bg-gradient-to-br from-red-50 to-orange-50 p-6 rounded-3xl border border-red-100 shadow-sm">
            <h3 className="text-xl font-bold text-red-900 mb-4 flex items-center gap-2"><Shield className="w-6 h-6 text-red-600" /> Amministratori</h3>
            <form onSubmit={handleAddAdmin} className="flex gap-2 mb-4">
              <input required type="email" placeholder="Email nuovo admin" value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-red-400 transition shadow-inner" />
              <button type="submit" className="bg-red-600 text-white px-5 rounded-xl hover:bg-red-700 transition font-bold shadow-md active:scale-95">Aggiungi</button>
            </form>
            <div className="max-h-40 overflow-y-auto bg-white/50 rounded-xl divide-y border border-red-100">
              {adminsList.map(a => (
                <div key={a.id} className="p-3 flex justify-between items-center text-sm font-medium text-red-900">
                  {a.email} <button onClick={() => handleRemoveAdmin(a.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4"/></button>
                </div>
              ))}
            </div>
          </section>

          {/* HR */}
          <section className="bg-gradient-to-br from-purple-50 to-fuchsia-50 p-6 rounded-3xl border border-purple-100 shadow-sm">
            <h3 className="text-xl font-bold text-purple-900 mb-2 flex items-center gap-2"><UserCheck className="w-6 h-6 text-purple-600" /> Responsabile HR</h3>
            <p className="text-sm text-purple-700/80 mb-4">Gestisce le richieste di ferie e riceve le notifiche.</p>
            <select value={hrEmailSelect} onChange={e => handleSaveHR(e.target.value)} className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-purple-400 transition shadow-inner font-medium text-purple-900">
              <option value="">Nessun HR assegnato</option>
              {dipendenti.filter(d => d.email).map(d => <option key={d.id} value={d.email}>{d.nome} ({d.email})</option>)}
            </select>
          </section>

          {/* Seniors */}
          <section className="bg-gradient-to-br from-blue-50 to-cyan-50 p-6 rounded-3xl border border-blue-100 shadow-sm">
            <h3 className="text-xl font-bold text-blue-900 mb-2 flex items-center gap-2"><Star className="w-6 h-6 text-blue-600" /> Responsabili Senior</h3>
            <p className="text-sm text-blue-700/80 mb-4">Possono modificare i turni sulle commesse per tutti.</p>
            <form onSubmit={handleAddSenior} className="flex gap-2 mb-4">
              <select required value={newSeniorEmail} onChange={e => setNewSeniorEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-blue-400 transition shadow-inner font-medium text-blue-900">
                <option value="">Seleziona dipendente</option>
                {dipendenti.filter(d => d.email).map(d => <option key={d.id} value={d.email}>{d.nome}</option>)}
              </select>
              <button type="submit" className="bg-blue-600 text-white px-5 rounded-xl hover:bg-blue-700 transition font-bold shadow-md active:scale-95">Nomina</button>
            </form>
            <div className="max-h-40 overflow-y-auto bg-white/50 rounded-xl divide-y border border-blue-100">
              {seniorsList.map(s => (
                <div key={s.id} className="p-3 flex justify-between items-center text-sm font-medium text-blue-900">
                  {s.email} <button onClick={() => handleRemoveSenior(s.id)} className="text-blue-400 hover:text-blue-600 p-1"><Trash2 className="w-4 h-4"/></button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* COLONNA 2 */}
        <div className="space-y-8">
          {/* Commesse */}
          <section className="bg-gradient-to-br from-emerald-50 to-teal-50 p-6 rounded-3xl border border-emerald-100 shadow-sm">
            <h3 className="text-xl font-bold text-emerald-900 mb-4 flex items-center gap-2"><Briefcase className="w-6 h-6 text-emerald-600" /> Catalogo Commesse</h3>
            <form onSubmit={handleAddCommessa} className="flex gap-2 mb-4 items-center">
              <input required type="color" value={newCommessaColor} onChange={e => setNewCommessaColor(e.target.value)} className="w-12 h-12 p-1 border-none rounded-xl bg-white/60 cursor-pointer shadow-inner shrink-0" />
              <input required type="text" placeholder="Nome nuova commessa" value={newCommessaName} onChange={e => setNewCommessaName(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition shadow-inner" />
              <button type="submit" className="bg-emerald-600 text-white p-3 rounded-xl hover:bg-emerald-700 transition font-bold shadow-md active:scale-95"><Plus className="w-6 h-6"/></button>
            </form>
            <div className="max-h-60 overflow-y-auto bg-white/50 rounded-xl divide-y border border-emerald-100">
              {commesse.map(c => (
                <div key={c.id} className="p-3 flex justify-between items-center text-sm font-medium text-emerald-900">
                  <div className="flex items-center gap-3">
                    <span className="w-4 h-4 rounded-full shadow-sm" style={{backgroundColor: c.colore}}></span>
                    {c.nome}
                  </div>
                  <button onClick={() => handleRemoveCommessa(c.id)} className="text-emerald-400 hover:text-emerald-600 p-1"><Trash2 className="w-4 h-4"/></button>
                </div>
              ))}
            </div>
          </section>

          {/* Anagrafica Dipendenti */}
          <section className="bg-gradient-to-br from-indigo-50 to-slate-50 p-6 rounded-3xl border border-indigo-100 shadow-sm">
            <h3 className="text-xl font-bold text-indigo-900 mb-2 flex items-center gap-2"><Users className="w-6 h-6 text-indigo-600" /> Anagrafica Dipendenti</h3>
            <p className="text-sm text-indigo-700/80 mb-4">Solo i dipendenti in questa lista possono registrarsi all'app.</p>
            <form onSubmit={handleAddDipendente} className="flex flex-col gap-3 mb-5">
              <input required type="text" placeholder="Nome Completo (es. Rossi Mario)" value={newDipNome} onChange={e => setNewDipNome(e.target.value)} className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition shadow-inner" />
              <div className="flex gap-2">
                <input type="email" placeholder="Email Aziendale (opzionale)" value={newDipEmail} onChange={e => setNewDipEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition shadow-inner" />
                <button type="submit" className="bg-indigo-600 text-white px-5 rounded-xl hover:bg-indigo-700 transition font-bold shadow-md active:scale-95 flex items-center gap-1"><Plus className="w-5 h-5"/> Aggiungi</button>
              </div>
            </form>
            <div className="max-h-64 overflow-y-auto bg-white/50 rounded-xl divide-y border border-indigo-100">
              {dipendenti.map(d => (
                <div key={d.id} className="p-3 flex justify-between items-center text-sm">
                  <div>
                    <div className="font-bold text-indigo-900">{d.nome}</div>
                    <div className="text-xs text-indigo-600/70">{d.email || 'Nessuna email'}</div>
                  </div>
                  <button onClick={() => handleRemoveDipendente(d.id)} className="text-indigo-400 hover:text-indigo-600 p-2 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"><Trash2 className="w-4 h-4"/></button>
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
