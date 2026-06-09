import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, onSnapshot, doc, deleteDoc, query, orderBy, getDoc } from 'firebase/firestore';
import { Send, MessageSquare, Shield, Star, Filter, Trash2, LayoutList, Plus } from 'lucide-react';
import { wrapMailTemplate } from '../utils/mailTemplate';
import ConfirmModal from '../components/ConfirmModal';

interface Suggerimento {
  id: string;
  categoria: string;
  votoClima: number;
  testo: string;
  data: string;
}

export default function Suggerimenti() {
  const { isAdmin, isHR } = useAuth();
  
  // Tab attiva per gli HR/Admin: 'invia' o 'dashboard'
  const [activeTab, setActiveTab] = useState<'invia' | 'dashboard'>('invia');

  // Stato del Form
  const [categories, setCategories] = useState<{ id: string; nome: string }[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [catLoading, setCatLoading] = useState(false);

  const [categoria, setCategoria] = useState('');
  const [votoClima, setVotoClima] = useState<number>(0);
  const [hoverVoto, setHoverVoto] = useState<number>(0);
  const [testo, setTesto] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Stato dei Dati (per HR/Admin)
  const [suggerimenti, setSuggerimenti] = useState<Suggerimento[]>([]);
  const [filterCat, setFilterCat] = useState('');

  // Stato per la modale di conferma personalizzata
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const triggerConfirm = (title: string, message: string, onConfirm: () => void, type: 'danger' | 'warning' | 'info' = 'danger') => {
    setConfirmConfig({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      },
      type
    });
  };

  // Caricamento e autoinizializzazione categorie
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'categorie_suggerimenti'), (snapshot) => {
      if (snapshot.empty) {
        const defaultCats = [
          'Ambiente di lavoro',
          'Strumenti e Risorse',
          'Processi e Organizzazione',
          'Altro'
        ];
        defaultCats.forEach(async (catName) => {
          await addDoc(collection(db, 'categorie_suggerimenti'), { nome: catName });
        });
      } else {
        const list: { id: string; nome: string }[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          if (data.nome) list.push({ id: docSnap.id, nome: data.nome });
        });
        list.sort((a, b) => a.nome.localeCompare(b.nome));
        setCategories(list);
      }
    });
    return () => unsub();
  }, []);

  // Sincronizza tab predefinita per gli HR
  useEffect(() => {
    if (isAdmin || isHR) {
      setActiveTab('dashboard');
    } else {
      setActiveTab('invia');
    }
  }, [isAdmin, isHR]);

  // Caricamento suggerimenti in tempo reale (solo per HR/Admin)
  useEffect(() => {
    if (!isAdmin && !isHR) return;

    const q = query(collection(db, 'suggerimenti'), orderBy('data', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      const list: Suggerimento[] = [];
      snapshot.forEach(docSnap => {
        list.push({
          id: docSnap.id,
          ...docSnap.data()
        } as Suggerimento);
      });
      setSuggerimenti(list);
    });

    return () => unsub();
  }, [isAdmin, isHR]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoria || votoClima === 0 || !testo.trim()) {
      alert("Compila tutti i campi e seleziona una valutazione clima!");
      return;
    }

    setLoading(true);
    setSuccessMsg('');

    try {
      const todayStr = new Date().toISOString().split('T')[0];
      await addDoc(collection(db, 'suggerimenti'), {
        categoria,
        votoClima,
        testo: testo.trim(),
        data: todayStr
      });

      // Invia notifica email anonima all'HR
      try {
        const hrDoc = await getDoc(doc(db, 'configurazione_sistema', 'hr'));
        const hrEmail = hrDoc.exists() ? hrDoc.data().email : null;
        if (hrEmail) {
          const subject = `[Pianificazione] Nuovo Suggerimento Anonimo Ricevuto`;
          const htmlContent = `
            <p>Ciao,</p>
            <p>È stato inserito un nuovo suggerimento anonimo nella cassetta delle idee.</p>
            <table border="0" cellspacing="0" cellpadding="0" style="margin: 20px 0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; width: 100%; max-width: 400px; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
              <tr>
                <td style="padding: 12px 16px; font-weight: bold; color: #374151; border-bottom: 1px solid #e5e7eb; width: 150px;">Categoria:</td>
                <td style="padding: 12px 16px; color: #111827; border-bottom: 1px solid #e5e7eb;">${categoria}</td>
              </tr>
              <tr>
                <td style="padding: 12px 16px; font-weight: bold; color: #374151;">Valutazione Clima:</td>
                <td style="padding: 12px 16px; color: #111827;"><strong>${votoClima} / 10</strong></td>
              </tr>
            </table>
            <p>Puoi accedere all'applicazione per visualizzare il testo completo del suggerimento nella scheda della Dashboard HR.</p>
          `;
          await addDoc(collection(db, 'mail'), {
            to: hrEmail.toLowerCase(),
            message: {
              subject,
              html: wrapMailTemplate(subject, htmlContent)
            }
          });
        }
      } catch (emailErr) {
        console.error("Errore notifica email HR per suggerimento:", emailErr);
      }

      setCategoria('');
      setVotoClima(0);
      setTesto('');
      setSuccessMsg('Suggerimento inviato con successo e in forma completamente anonima!');
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      console.error("Errore nell'invio del suggerimento:", err);
      alert("Si è verificato un errore durante l'invio. Riprova più tardi.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: string) => {
    triggerConfirm(
      "Elimina Suggerimento",
      "Sei sicuro di voler eliminare questo suggerimento? L'azione è irreversibile.",
      async () => {
        try {
          await deleteDoc(doc(db, 'suggerimenti', id));
        } catch (err) {
          console.error("Errore nell'eliminazione del suggerimento:", err);
        }
      },
      'danger'
    );
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    
    if (categories.some(c => c.nome.toLowerCase() === newCategoryName.trim().toLowerCase())) {
      alert("Questa categoria esiste già!");
      return;
    }
    
    setCatLoading(true);
    try {
      await addDoc(collection(db, 'categorie_suggerimenti'), {
        nome: newCategoryName.trim()
      });
      setNewCategoryName('');
    } catch (err) {
      console.error("Errore nell'aggiunta della categoria:", err);
      alert("Errore nell'aggiunta della categoria.");
    } finally {
      setCatLoading(false);
    }
  };

  const handleDeleteCategory = (catId: string, catNome: string) => {
    triggerConfirm(
      "Elimina Categoria",
      `Sei sicuro di voler eliminare la categoria "${catNome}"? I suggerimenti esistenti sotto questa categoria rimarranno nel database ma non avranno più una categoria abbinata.`,
      async () => {
        try {
          await deleteDoc(doc(db, 'categorie_suggerimenti', catId));
        } catch (err) {
          console.error("Errore nell'eliminazione della categoria:", err);
        }
      },
      'danger'
    );
  };

  // Calcolo delle statistiche
  const stats = useMemo(() => {
    if (suggerimenti.length === 0) return { media: 0, conteggio: 0 };
    const somma = suggerimenti.reduce((t, s) => t + s.votoClima, 0);
    return {
      media: Number((somma / suggerimenti.length).toFixed(1)),
      conteggio: suggerimenti.length
    };
  }, [suggerimenti]);

  // Suggerimenti filtrati per categoria
  const filteredSuggerimenti = useMemo(() => {
    if (!filterCat) return suggerimenti;
    return suggerimenti.filter(s => s.categoria === filterCat);
  }, [suggerimenti, filterCat]);

  return (
    <div className="flex flex-col gap-6">
      
      {/* HEADER E TABS */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm p-4 sm:p-6 border border-white/50 flex flex-col md:flex-row justify-between items-center gap-4">
        <h2 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-2xl"><MessageSquare className="text-indigo-600 w-8 h-8" /></div>
          <span>Cassetta delle Idee</span>
        </h2>

        {(isAdmin || isHR) && (
          <div className="flex bg-gray-100/80 p-1.5 rounded-2xl shadow-inner">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${activeTab === 'dashboard' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <LayoutList className="w-4 h-4" /> Risultati HR
            </button>
            <button 
              onClick={() => setActiveTab('invia')}
              className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${activeTab === 'invia' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Plus className="w-4 h-4" /> Invia Idee
            </button>
          </div>
        )}
      </div>

      {/* COMPILAZIONE SUGGERIMENTO */}
      {activeTab === 'invia' && (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 max-w-3xl mx-auto w-full">
          
          {/* BOX PRIVACY NOTIFICATION */}
          <div className="bg-blue-50/60 border border-blue-100 rounded-3xl p-6 mb-8 flex gap-4 items-start shadow-sm">
            <Shield className="w-6 h-6 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-3">
              <h4 className="font-extrabold text-blue-950 text-base">La tua privacy è al sicuro (Anonimato Garantito)</h4>
              <p className="text-sm text-blue-900/80 leading-relaxed">
                Per garantire la massima libertà di espressione, questa sezione è stata programmata seguendo il principio del disaccoppiamento dei dati:
              </p>
              <ul className="list-disc pl-4 text-xs text-blue-900/85 space-y-2 leading-relaxed">
                <li>
                  <strong>Nessun collegamento</strong>: La piattaforma registra solo che hai partecipato ma memorizza le tue risposte e valutazioni in una tabella completamente separata, priva del tuo nome o della tua email.
                </li>
                <li>
                  <strong>Nessun tracciamento temporale</strong>: L'orario esatto dell'invio non viene registrato per impedire a chiunque di risalire a te incrociando i log di accesso.
                </li>
                <li>
                  <strong>Nessun dato nascosto</strong>: Non vengono raccolti indirizzi IP, informazioni sul browser o altri identificativi digitali.
                </li>
                <li>
                  <strong>Chi può leggere</strong>: I suggerimenti saranno visibili esclusivamente all'HR e alla Direzione per finalità di miglioramento aziendale. Nessun altro collega potrà vedere le tue risposte.
                </li>
                <li>
                  <strong>Consiglio pratico</strong>: Per garantire un anonimato assoluto, evita di citare episodi specifici, nomi o dettagli nel testo che possano far risalire indirettamente alla tua persona.
                </li>
              </ul>
            </div>
          </div>

          {successMsg && (
            <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-2xl mb-6 font-bold text-center text-sm">
              {successMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Categoria</label>
              <select
                required
                value={categoria}
                onChange={e => setCategoria(e.target.value)}
                className="w-full p-4 border-none rounded-xl bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 transition"
              >
                <option value="">-- Seleziona Categoria --</option>
                {categories.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Valutazione del Clima Aziendale (da 1 a 10)</label>
              <div className="flex items-center gap-1.5 p-2 bg-gray-50 rounded-xl shadow-inner w-fit flex-wrap">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(star => {
                  const isGold = (hoverVoto || votoClima) >= star;
                  return (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setVotoClima(star)}
                      onMouseEnter={() => setHoverVoto(star)}
                      onMouseLeave={() => setHoverVoto(0)}
                      className="p-0.5 hover:scale-110 active:scale-95 transition-transform"
                      title={`${star} su 10`}
                    >
                      <Star className={`w-6 h-6 sm:w-7 sm:h-7 transition-colors ${isGold ? 'text-amber-500 fill-amber-500' : 'text-gray-300'}`} />
                    </button>
                  );
                })}
                {votoClima > 0 && (
                  <span className="text-xs font-extrabold text-amber-600 px-3 bg-amber-50 rounded-lg py-1 border border-amber-100 ml-2">
                    {votoClima} / 10
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Il tuo Suggerimento o Consiglio</label>
              <textarea
                required
                rows={6}
                value={testo}
                onChange={e => setTesto(e.target.value)}
                placeholder="Scrivi qui liberamente il tuo consiglio o la tua valutazione..."
                className="w-full p-4 border-none rounded-xl bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner font-medium text-gray-900 placeholder-gray-400 transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white font-extrabold py-4 rounded-xl hover:bg-indigo-700 transition shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Send className="w-5 h-5" />
              {loading ? 'Invio in corso...' : 'Invia in Forma Anonima'}
            </button>
          </form>
        </div>
      )}

      {/* DASHBOARD HR / ADMIN */}
      {activeTab === 'dashboard' && (isAdmin || isHR) && (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 flex flex-col mb-10">
          
          {/* STATS OVERVIEW & CATEGORIES MANAGEMENT */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-6 rounded-3xl border border-indigo-100 flex items-center justify-between flex-wrap gap-4">
              <div>
                <h4 className="text-sm font-bold text-indigo-950/70 uppercase tracking-wider mb-1">Valutazione Clima Media</h4>
                <div className="text-4xl font-black text-indigo-900 flex items-baseline gap-2">
                  {stats.media}
                  <span className="text-sm font-bold opacity-75">/ 10</span>
                </div>
              </div>
              <div className="flex gap-0.5 flex-wrap">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(star => (
                  <Star key={star} className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${Math.round(stats.media) >= star ? 'text-indigo-600 fill-indigo-600' : 'text-gray-300'}`} />
                ))}
              </div>
            </div>

            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 p-6 rounded-3xl border border-emerald-100 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-emerald-950/70 uppercase tracking-wider mb-1">Totale Suggerimenti</h4>
                <div className="text-4xl font-black text-emerald-900">{stats.conteggio}</div>
              </div>
              <div className="p-4 bg-emerald-600 text-white rounded-2xl"><MessageSquare className="w-6 h-6" /></div>
            </div>

            {/* GESTIONE CATEGORIE */}
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 p-6 rounded-3xl border border-purple-100 flex flex-col justify-between gap-4">
              <div>
                <h4 className="text-sm font-bold text-purple-950/70 uppercase tracking-wider mb-2">Gestione Categorie</h4>
                <div className="max-h-[120px] overflow-y-auto pr-1 space-y-2 mb-3">
                  {categories.map(cat => (
                    <div key={cat.id} className="flex justify-between items-center bg-white/60 p-2 rounded-xl border border-purple-100/50">
                      <span className="text-xs font-bold text-purple-950">{cat.nome}</span>
                      <button 
                        onClick={() => handleDeleteCategory(cat.id, cat.nome)}
                        className="text-gray-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition"
                        title="Elimina categoria"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <form onSubmit={handleAddCategory} className="flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="Nuova categoria..."
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  disabled={catLoading}
                  className="flex-1 px-3 py-2 text-xs font-bold text-purple-950 border border-purple-200/50 bg-white rounded-xl focus:ring-2 focus:ring-purple-400 outline-none placeholder-gray-400"
                />
                <button
                  type="submit"
                  disabled={catLoading}
                  className="bg-purple-600 text-white p-2 rounded-xl hover:bg-purple-700 active:scale-95 disabled:opacity-50 transition flex items-center justify-center shrink-0"
                  title="Aggiungi categoria"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>

          {/* FILTERS TOOLBAR */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-gray-50/50 rounded-2xl border border-gray-100 mb-6">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                value={filterCat}
                onChange={e => setFilterCat(e.target.value)}
                className="pl-3 pr-8 py-2 border-none bg-white rounded-xl shadow-inner text-sm font-bold text-gray-700 focus:ring-2 focus:ring-indigo-400 outline-none w-52"
              >
                <option value="">Tutte le categorie</option>
                {categories.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
              </select>
            </div>
            <div className="text-xs font-bold text-gray-500">
              Visualizzati: <strong>{filteredSuggerimenti.length}</strong> suggerimenti
            </div>
          </div>

          {/* LISTA SUGGERIMENTI */}
          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
            {filteredSuggerimenti.length === 0 ? (
              <p className="text-center text-gray-400 py-10 font-bold italic">Nessun suggerimento presente per questa categoria.</p>
            ) : (
              filteredSuggerimenti.map(s => (
                <div key={s.id} className="p-5 border border-gray-100 rounded-3xl bg-white shadow-sm hover:shadow-md transition flex justify-between items-start gap-4">
                  <div className="space-y-3 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-extrabold bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full">{s.categoria}</span>
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(star => (
                          <Star key={star} className={`w-2.5 h-2.5 sm:w-3 sm:h-3 ${s.votoClima >= star ? 'text-amber-500 fill-amber-500' : 'text-gray-200'}`} />
                        ))}
                      </div>
                      <span className="text-xs font-bold text-gray-400">{s.data}</span>
                    </div>
                    
                    <p className="text-sm text-gray-800 leading-relaxed font-medium whitespace-pre-wrap">{s.testo}</p>
                  </div>

                  <button
                    onClick={() => handleDelete(s.id)}
                    className="text-gray-300 hover:text-red-600 hover:bg-red-50 p-2 rounded-xl transition"
                    title="Elimina suggerimento"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        type={confirmConfig.type}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
