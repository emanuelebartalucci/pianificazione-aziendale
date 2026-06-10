import { useState } from 'react';
import { db } from '../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { Smile, Meh, Frown, X, ShieldCheck } from 'lucide-react';

interface ClimaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ClimaModal({ isOpen, onClose }: ClimaModalProps) {
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [rating, setRating] = useState<number>(5);
  const [submitting, setSubmitting] = useState(false);

  const options = [
    { value: 'Ottimo', label: '🟢 Ottimo, sono sereno e motivato', icon: Smile, color: 'text-green-500 bg-green-50 border-green-200' },
    { value: 'Gestibile', label: '🟡 Gestibile, ma sento un po\' di stanchezza', icon: Meh, color: 'text-amber-500 bg-amber-50 border-amber-200' },
    { value: 'Stressante', label: '🔴 Stressante, mi sento in sovraccarico', icon: Frown, color: 'text-red-500 bg-red-50 border-red-200' }
  ];

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOption) return;

    setSubmitting(true);
    try {
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0]; // Salva solo YYYY-MM-DD per tutelare l'anonimato

      await addDoc(collection(db, 'risposte_clima'), {
        risposta: selectedOption,
        voto: rating,
        data: dateStr,
        createdAt: today.toISOString()
      });

      // Salva nel localStorage che l'utente ha risposto oggi per non riproporglielo
      localStorage.setItem('clima_answered_date', today.toDateString());
      onClose();
    } catch (err) {
      console.error("Errore nel salvataggio del clima aziendale:", err);
      alert("Errore durante l'invio della risposta. Riprova più tardi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] shadow-2xl max-w-md w-full border border-gray-100 p-8 flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-200 relative">
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 text-gray-400 hover:text-gray-650 p-1.5 rounded-xl hover:bg-gray-150 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center space-y-2">
          <span className="text-xs font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full inline-block border border-indigo-100">
            🔒 Questionario 100% Anonimo
          </span>
          <h3 className="text-2xl font-black text-gray-900 leading-tight">Come sta andando il lavoro in questi giorni?</h3>
          <p className="text-xs text-gray-400 font-semibold leading-relaxed">
            La tua risposta aiuterà l'amministrazione a monitorare i livelli di stress e benessere del team in forma aggregata.
          </p>
        </div>

        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex gap-3 items-center">
          <ShieldCheck className="w-6 h-6 text-indigo-600 shrink-0" />
          <p className="text-[11px] text-indigo-950 font-bold leading-normal text-left">
            <strong>Anonimato garantito al 100%</strong>: questa risposta è completamente anonima e scollegata dalla tua identità o dal tuo account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Opzioni di risposta */}
          <div className="flex flex-col gap-3">
            {options.map((opt) => {
              const Icon = opt.icon;
              const isSelected = selectedOption === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSelectedOption(opt.value)}
                  className={`flex items-center gap-3.5 p-4 rounded-2xl border text-left font-bold text-sm transition-all active:scale-[0.98] ${
                    isSelected 
                      ? `${opt.color} ring-2 ring-indigo-400 border-transparent` 
                      : 'bg-gray-50 border-gray-100 text-gray-700 hover:bg-gray-100/50'
                  }`}
                >
                  <Icon className={`w-5 h-5 shrink-0 ${isSelected ? '' : 'text-gray-400'}`} />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          {/* Valutazione a stelline / slider 1-10 */}
          <div className="space-y-3 bg-gray-50/50 border border-gray-100 rounded-2xl p-4">
            <div className="flex justify-between items-center text-xs font-black text-gray-500 uppercase tracking-wider">
              <span>Livello di Stress/Benessere</span>
              <span className="text-indigo-600 font-black text-sm">{rating} / 10</span>
            </div>
            <input 
              type="range" 
              min={1} 
              max={10} 
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              className="w-full accent-indigo-600 cursor-pointer h-2 bg-gray-200 rounded-lg appearance-none"
            />
            <div className="flex justify-between text-[10px] text-gray-400 font-extrabold px-1">
              <span>Molto Stressato (1)</span>
              <span>Ottimo (10)</span>
            </div>
          </div>

          {/* Pulsante invio */}
          <button
            type="submit"
            disabled={submitting || !selectedOption}
            className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition shadow-lg hover:shadow-indigo-600/20 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            {submitting ? 'Invio in corso...' : 'Invia Risposta Anonima'}
          </button>
        </form>
      </div>
    </div>
  );
}
