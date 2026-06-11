import { useState, useEffect } from 'react';
import { db } from '../services/firebase';
import { collection, addDoc, onSnapshot } from 'firebase/firestore';
import { Smile, X, ShieldCheck } from 'lucide-react';

interface ClimaModalProps {
  isOpen: boolean;
  onClose: () => void;
  isPreview?: boolean;
}

const getOptionStyle = (label: string) => {
  const l = label.toLowerCase();
  if (l.includes('🟢') || l.includes('ottimo') || l.includes('sereno') || l.includes('bene') || l.includes('motivato')) {
    return {
      color: 'text-green-600 bg-green-50 border-green-200'
    };
  }
  if (l.includes('🔴') || l.includes('stress') || l.includes('sovraccarico') || l.includes('male') || l.includes('pessimo')) {
    return {
      color: 'text-red-600 bg-red-50 border-red-200'
    };
  }
  if (l.includes('🟡') || l.includes('gestibile') || l.includes('stanchezza') || l.includes('stanco') || l.includes('così così')) {
    return {
      color: 'text-amber-600 bg-amber-50 border-amber-200'
    };
  }
  return {
    color: 'text-indigo-600 bg-indigo-50 border-indigo-200'
  };
};

export default function ClimaModal({ isOpen, onClose, isPreview = false }: ClimaModalProps) {
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [rating, setRating] = useState<number>(5);
  const [submitting, setSubmitting] = useState(false);
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const unsub = onSnapshot(collection(db, 'opzioni_clima'), (snapshot) => {
      if (!snapshot.empty) {
        const list: { id: string; label: string; order: number }[] = [];
        let idx = 0;
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            label: data.label || '',
            order: data.order !== undefined ? data.order : idx
          });
          idx++;
        });
        list.sort((a, b) => a.order - b.order);
        setOptions(list);
      } else {
        setOptions([
          { id: 'default1', label: '🟢 Ottimo, sono sereno e motivato' },
          { id: 'default2', label: '🟡 Gestibile, ma sento un po\' di stanchezza' },
          { id: 'default3', label: '🔴 Stressante, mi sento in sovraccarico' }
        ]);
      }
    });
    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOption) return;

    if (isPreview) {
      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        onClose();
      }, 3000);
      return;
    }

    setSubmitting(true);
    try {
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];

      await addDoc(collection(db, 'risposte_clima'), {
        risposta: selectedOption,
        voto: rating,
        data: dateStr,
        createdAt: today.toISOString()
      });

      localStorage.setItem('clima_answered_date', today.toDateString());
      setShowSuccess(true);
      setError(null);
      setTimeout(() => {
        setShowSuccess(false);
        onClose();
      }, 3000);
    } catch (err) {
      console.error("Errore nel salvataggio del clima aziendale:", err);
      setError("Errore durante l'invio della risposta. Riprova più tardi.");
    } finally {
      setSubmitting(false);
    }
  };

  if (showSuccess) {
    return (
      <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-[2rem] shadow-2xl max-w-md w-full border border-gray-100 p-8 flex flex-col items-center justify-center gap-4 animate-in fade-in zoom-in-95 duration-200 relative my-auto">
          <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center animate-bounce">
            <Smile className="w-10 h-10" />
          </div>
          <h3 className="text-xl font-black text-gray-900 text-center">Grazie!</h3>
          <p className="text-sm text-gray-500 text-center font-semibold leading-relaxed">
            {isPreview 
              ? "Risposta di prova completata! Le risposte non sono state salvate."
              : "La tua risposta anonima è stata registrata con successo."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-[2rem] shadow-2xl max-w-md w-full border border-gray-100 p-8 flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-200 relative my-auto max-h-[95vh] overflow-y-auto scrollbar-thin">
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 text-gray-400 hover:text-gray-605 p-1.5 rounded-xl hover:bg-gray-100 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {isPreview && (
          <div className="bg-amber-500 text-white text-center py-2 rounded-2xl text-[10px] font-black uppercase tracking-wider shadow-sm">
            ⚠️ Modalità Anteprima (Nessun Salvataggio)
          </div>
        )}

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
          <div className="flex flex-col gap-3">
            {options.map((opt) => {
              const style = getOptionStyle(opt.label);
              const isSelected = selectedOption === opt.label;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedOption(opt.label)}
                  className={`w-full p-4 rounded-2xl border text-left font-bold text-sm transition-all active:scale-[0.98] ${
                    isSelected 
                      ? `${style.color} ring-2 ring-indigo-400 border-transparent font-black` 
                      : 'bg-gray-50 border-gray-100 text-gray-700 hover:bg-gray-100/50'
                  }`}
                >
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

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

          {error && (
            <p className="text-xs text-rose-600 font-bold text-center animate-in fade-in">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !selectedOption}
            className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition shadow-lg hover:shadow-indigo-600/20 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
          >
            {submitting ? 'Invio in corso...' : 'Invia Risposta Anonima'}
          </button>
        </form>
      </div>
    </div>
  );
}
