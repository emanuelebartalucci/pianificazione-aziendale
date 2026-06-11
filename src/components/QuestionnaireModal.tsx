import { useState, useMemo, useEffect } from 'react';
import { db } from '../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { ShieldCheck, X, ChevronRight, ChevronLeft, Send, Check } from 'lucide-react';
import { getQuestionSection, type Question } from '../utils/defaultQuestionnaire';

interface QuestionnaireModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeQuestionnaire: { id: string; questions: Question[] };
  userId: string;
  isPreview?: boolean;
}

export default function QuestionnaireModal({ isOpen, onClose, activeQuestionnaire, userId, isPreview = false }: QuestionnaireModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);

  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(() => {
    const questions = activeQuestionnaire.questions;
    if (!questions || questions.length === 0) return [];
    
    // Group questions dynamically based on section property or retrocompatibility helper
    const sec1 = questions.filter(q => getQuestionSection(q) === 1);
    const sec2 = questions.filter(q => getQuestionSection(q) === 2);
    const sec3 = questions.filter(q => getQuestionSection(q) === 3);
    const sec4 = questions.filter(q => getQuestionSection(q) === 4);
    
    return [
      { title: 'Soddisfazione e Strumenti', questions: sec1 },
      { title: 'Ambiente e Relazioni', questions: sec2 },
      { title: 'Coinvolgimento e Valore', questions: sec3 },
      { title: 'Benefit e Opinioni', questions: sec4 }
    ].filter(s => s.questions.length > 0);
  }, [activeQuestionnaire]);

  // Carica la bozza salvata al montaggio o al cambio di questionario/utente
  useEffect(() => {
    if (isOpen && activeQuestionnaire?.id && userId) {
      const draftKey = `survey_draft_${userId}_${activeQuestionnaire.id}`;
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.answers) {
            setAnswers(parsed.answers);
          }
          if (parsed.currentStep !== undefined) {
            const savedStep = parsed.currentStep;
            if (savedStep >= 0 && savedStep < sections.length) {
              setCurrentStep(savedStep);
            } else {
              setCurrentStep(0);
            }
          }
        } catch (e) {
          console.error("Errore nel caricamento della bozza del questionario:", e);
        }
      } else {
        setCurrentStep(0);
        setAnswers({});
      }
    }
  }, [isOpen, activeQuestionnaire?.id, userId, sections.length]);

  // Salva lo stato corrente della bozza ad ogni modifica
  useEffect(() => {
    if (!isPreview && isOpen && activeQuestionnaire?.id && userId) {
      const draftKey = `survey_draft_${userId}_${activeQuestionnaire.id}`;
      localStorage.setItem(draftKey, JSON.stringify({ currentStep, answers }));
    }
  }, [currentStep, answers, activeQuestionnaire?.id, userId, isPreview, isOpen]);

  if (!isOpen || sections.length === 0) return null;

  const currentSection = sections[currentStep];

  const handleChoiceSelect = (questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleCheckboxToggle = (questionId: string, option: string) => {
    const currentList = (answers[questionId] as string[]) || [];
    if (currentList.includes(option)) {
      setAnswers(prev => ({ ...prev, [questionId]: currentList.filter(o => o !== option) }));
    } else {
      setAnswers(prev => ({ ...prev, [questionId]: [...currentList, option] }));
    }
  };

  const handleTextChange = (questionId: string, text: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: text }));
  };

  const handleNext = () => {
    if (currentStep < sections.length - 1) {
      setCurrentStep(prev => prev + 1);
      // Scroll modal content to top
      const modalEl = document.getElementById('questionnaire-scroll-container');
      if (modalEl) modalEl.scrollTop = 0;
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
      const modalEl = document.getElementById('questionnaire-scroll-container');
      if (modalEl) modalEl.scrollTop = 0;
    }
  };

  const handleSubmit = async () => {
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
      const todayStr = today.toISOString().split('T')[0];

      // 1. Salva risposte in forma 100% anonima (senza alcun riferimento all'utente)
      await addDoc(collection(db, 'risposte_questionario'), {
        questionnaireId: activeQuestionnaire.id,
        answers,
        data: todayStr,
        createdAt: today.toISOString()
      });

      // 2. Registra il completamento per l'utente in una tabella separata per evitare doppi invii
      await addDoc(collection(db, 'questionari_completati'), {
        userId,
        questionnaireId: activeQuestionnaire.id,
        completedAt: today.toISOString()
      });

      // 3. Rimuovi la bozza salvata
      localStorage.removeItem(`survey_draft_${userId}_${activeQuestionnaire.id}`);

      setShowSuccess(true);
      setError(null);
      setTimeout(() => {
        setShowSuccess(false);
        onClose();
      }, 3000);
    } catch (err) {
      console.error("Errore nel salvataggio del questionario:", err);
      setError("Si è verificato un errore durante l'invio. Riprova più tardi.");
    } finally {
      setSubmitting(false);
    }
  };

  if (showSuccess) {
    return (
      <div className="fixed inset-0 bg-gray-900/70 backdrop-blur-md z-[9999] flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-md w-full border border-gray-100 p-8 flex flex-col items-center justify-center gap-4 animate-in fade-in zoom-in-95 duration-200 my-auto">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center animate-bounce">
            <Check className="w-10 h-10 stroke-[3]" />
          </div>
          <h3 className="text-xl font-black text-gray-900 text-center">Questionario Inviato!</h3>
          <p className="text-sm text-gray-500 text-center font-semibold leading-relaxed">
            {isPreview 
              ? "Anteprima completata! Le risposte non sono state salvate."
              : "Grazie per aver dedicato del tempo alla compilazione."}
          </p>
        </div>
      </div>
    );
  }

  const progressPercentage = Math.round(((currentStep + 1) / sections.length) * 100);

  return (
    <div className="fixed inset-0 bg-gray-900/70 backdrop-blur-md z-[9999] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-3xl w-full max-h-[90vh] border border-gray-100 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto">
        {isPreview && (
          <div className="bg-amber-500 text-white text-center py-2.5 text-xs font-extrabold shrink-0 tracking-wider">
            ⚠️ MODALITÀ ANTEPRIMA: Le risposte non verranno salvate nel database.
          </div>
        )}
        
        {/* HEADER */}
        <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-indigo-50/50 to-purple-50/50 flex justify-between items-center shrink-0">
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full inline-block border border-indigo-100">
              🔒 Questionario Anonimo Dipendenti
            </span>
            <h3 className="text-xl font-extrabold text-gray-900">
              Sezione {currentStep + 1} di {sections.length}: {currentSection.title}
            </h3>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-650 p-2 rounded-xl hover:bg-gray-100 transition cursor-pointer"
            title="Compila più tardi"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* PROGRESS BAR */}
        <div className="w-full bg-gray-100 h-1.5 shrink-0">
          <div 
            className="bg-gradient-to-r from-indigo-600 to-purple-600 h-full transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          ></div>
        </div>

        {/* BODY (SCROLLABLE) */}
        <div 
          id="questionnaire-scroll-container"
          className="p-6 sm:p-8 overflow-y-auto flex-1 space-y-6 scrollbar-thin"
        >
          
          {/* PRIVACY WARNING AT BEGINNING OF SURVEY */}
          {currentStep === 0 && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-5 flex gap-4 items-start shadow-sm">
              <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-1 text-left">
                <h4 className="font-extrabold text-emerald-950 text-sm">Garante dell'Anonimato</h4>
                <p className="text-xs text-emerald-900 leading-relaxed">
                  Le tue risposte verranno memorizzate in formato <strong>100% anonimo ed aggregato</strong>. Il sistema registra unicamente che hai completato l'indagine per evitare che ti venga riproposta, ma non collega il tuo account alle risposte fornite.
                </p>
              </div>
            </div>
          )}

          {/* QUESTIONS LIST */}
          <div className="space-y-8 text-left">
            {currentSection.questions.map(q => {
              const value = answers[q.id];
              return (
                <div key={q.id} className="space-y-3">
                  <label className="block text-sm font-extrabold text-gray-900 leading-normal">
                    {q.text}
                  </label>

                  {/* Choice Type (Radio Buttons styled as pills) */}
                  {q.type === 'choice' && q.options && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                      {q.options.map(opt => {
                        const isSelected = value === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => handleChoiceSelect(q.id, opt)}
                            className={`p-3 rounded-xl border text-xs font-bold text-left transition-all active:scale-[0.98] cursor-pointer flex justify-between items-center gap-2 ${
                              isSelected 
                                ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-black shadow-sm'
                                : 'bg-gray-50 border-gray-150 text-gray-600 hover:bg-gray-100/50'
                            }`}
                          >
                            <span className="truncate">{opt}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Checkbox Type */}
                  {q.type === 'checkbox' && q.options && (
                    <div className="flex flex-col gap-2">
                      {q.options.map(opt => {
                        const list = (value as string[]) || [];
                        const isChecked = list.includes(opt);
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => handleCheckboxToggle(q.id, opt)}
                            className={`p-3 rounded-xl border text-xs font-bold text-left transition-all active:scale-[0.98] cursor-pointer flex justify-between items-center gap-2 ${
                              isChecked 
                                ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-black shadow-sm'
                                : 'bg-gray-50 border-gray-150 text-gray-600 hover:bg-gray-100/50'
                            }`}
                          >
                            <span>{opt}</span>
                            <div className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center ${isChecked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300'}`}>
                              {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Text Type */}
                  {q.type === 'text' && (
                    <textarea
                      rows={3}
                      value={value || ''}
                      onChange={e => handleTextChange(q.id, e.target.value)}
                      placeholder="Scrivi qui la tua risposta aperta..."
                      className="w-full p-4 border-none rounded-xl bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner font-medium text-xs text-gray-900 placeholder-gray-400 transition"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* FOOTER */}
        <div className="p-6 border-t border-gray-100 bg-gray-50/80 flex flex-col gap-3 shrink-0">
          {error && (
            <p className="text-xs text-rose-600 font-bold text-center animate-in fade-in">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-between items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-gray-250 text-gray-550 hover:bg-gray-100 font-bold text-xs transition cursor-pointer"
            >
              Compila più tardi (Salta)
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep === 0}
                className="px-4 py-2.5 rounded-xl border border-gray-250 text-gray-550 hover:bg-gray-100 font-bold text-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              >
                <ChevronLeft className="w-4 h-4" /> Indietro
              </button>

              {currentStep < sections.length - 1 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  Avanti <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
                >
                  <Send className="w-4 h-4" /> {submitting ? 'Invio in corso...' : 'Invia Risposte Anonime'}
                </button>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
