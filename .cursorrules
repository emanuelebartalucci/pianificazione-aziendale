# Direttive Permanenti di Progetto

## Lingua delle lavorazioni
Scrivi sempre l'implementation plan, gli artefatti, i report di analisi e tutti i passaggi operativi in lingua italiana.

## Aggiornamento Documentazione
Dopo ogni modifica o rilascio, aggiorna sempre i file nella cartella:
`C:\Users\e.bartalucci.INGEGNO.001\Documents\Antigravity\pianificazione-aziendale\File Utili`
- Changelog_Pianificazione_Aziendale.docx
- Guida Web App.docx

## Procedura di Versionamento
Quando ti chiedo di aggiornare la WebApp alla versione attuale:
- Aggiorna numero di versione e data nel footer dell'app.
- Controlla che tutti i documenti stampati riportino la versione aggiornata del sistema.
- Se non ti specifico io il numero di versione dai un progressivo automaticamente (ad esempio v1.0.5 --> v1.0.6).

## Prestazioni e Firestore
- **Cleanup dei Listener**: Ogni volta che usi `onSnapshot`, implementa sempre la funzione di cleanup (`return () => unsubscribe()`) all'interno del ciclo di vita del componente (`useEffect`).
- **Uso consapevole Real-time vs Fetch**: Usa `getDocs` anziché `onSnapshot` dove l'aggiornamento in tempo reale non è strettamente necessario.
- **Sincronizzazione UI dopo Scrittura**: Ogni operazione di salvataggio, modifica o eliminazione (`addDoc`, `updateDoc`, `deleteDoc`), in assenza di real-time `onSnapshot`, deve **sempre aggiornare immediatamente lo stato locale della UI** (o invocare `refreshData()`) a salvataggio avvenuto, garantendo che l'utente veda subito il cambio senza dover ricaricare la pagina (F5).
- **Filtri alla fonte**: Applica sempre filtri (`where`), ordinamenti (`orderBy`) e limiti (`limit`) alle query Firestore direttamente alla fonte per ottimizzare consumi e prestazioni.
- **Programmazione Difensiva nelle Letture**: Quando si leggono campi da documenti Firestore, imposta sempre valori di fallback predefiniti (es. `doc.data().campo || ''` o `?? false`) per evitare crash su record storici o incompleti.

## Architettura Frontend e Qualità del Codice
- **Separazione delle Responsabilità**: Separa la logica di accesso ai dati (chiamate Firebase) dai componenti visivi (Interfaccia/UI), utilizzando Custom Hooks o moduli API dedicati (`src/services`, `src/hooks`).
- **Gestione Errori e Feedback Utente**: Ogni operazione di salvataggio o lettura verso il backend deve includere un blocco `try/catch` con gestione chiara dell'errore notificata all'utente (es. via Toast/Alert).
- **Retrocompatibilità Schema DB**: Non rimuovere o rinominare mai campi esistenti nella struttura del database Firestore senza previa conferma e piano di migrazione, per evitare incompatibilità con i dati già salvati.
