import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { UserCheck, X, Send, AlertCircle } from 'lucide-react';
import { queueMail } from '../utils/mailSender';
import { getWeekNumber } from '../utils/date';

interface ResourceAvailabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const ResourceAvailabilityModal: React.FC<ResourceAvailabilityModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const { userEmail, dipendenti, coordinatori, myAssociatedName } = useAuth();
  const [nota, setNota] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const currentDip = (dipendenti || []).find(d => d.nome === myAssociatedName);
  const macroArea = currentDip?.macroArea || 'Disegnatori';
  const today = new Date();
  const currentWeekNum = getWeekNumber(today);
  const currentYear = today.getFullYear();
  const weekLabel = `Settimana ${currentWeekNum} (${currentYear})`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myAssociatedName) return;

    setSubmitting(true);
    try {
      // 1. Salva documento in Firestore nella collezione 'segnalazioni_disponibilita'
      await addDoc(collection(db, 'segnalazioni_disponibilita'), {
        risorsaNome: myAssociatedName,
        risorsaEmail: userEmail || '',
        macroArea: macroArea,
        settimana: `${currentYear}-W${currentWeekNum}`,
        settimanaLabel: weekLabel,
        nota: nota.trim(),
        stato: 'in_attesa',
        timestamp: new Date().toISOString()
      });

      // 2. Recupera email coordinatori di macroArea + fallback admin
      const adminEmails = ['aprofeti@ingegno06.it', 'mcorbellini@ingegno06.it'];
      const areaCoordEmails = (coordinatori || [])
        .filter(c => c.area === macroArea && c.email)
        .map(c => c.email.toLowerCase());

      const recipients = Array.from(new Set([...areaCoordEmails, ...adminEmails]));

      const subject = `[Disponibilità Risorsa] ${myAssociatedName} è scarico/a e richiede lavoro`;
      const htmlBody = `
        <p>Ciao Coordinatore / Admin,</p>
        <p>Ti informiamo che la risorsa <strong>${myAssociatedName}</strong> dell'area <strong>${macroArea}</strong> ha inviato una segnalazione per comunicare che è <strong>scarica e disponibile per prendere in carico nuovi task / lavoro</strong> per la <strong>${weekLabel}</strong>.</p>
        ${nota.trim() ? `<div style="margin-top:12px;padding:12px;background-color:#f8fafc;border-left:4px solid #059669;border-radius:6px;font-style:italic;color:#334155;">Note della risorsa: &ldquo;${nota.trim()}&rdquo;</div>` : ''}
        <p style="margin-top:16px;">Accedi all'area <strong>Pianificazione del Personale e Carichi</strong> per assegnare nuove attività alla risorsa.</p>
      `;
      const plainText = `Ciao Coordinatore,\n\nLa risorsa ${myAssociatedName} (${macroArea}) segnala che è scarica e disponibile per prendere in carico nuovo lavoro per la ${weekLabel}.\n${nota.trim() ? `Note: "${nota.trim()}"\n` : ''}`;

      for (const email of recipients) {
        if (email.toLowerCase() !== (userEmail || '').toLowerCase()) {
          await queueMail(email, subject, htmlBody, plainText);
        }
      }

      setNota('');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error("Errore durante l'invio della segnalazione disponibilità:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-[9999] p-4 sm:p-6 no-print animate-in fade-in duration-200">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg border border-gray-100 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header Modale */}
        <div className="p-5 sm:p-6 border-b bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/20 rounded-2xl backdrop-blur-sm">
              <UserCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-black tracking-tight">Segnala Disponibilità / Chiedi Lavoro</h3>
              <p className="text-xs text-emerald-100 font-medium mt-0.5">Avvisa subito i tuoi coordinatori che sei scarico/a</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/80 hover:text-white p-1 hover:bg-white/10 rounded-full transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          {/* Card di Riepilogo Risorsa & Settimana */}
          <div className="bg-emerald-50/70 border border-emerald-200 p-4 rounded-2xl space-y-1.5 text-xs text-emerald-950">
            <div className="flex justify-between items-center">
              <span className="font-extrabold text-sm text-emerald-900">{myAssociatedName}</span>
              <span className="bg-emerald-200 text-emerald-900 font-black text-[10px] uppercase px-2.5 py-0.5 rounded-full">
                {macroArea}
              </span>
            </div>
            <div className="text-emerald-800 font-bold flex items-center gap-1.5 pt-0.5">
              <span>📅 Settimana Corrente:</span>
              <span className="font-black text-emerald-950">{weekLabel}</span>
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 text-xs text-slate-700 space-y-1 flex gap-2.5 items-start">
            <AlertCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              Inviando questa segnalazione, notificherai immediatamente ai Coordinatori dell'area <strong>{macroArea}</strong> che sei disponibile per prendere in carico nuove attività.
            </div>
          </div>

          {/* Campo Note Opzionali */}
          <div>
            <label className="block text-xs font-bold text-gray-800 mb-1 flex items-center justify-between">
              <span>Eventuali Note per il Coordinatore</span>
              <span className="text-[10px] text-gray-400 font-normal italic">(Facoltative)</span>
            </label>
            <textarea
              placeholder="Es. Ho completato in anticipo le tavole del progetto X e sono pronto per nuove assegnazioni..."
              value={nota}
              onChange={e => setNota(e.target.value)}
              rows={3}
              className="w-full p-3.5 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500 transition-all resize-none shadow-2xs placeholder:text-gray-400"
            />
          </div>

          {/* Footer Modale */}
          <div className="pt-3 border-t border-gray-150 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 transition cursor-pointer"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition shadow-md disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? "Invio in corso..." : "Invia Segnalazione"}</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
