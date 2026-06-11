import { readFileSync } from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';

const COMMESSE_INIZIALI = [
  { codiceCommessa: "A210219A", anno: "2021", tipologia: "A", titolo: "Pratiche antincendio e INAIL centrali biomassa Garfagnana", cliente: "R&S s.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Beatrice Barni" },
  { codiceCommessa: "A260061A", anno: "2026", tipologia: "A", titolo: "Consulenza parere AdF nuovi laboratori S59 Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Francesca Turi" },
  { codiceCommessa: "A260061B", anno: "2026", tipologia: "A", titolo: "Pratica rinnovo concessione pozzo Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Francesca Turi" },
  { codiceCommessa: "A260132A", anno: "2026", tipologia: "A", titolo: "Pratiche codici ATECO aziende gruppo", cliente: "A. Menarini Manufacturing Logistics and Services S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "B210055A", anno: "2021", tipologia: "B", titolo: "Progettazione esecutiva ex discarica Baccaciano", cliente: "Comune di Sarteano", stato: "Aperta", responsabile: "Andrea Profeti", pm: "" },
  { codiceCommessa: "B230260A", anno: "2023", tipologia: "B", titolo: "Progettazione bonifica e MISP Rezzaia Pietrasanta", cliente: "Comune di Pietrasanta", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Francesca Turi" },
  { codiceCommessa: "B260308A", anno: "2026", tipologia: "B", titolo: "Bonifica sito LI-1019 Rosignano Solvay", cliente: "Unicoop Etruria s.c.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Francesca Turi" },
  { codiceCommessa: "B260313A", anno: "2026", tipologia: "B", titolo: "Prog spostamento pozzo CD2 P&T Montescudaio", cliente: "Comis Srl", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Francesca Turi" },
  { codiceCommessa: "CA240206B", anno: "2024", tipologia: "CA", titolo: "Consulenza Ambiente Sicurezza Anemocyte Turate", cliente: "Techniconsult Firenze S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "" },
  { codiceCommessa: "CA240285A", anno: "2024", tipologia: "CA", titolo: "Consulenza ambientale", cliente: "GLYCO S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Francesca Turi" },
  { codiceCommessa: "CA250206A", anno: "2025", tipologia: "CA", titolo: "Consulenza permitting ambientale Chiesi Nerviano", cliente: "Techniconsult Firenze S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Francesca Turi" },
  { codiceCommessa: "CA260132A", anno: "2026", tipologia: "CA", titolo: "Consulenza ambientale depuratori area fiorentina 2026", cliente: "A. Menarini Manufacturing Logistics and Services S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "" },
  { codiceCommessa: "CF260304A", anno: "2026", tipologia: "CF", titolo: "Corso RLS e-learning", cliente: "ACA S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CO200154A", anno: "2020", tipologia: "CO", titolo: "Consulenza di stabilimento", cliente: "Edra S.p.a.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "" },
  { codiceCommessa: "CO220117A", anno: "2022", tipologia: "CO", titolo: "Direzione esecuzione e supervisione P&T Montescudaio", cliente: "Regione Toscana", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Francesca Turi" },
  { codiceCommessa: "CO220243A", anno: "2022", tipologia: "CO", titolo: "Consulenza cogeneratore biogas Grosseto", cliente: "Acquedotto del Fiora S.p.A.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "" },
  { codiceCommessa: "CO230270A", anno: "2023", tipologia: "CO", titolo: "Assistenza al Permitting", cliente: "N.S.C. Hospital S.c.a.r.l.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "" },
  { codiceCommessa: "CO250185B", anno: "2025", tipologia: "CO", titolo: "Assistenza e consulenza INAIL-PED", cliente: "Takeda Italia S.p.A.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CO260061A", anno: "2026", tipologia: "CO", titolo: "Consulenza connessione utilities new labs Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Niccolò Rossi" },
  { codiceCommessa: "CO260132A", anno: "2026", tipologia: "CO", titolo: "Consulenza ambiente/sicurezza in economia 2026", cliente: "A. Menarini Manufacturing Logistics and Services S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "" },
  { codiceCommessa: "CO260269A", anno: "2026", tipologia: "CO", titolo: "Consulenza La Collina app. 4A1 per verifica perdita", cliente: "Tenuta di Castelfalfi S.p.A.", stato: "Aperta", responsabile: "", pm: "" },
  { codiceCommessa: "CO260295A", anno: "2026", tipologia: "CO", titolo: "Consulenza WWTP next gen Sesto Fiorentino", cliente: "Eli Lilly Italia S.p.A.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "" },
  { codiceCommessa: "CO260309A", anno: "2026", tipologia: "CO", titolo: "Gara rimozione rifiuti Ex Polveriera Pallerone Aulla", cliente: "DAF Costruzioni Stradali S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Francesca Turi" },
  { codiceCommessa: "CS230129A", anno: "2023", tipologia: "CS", titolo: "Gestione POS aziendali", cliente: "Battigalli S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "CS230185B", anno: "2023", tipologia: "CS", titolo: "Consulenza sicurezza procedure LO-TO", cliente: "Takeda Italia S.p.A.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS240273A", anno: "2024", tipologia: "CS", titolo: "Redazione sistema di gestione ISO 9001", cliente: "EM 2001 Srl", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS240281A", anno: "2024", tipologia: "CS", titolo: "Assistenza SGI 9001-14001", cliente: "Santini Rottami Srl", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS250009A", anno: "2025", tipologia: "CS", titolo: "Assistenza in materia di salute e sicurezza", cliente: "Deltacque S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS250143B", anno: "2025", tipologia: "CS", titolo: "Incarico ASPP", cliente: "Ghiropelli S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS250152A", anno: "2025", tipologia: "CS", titolo: "Incarico RSPP", cliente: "Medline Int. Italy S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS250154B", anno: "2025", tipologia: "CS", titolo: "Incarico RSPP", cliente: "Edra S.p.a.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS250235B", anno: "2025", tipologia: "CS", titolo: "Assistenza annuale igiene alimentare", cliente: "Nutricom S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS250237A", anno: "2025", tipologia: "CS", titolo: "Assistenza annuale igiene alimentare", cliente: "Gasperini Riccardo S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS250257A", anno: "2025", tipologia: "CS", titolo: "Incarico RSPP 2025/2026", cliente: "Falaschi Uliano di Falaschi Juri & C. S.A.S.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS250258A", anno: "2025", tipologia: "CS", titolo: "Incarico RSPP 2025/2026", cliente: "Falaschi Service Srl", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS250304A", anno: "2025", tipologia: "CS", titolo: "Incarico RSPP", cliente: "ACA S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260084A", anno: "2026", tipologia: "CS", titolo: "Incarico RSPP 2026", cliente: "Nick Winters Italia S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260084B", anno: "2026", tipologia: "CS", titolo: "Registrazione Reg. CE 852/04", cliente: "Nick Winters Italia S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260126A", anno: "2026", tipologia: "CS", titolo: "Incarico RSPP 2026 - 2027", cliente: "Officina Bartaloni S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260145A", anno: "2026", tipologia: "CS", titolo: "Incarico RSPP 2026", cliente: "Toscana Fridge S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260148A", anno: "2026", tipologia: "CS", titolo: "Incarico RSPP 2026", cliente: "Studio Associato GLM", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260159A", anno: "2026", tipologia: "CS", titolo: "Assistenza ISO 9001:2015", cliente: "Airone Società Cooperativa", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260168A", anno: "2026", tipologia: "CS", titolo: "Consulenza ISO 9001:2015", cliente: "M.S. Formazione S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260168B", anno: "2026", tipologia: "CS", titolo: "Assistenza documentazione Logisicur", cliente: "M.S. Formazione S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260188A", anno: "2026", tipologia: "CS", titolo: "Incarico RSPP 2026", cliente: "Studio Commerciale Galli", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260200A", anno: "2026", tipologia: "CS", titolo: "Incarico RSPP 2026", cliente: "Vigneto San Miguel Società agricola r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260208A", anno: "2026", tipologia: "CS", titolo: "Incarico RSPP 2026", cliente: "Italiana Servizi S.p.a.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260208B", anno: "2026", tipologia: "CS", titolo: "Consulenza salute e sicurezza", cliente: "Italiana Servizi S.p.a.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260223A", anno: "2026", tipologia: "CS", titolo: "Incarico RSPP 2026", cliente: "Relais Uffizi S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260268A", anno: "2026", tipologia: "CS", titolo: "Assistenza salute, sicurezza ed igiene alimentare", cliente: "Montorzo S.S.A.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260277A", anno: "2026", tipologia: "CS", titolo: "Incarico RSPP 2026", cliente: "Agrisole S.S.A di Caputo F. & C.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260281A", anno: "2026", tipologia: "CS", titolo: "Consulenza salute e sicurezza", cliente: "Santini Rottami Srl", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260287A", anno: "2026", tipologia: "CS", titolo: "Incarico ASPP 2026", cliente: "Sebach S.p.A. Unipersonale", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260287B", anno: "2026", tipologia: "CS", titolo: "Assistenza sistemi di gestione", cliente: "Sebach S.p.A. Unipersonale", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260288A", anno: "2026", tipologia: "CS", titolo: "Incarico ASPP 2026", cliente: "Armal S.p.A. Unipersonale", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260288B", anno: "2026", tipologia: "CS", titolo: "Assistenza sistemi di gestione", cliente: "Armal S.p.A. Unipersonale", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260293A", anno: "2026", tipologia: "CS", titolo: "Pratica di inizio attività e aggiornamento DVR", cliente: "CDC Studio S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260293B", anno: "2026", tipologia: "CS", titolo: "Incarico RSPP 2026", cliente: "CDC Studio S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260307A", anno: "2026", tipologia: "CS", titolo: "Incarico RSPP", cliente: "Pacini Editore S.r.l.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260310A", anno: "2026", tipologia: "CS", titolo: "Consulenza e assistenza HACCP", cliente: "I Seminanti di Emanuele Bianucci", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260312A", anno: "2026", tipologia: "CS", titolo: "Assistenza salute, sicurezza ed igiene alimentare", cliente: "Pizzalvolo s.n.c. di Scarfalloto Emanuele & C.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "CS260314A", anno: "2026", tipologia: "CS", titolo: "Incarico RSPP 2026", cliente: "Ferraro Logistica S.r.l.s.", stato: "Aperta", responsabile: "Federica Votino", pm: "" },
  { codiceCommessa: "DL240271A", anno: "2024", tipologia: "DL", titolo: "Lavori ristrutturazione sala necroscopica Latina", cliente: "IZSLT - Istituto Zooprofilattico Sperimentale del Lazio e della Toscana M. Aleandri", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Alessio Puliti" },
  { codiceCommessa: "DL250061A", anno: "2025", tipologia: "DL", titolo: "Servizi lavori impianti fotovoltaici Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "Marco Cappelli" },
  { codiceCommessa: "DL250061B", anno: "2025", tipologia: "DL", titolo: "DL - CM Sostituzione compressori B41 GSK Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "Niccolò Rossi" },
  { codiceCommessa: "DL250276A", anno: "2025", tipologia: "DL", titolo: "Direzione operativa revamping linee DeNOx WTE Torino TRM", cliente: "Gruppo Ingegneria Torino s.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "" },
  { codiceCommessa: "DL260061A", anno: "2026", tipologia: "DL", titolo: "CM B22 Fire protection & smoke detector", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Davide Marchetti" },
  { codiceCommessa: "E250061B", anno: "2025", tipologia: "E", titolo: "Gestione doc Meridian - Progetti Sardone", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Andrea Romanello" },
  { codiceCommessa: "E250296A", anno: "2025", tipologia: "E", titolo: "Editing impianto acqua demineralizzata - Acea", cliente: "Fildrop S.r.l.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "Andrea Romanello" },
  { codiceCommessa: "E250296B", anno: "2025", tipologia: "E", titolo: "Editing impianti 3D", cliente: "Fildrop S.r.l.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "Andrea Romanello" },
  { codiceCommessa: "E260061A", anno: "2026", tipologia: "E", titolo: "Gestione doc Meridian GSK 2026", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Andrea Romanello" },
  { codiceCommessa: "E260285A", anno: "2026", tipologia: "E", titolo: "Editing P&ID impianti processo", cliente: "GLYCO S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Andrea Romanello" },
  { codiceCommessa: "F260000A", anno: "2026", tipologia: "F", titolo: "Formazione", cliente: "INGEGNO P & C S.R.L.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "" },
  { codiceCommessa: "G260000A", anno: "2026", tipologia: "G", titolo: "Gare per enti pubblici", cliente: "INGEGNO P & C S.R.L.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "" },
  { codiceCommessa: "G260000B", anno: "2026", tipologia: "G", titolo: "Gare per enti/soggetti privati", cliente: "INGEGNO P & C S.R.L.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "" },
  { codiceCommessa: "M24P151A", anno: "2024", tipologia: "M", titolo: "Editing vari", cliente: "Profeti Andrea", stato: "Aperta", responsabile: "Andrea Profeti", pm: "" },
  { codiceCommessa: "P210094A", anno: "2021", tipologia: "P", titolo: "Prog ristrutturaz piazza Garibaldi", cliente: "Comune di Castelfranco di Sotto", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Niccolò Rossi" },
  { codiceCommessa: "P210218A", anno: "2021", tipologia: "P", titolo: "Prog impianti Polizia Firenze", cliente: "Ing. Riccardo Del Corso", stato: "Aperta", responsabile: "Paolo Taddei", pm: "" },
  { codiceCommessa: "P220083A", anno: "2022", tipologia: "P", titolo: "Efficientamento energetico Centro Carni Vicchio", cliente: "Unione Montana dei Comuni del Mugello", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Alessio Puliti" },
  { codiceCommessa: "P220224A", anno: "2022", tipologia: "P", titolo: "Progettazione impianti Città Giardino Terranuova Bracciolini", cliente: "Eurostudio Ingegneria - Studio Tecnico Associato", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Marco Cappelli" },
  { codiceCommessa: "P230061C", anno: "2023", tipologia: "P", titolo: "Progettazione impianti fotovoltaici Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "Marco Cappelli" },
  { codiceCommessa: "P230061E", anno: "2023", tipologia: "P", titolo: "Prog interventi adeguamento imp elettrici Del. Arera 540/21 Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "" },
  { codiceCommessa: "P230061G", anno: "2023", tipologia: "P", titolo: "Servizi ingegneria esecuzione progetto FV Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "Marco Cappelli" },
  { codiceCommessa: "P230083A", anno: "2023", tipologia: "P", titolo: "Progetto impianti termici rifugi Mugello", cliente: "Unione Montana dei Comuni del Mugello", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Alessio Puliti" },
  { codiceCommessa: "P230150A", anno: "2023", tipologia: "P", titolo: "Progettazione impianti PINQUA ex Fanciullacci", cliente: "Comune di Montelupo Fiorentino", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Alessio Puliti" },
  { codiceCommessa: "P230154A", anno: "2023", tipologia: "P", titolo: "Progettazione area ex Di Brizzi", cliente: "Edra S.p.a.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "" },
  { codiceCommessa: "P230206H", anno: "2023", tipologia: "P", titolo: "Progetto sottoservizi esterni Novartis - Ivrea", cliente: "Techniconsult Firenze S.r.l.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "" },
  { codiceCommessa: "P230211A", anno: "2023", tipologia: "P", titolo: "Progettazione revamping depuratore", cliente: "Catalent Pharma Solutions", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Alessio Puliti" },
  { codiceCommessa: "P230244A", anno: "2023", tipologia: "P", titolo: "Progetto FV CABO - GSK Parma", cliente: "SOF S.p.A.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "Marco Cappelli" },
  { codiceCommessa: "P240009A", anno: "2024", tipologia: "P", titolo: "Progettazione WWTP Robbiki - Egitto", cliente: "Deltacque S.r.l.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "Andrea Romanello" },
  { codiceCommessa: "P240061B", anno: "2024", tipologia: "P", titolo: "Servizi ingegneria progetto criogenia S35 Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "Niccolò Rossi" },
  { codiceCommessa: "P240061E", anno: "2024", tipologia: "P", titolo: "Prog Lavori Adeguam Delib ARERA 540/21 Controllore Centrale di Impianto CCI Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "" },
  { codiceCommessa: "P240061G", anno: "2024", tipologia: "P", titolo: "Progetto revamping sistema acqua calda Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "Marco Cappelli" },
  { codiceCommessa: "P240154A", anno: "2024", tipologia: "P", titolo: "Ristrutturazione Edifici 03-04-05", cliente: "Edra S.p.a.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "" },
  { codiceCommessa: "P240184A", anno: "2024", tipologia: "P", titolo: "Prog DL CM risanamento fognature", cliente: "Fidia farmaceutici S.p.A.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Alessio Puliti" },
  { codiceCommessa: "P240261A", anno: "2024", tipologia: "P", titolo: "Servizi ingegneria nuovo magazzino S9 Siena", cliente: "GVGH - GSK Vaccines Institute for Global Health S.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "" },
  { codiceCommessa: "P250061A", anno: "2025", tipologia: "P", titolo: "Progettazione e permitting nuova portineria Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "" },
  { codiceCommessa: "P250061B", anno: "2025", tipologia: "P", titolo: "Nuove linee vapore e acqua addolcita B42", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "" },
  { codiceCommessa: "P250061C", anno: "2025", tipologia: "P", titolo: "Sostituzione chiller B41 Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "" },
  { codiceCommessa: "P250061D", anno: "2025", tipologia: "P", titolo: "Recupero energia termica trigeneratore Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "Marco Cappelli" },
  { codiceCommessa: "P250061E", anno: "2025", tipologia: "P", titolo: "Sostituzione caldaie e chiller Villa Gori", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "Marco Cappelli" },
  { codiceCommessa: "P250061F", anno: "2025", tipologia: "P", titolo: "Servizi modifica uffici B06 Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "" },
  { codiceCommessa: "P250061G", anno: "2025", tipologia: "P", titolo: "Servizi nuovo tornello B35 Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "" },
  { codiceCommessa: "P250061H", anno: "2025", tipologia: "P", titolo: "Servizi demolizione edificio S12B Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "Niccolò Rossi" },
  { codiceCommessa: "P250061I", anno: "2025", tipologia: "P", titolo: "Progetto revamping infrastruttura metering Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "Marco Cappelli" },
  { codiceCommessa: "P250061J", anno: "2025", tipologia: "P", titolo: "Progetto efficientamento energetico HVAC & utilities Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "Marco Cappelli" },
  { codiceCommessa: "P250061K", anno: "2025", tipologia: "P", titolo: "Ingegneria Sostituzione compressori B41 GSK Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "" },
  { codiceCommessa: "P250083A", anno: "2025", tipologia: "P", titolo: "Progettazione nuova linea gas Centro Carni", cliente: "Unione Montana dei Comuni del Mugello", stato: "Aperta", responsabile: "Federico Badalassi", pm: "Alessio Puliti" },
  { codiceCommessa: "P250129B", anno: "2025", tipologia: "P", titolo: "Servizi rete distribuzione acqua calda B53 GSK Rosia", cliente: "Battigalli S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "" },
  { codiceCommessa: "P250129D", anno: "2025", tipologia: "P", titolo: "Progetto staffaggi linee IS-ISC-SW GSK Rosia", cliente: "Battigalli S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "Andrea Romanello" },
  { codiceCommessa: "P250129E", anno: "2025", tipologia: "P", titolo: "Progetto staffaggi linee chiller B41 GSK Rosia", cliente: "Battigalli S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "Andrea Romanello" },
  { codiceCommessa: "P250132A", anno: "2025", tipologia: "P", titolo: "Progetto sostituzione quadro elettrico WWTP CRM", cliente: "A. Menarini Manufacturing Logistics and Services S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "Francesca Turi" },
  { codiceCommessa: "P250185A", anno: "2025", tipologia: "P", titolo: "Progetto sostituzione generatore vapore", cliente: "Takeda Italia S.p.A.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "Alessio Puliti" },
  { codiceCommessa: "P250198A", anno: "2025", tipologia: "P", titolo: "Servizi ingegneria sostituzione chiller", cliente: "GSK Manufacturing S.p.A.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Niccolò Rossi" },
  { codiceCommessa: "P250202A", anno: "2025", tipologia: "P", titolo: "Prog impianto ricarica veicoli elettrici", cliente: "Laboratori Archa Srl", stato: "Aperta", responsabile: "Paolo Taddei", pm: "" },
  { codiceCommessa: "P250206C", anno: "2025", tipologia: "P", titolo: "Progetto sistemi raccolta reflui Novartis - Ivrea", cliente: "Techniconsult Firenze S.r.l.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "Andrea Romanello" },
  { codiceCommessa: "P250244A", anno: "2025", tipologia: "P", titolo: "Prog Cabina B35 e collegamenti FV GSK Rosia", cliente: "SOF S.p.A.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "" },
  { codiceCommessa: "P250269C", anno: "2025", tipologia: "P", titolo: "Servizi Ingegneria Adeguamento Area Piscine", cliente: "Tenuta di Castelfalfi S.p.A.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "" },
  { codiceCommessa: "P250303A", anno: "2025", tipologia: "P", titolo: "Servizi ingegneria revamping HW B23 Rosia", cliente: "Tecnolchi srl", stato: "Aperta", responsabile: "Paolo Taddei", pm: "" },
  { codiceCommessa: "P260061A", anno: "2026", tipologia: "P", titolo: "Advanced Basic Design revamping soffitte B22", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "" },
  { codiceCommessa: "P260132A", anno: "2026", tipologia: "P", titolo: "Aggiornamento 2 progetto WWTP Sette Santi", cliente: "A. Menarini Manufacturing Logistics and Services S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "" },
  { codiceCommessa: "P260185A", anno: "2026", tipologia: "P", titolo: "Servizi nuovo stoccaggio chemicals", cliente: "Takeda Italia S.p.A.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Andrea Romanello" },
  { codiceCommessa: "P260206A", anno: "2026", tipologia: "P", titolo: "Prog aree esterne Ed 441 Novartis Huningue Francia", cliente: "Techniconsult Firenze S.r.l.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "Andrea Romanello" },
  { codiceCommessa: "P260269A", anno: "2026", tipologia: "P", titolo: "Modifica impianto elettrico mensa", cliente: "Tenuta di Castelfalfi S.p.A.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "Giovanni Orsi" },
  { codiceCommessa: "P260293A", anno: "2026", tipologia: "P", titolo: "Progetto impianto elettrico Via Rosselli", cliente: "CDC Studio S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "Giovanni Orsi" },
  { codiceCommessa: "P260311A", anno: "2026", tipologia: "P", titolo: "Prog-DL-CS ristrutturazione immobile Certaldo", cliente: "Ander’s S.r.l.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "" },
  { codiceCommessa: "PE250087A", anno: "2025", tipologia: "PE", titolo: "CTU  SHULI vs Black Stone", cliente: "Tribunale di Pisa", stato: "Aperta", responsabile: "Andrea Profeti", pm: "" },
  { codiceCommessa: "PE250300A", anno: "2025", tipologia: "PE", titolo: "Dichiarazione rispondenza Bar Arcobaleno", cliente: "Bar Arcobaleno S.r.l.s.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "Giovanni Orsi" },
  { codiceCommessa: "PE260305A", anno: "2026", tipologia: "PE", titolo: "Consulenza contenzioso rischio idraulico", cliente: "Hotel Meridiana srl", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Francesca Turi" },
  { codiceCommessa: "S240061L", anno: "2024", tipologia: "S", titolo: "CSP-CSE Glyco Revolution Project phase 2", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S240061M", anno: "2024", tipologia: "S", titolo: "Sicurezza EDS Project killing system S30 Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S240261A", anno: "2024", tipologia: "S", titolo: "CSP-CSE magazzino S9 Siena", cliente: "GVGH - GSK Vaccines Institute for Global Health S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S250061C", anno: "2025", tipologia: "S", titolo: "Gestione sicurezza cantiere installazione autoclave AU-F2692 Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S250061D", anno: "2025", tipologia: "S", titolo: "Servizi sicurezza OMV B - B40 AGS Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S250061H", anno: "2025", tipologia: "S", titolo: "Sicurezza cantieri strade, mensa, new learning zone Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S250061J", anno: "2025", tipologia: "S", titolo: "CSE cantiere RB612 B22 AVI relocation", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S250061K", anno: "2025", tipologia: "S", titolo: "Assistenza lavori Windows Obsolescence Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S250061L", anno: "2025", tipologia: "S", titolo: "Sicurezza Sostituzione compressori B41 GSK Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S260061A", anno: "2026", tipologia: "S", titolo: "Sicurezza sostituzione macchinari packaging B22 Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S260061C", anno: "2026", tipologia: "S", titolo: "Gestione DUVRI BAS Desigo upgrade", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S260061D", anno: "2026", tipologia: "S", titolo: "Sicurezza DUVRI strisce pavimenti B17-39-50", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S260061E", anno: "2026", tipologia: "S", titolo: "CSP-CSE B22 Fire protection & smoke detector", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S260061F", anno: "2026", tipologia: "S", titolo: "Assistenza lavori mRNA project B20 Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S260061G", anno: "2026", tipologia: "S", titolo: "Gestione sicurezza Tech Refresh Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S260061H", anno: "2026", tipologia: "S", titolo: "Gestione sicurezza New Combo B42 Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S260061I", anno: "2026", tipologia: "S", titolo: "Gestione sicurezza Windows server 12 obsolescence", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "S260061J", anno: "2026", tipologia: "S", titolo: "Sicurezza ampliamento aria compressa B40", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Serena Boni", pm: "Davide Marchetti" },
  { codiceCommessa: "SF250061C", anno: "2025", tipologia: "SF", titolo: "Progetto Energy saving post Kaizen Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "Marco Cappelli" },
  { codiceCommessa: "SF250276A", anno: "2025", tipologia: "SF", titolo: "Prog fattibilità migliorie trattamento fumi TRM Parma", cliente: "Gruppo Ingegneria Torino s.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "" },
  { codiceCommessa: "SF260061A", anno: "2026", tipologia: "SF", titolo: "Sistema SIP scarichi BSL2 S30 Siena", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "" },
  { codiceCommessa: "SF260061B", anno: "2026", tipologia: "SF", titolo: "Progetto fattibilità installazione rilevatori gas Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "" },
  { codiceCommessa: "SF260061C", anno: "2026", tipologia: "SF", titolo: "B41 Power center revamping Rosia", cliente: "GSK Vaccines S.r.l.", stato: "Aperta", responsabile: "Paolo Taddei", pm: "Giovanni Orsi" },
  { codiceCommessa: "SF260211A", anno: "2026", tipologia: "SF", titolo: "Progetto fattibilità suddivisione processo WWTP Anagni", cliente: "Catalent Pharma Solutions", stato: "Aperta", responsabile: "Andrea Profeti", pm: "" },
  { codiceCommessa: "SF260306A", anno: "2026", tipologia: "SF", titolo: "Realizzazione nuovo Laboratorio GMP", cliente: "L. Molteni & C. dei F.lli Alitti Soc. Immobiliare S.r.l.", stato: "Aperta", responsabile: "Federico Badalassi", pm: "" },
  { codiceCommessa: "U18F204A", anno: "2018", tipologia: "U", titolo: "Spese amministrative-segreteria", cliente: "ERRESSE STUDIO LEGALE ASSOCIATO - AVV. GIANNA REGOLI E AVV. CRISTINA SBRANA", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "" },
  { codiceCommessa: "U260000A", anno: "2026", tipologia: "U", titolo: "Gestione ufficio e attività varie", cliente: "INGEGNO P & C S.R.L.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "" },
  { codiceCommessa: "U260000B", anno: "2026", tipologia: "U", titolo: "Sistema di gestione qualità, ambiente e sicurezza", cliente: "INGEGNO P & C S.R.L.", stato: "Aperta", responsabile: "Matteo Corbellini", pm: "" },
  { codiceCommessa: "U260000C", anno: "2026", tipologia: "U", titolo: "Attività commerciale", cliente: "INGEGNO P & C S.R.L.", stato: "Aperta", responsabile: "Andrea Profeti", pm: "" },
  { codiceCommessa: "U260000D", anno: "2026", tipologia: "U", titolo: "Gestione auto aziendali", cliente: "INGEGNO P & C S.R.L.", stato: "Aperta", responsabile: "Giulia Tempone", pm: "" }
];

const envContent = readFileSync('.env', 'utf-8');
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

console.log("Inizializzazione Firebase con Project ID:", firebaseConfig.projectId);
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  try {
    const colRef = collection(db, 'catalogo_commesse');
    
    // 1. Leggi tutte le commesse esistenti per cancellarle
    console.log("Lettura delle commesse esistenti...");
    const snapshot = await getDocs(colRef);
    console.log(`Trovate ${snapshot.size} commesse da eliminare.`);
    
    let batch = writeBatch(db);
    let count = 0;
    
    for (const document of snapshot.docs) {
      batch.delete(doc(db, 'catalogo_commesse', document.id));
      count++;
      if (count === 400) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }
    if (count > 0) {
      await batch.commit();
    }
    console.log("Cancellazione completata con successo.");

    // 2. Inserisci le 102 commesse fornite
    console.log("Inserimento delle nuove commesse...");
    batch = writeBatch(db);
    count = 0;
    
    for (const comm of COMMESSE_INIZIALI) {
      const docRef = doc(colRef); // genera ID automatico
      const payload = {
        nome: `${comm.codiceCommessa} - ${comm.titolo}`,
        codiceCommessa: comm.codiceCommessa,
        anno: comm.anno,
        tipologia: comm.tipologia,
        titolo: comm.titolo,
        cliente: comm.cliente,
        stato: comm.stato,
        responsabile: comm.responsabile || '',
        pm: comm.pm || '',
        colore: '#3b82f6', // colore di default
        dataInizio: '', // senza data come richiesto
        dataFine: '' // senza data come richiesto
      };
      
      batch.set(docRef, payload);
      count++;
      
      if (count === 400) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }
    if (count > 0) {
      await batch.commit();
    }
    console.log(`Inserimento di ${COMMESSE_INIZIALI.length} commesse completato con successo!`);
    process.exit(0);
  } catch (err) {
    console.error("Errore durante la migrazione:", err);
    process.exit(1);
  }
}

run();
