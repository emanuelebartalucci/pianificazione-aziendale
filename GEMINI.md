# Direttive Permanenti di Progetto (Ingegno06 — Pianificazione Aziendale)

> **ISTRUZIONE PER L'AGENTE**: Questo file viene caricato automaticamente all'inizio di OGNI nuova conversazione. Devi rispettare SEMPRE tutte le direttive riportate di seguito in ogni operazione.

---

## 🌐 1. Lingua delle Lavorazioni
- Scrivi sempre l'implementation plan, gli artefatti, i report di analisi, le notifiche Toast, i commenti nel codice e tutti i messaggi per l'utente in **lingua italiana**.

---

## 📝 2. Aggiornamento Automatico Documentazione (OBBLIGATORIO)
Dopo ogni modifica di codice o rilascio di funzionalità, **DEVI SEMPRE AGGIORNARE AUTOMATICAMENTE** i file nella cartella `File Utili`:
- `File Utili/Guida Web App.md` (e rigenerare/aggiornare `Guida Web App.docx` e `Changelog_Pianificazione_Aziendale.docx`)
- Non attendere che l'utente te lo chieda esplicitamente: aggiorna la documentazione come ultimo passaggio prima di completare il task.

---

## 🏷️ 3. Procedura di Versionamento
- **Avvio di un Nuovo Branch di Versione o Richiesta Esplicita**: Aggiorna subito il numero di versione e la data nel footer dell'app (`src/config/version.ts`) e nei documenti di progetto all'inizio dei lavori quando si passa o si lavora su un nuovo branch di versione (es. branch `v1.0.10`) oppure quando l'utente richiede esplicitamente un incremento di versione.
- **Stabilità della Versione durante lo Sviluppo sul Branch**: Durante le lavorazioni ordinarie all'interno dello stesso branch/versione, mantieni invariata la versione esistente finché non si passa a un nuovo branch di rilascio o l'utente richiede un nuovo avanzamento di versione.
- **Allineamento Documenti**: Quando la versione viene aggiornata, allinea contestualmente i riferimenti in `File Utili/Guida Web App.md`, `File Utili/Changelog_Pianificazione_Aziendale.md` e nei file `.docx` rigenerati.

---

## ⚡ 4. Prestazioni e Firestore
- **Cleanup dei Listener**: Ogni volta che usi `onSnapshot`, implementa sempre la funzione di cleanup (`return () => unsubscribe()`) all'interno del `useEffect`.
- **Uso consapevole Real-time vs Fetch**: Usa `getDocs` anziché `onSnapshot` dove l'aggiornamento in tempo reale non è strettamente necessario.
- **Sincronizzazione UI dopo Scrittura**: Ogni operazione di salvataggio, modifica o eliminazione (`addDoc`, `updateDoc`, `deleteDoc`), in assenza di real-time `onSnapshot`, deve **sempre aggiornare immediatamente lo stato locale della UI** (o invocare `refreshData()`), affinché l'utente veda il risultato senza ricaricare la pagina (F5).
- **Filtri alla fonte**: Applica sempre filtri (`where`), ordinamenti (`orderBy`) e limiti (`limit`) alle query Firestore direttamente alla fonte.
- **Programmazione Difensiva nelle Letture**: Imposta sempre valori di fallback predefiniti (`doc.data().campo || ''` o `?? false`) per evitare crash su record storici o incompleti.

---

## 🛠️ 5. Architettura Frontend e Qualità del Codice
- **Gestione Errori e Feedback Utente**: Ogni operazione verso il backend deve includere un blocco `try/catch` con feedback notificato all'utente via Toast/Alert.
- **Retrocompatibilità Schema DB**: Non rimuovere o rinominare mai campi esistenti nel database Firestore senza previa conferma e piano di migrazione.
- **Build Verification**: Esegui sempre `npm run build` al termine delle modifiche per garantire 0 errori di compilazione TypeScript prima di informare l'utente.
