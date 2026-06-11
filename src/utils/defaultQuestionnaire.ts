export interface Question {
  id: string;
  text: string;
  type: 'choice' | 'checkbox' | 'text';
  options?: string[];
  section?: number;
}

export const getQuestionSection = (q: Question): number => {
  if (q.section !== undefined) return q.section;
  const match = q.id.match(/^q(\d+)$/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num <= 7) return 1;
    if (num <= 17) return 2;
    if (num <= 27) return 3;
    return 4;
  }
  return 1;
};

export const DEFAULT_QUESTIONS: Question[] = [
  {
    id: 'q1',
    text: 'Sei orgoglioso di far parte dell’Azienda per cui lavori?',
    type: 'choice',
    options: ['Assolutamente sì', 'Sì', 'Qualche volta', 'No', 'Assolutamente no'],
    section: 1
  },
  {
    id: 'q2',
    text: 'Ti vengono messi a disposizione tutti gli strumenti ed i software di cui hai bisogno per portare a termine il tuo lavoro con successo?',
    type: 'choice',
    options: ['Assolutamente sì', 'Sì', 'Qualche volta', 'No', 'Assolutamente no'],
    section: 1
  },
  {
    id: 'q3',
    text: 'Ti vengono messi a disposizione abbastanza strumenti per comunicare con i tuoi colleghi?',
    type: 'choice',
    options: ['Assolutamente sì', 'Sì', 'Abbastanza', 'No', 'Assolutamente no'],
    section: 1
  },
  {
    id: 'q4',
    text: 'Come valuti l’ambiente lavorativo in cui sei inserito su una scala da 1 a 5?',
    type: 'choice',
    options: ['5: Ottimo', '4: Buono', '3: Sufficiente', '2: Scarso', '1: Pessimo'],
    section: 1
  },
  {
    id: 'q5',
    text: 'Se incontri un problema o una sfida insolita nel corso del tuo lavoro sai dove puoi trovare una soluzione il più rapidamente possibile?',
    type: 'choice',
    options: ['Assolutamente sì', 'Sì', 'Abbastanza', 'No', 'Assolutamente no'],
    section: 1
  },
  {
    id: 'q6',
    text: 'Quanto ti senti a tuo agio quando comunichi con i tuoi superiori e con i tuoi colleghi nelle riunioni, all’interno dei progetti o quando risolvi i problemi?',
    type: 'choice',
    options: ['Moltissimo', 'Molto', 'Abbastanza', 'Poco', 'Per niente'],
    section: 1
  },
  {
    id: 'q7',
    text: 'Il tuo team di lavoro supporta e promuove il tuo lavoro in modo che tu possa ottenere i migliori risultati possibili?',
    type: 'choice',
    options: ['Assolutamente sì', 'Sì', 'Qualche volta', 'No', 'Assolutamente no'],
    section: 1
  },
  {
    id: 'q8',
    text: 'Consiglieresti la nostra azienda come datore di lavoro ai tuoi amici e conoscenti?',
    type: 'choice',
    options: ['Assolutamente no', 'No', 'Qualche volta', 'Si', 'Assolutamente si'],
    section: 2
  },
  {
    id: 'q9',
    text: 'Se sì perché?',
    type: 'text',
    section: 2
  },
  {
    id: 'q10',
    text: 'Se no perché?',
    type: 'text',
    section: 2
  },
  {
    id: 'q11',
    text: 'Lavorerai ancora per la nostra azienda nei primi due anni?',
    type: 'choice',
    options: ['Assolutamente no', 'No', 'Forse', 'Si', 'Assolutamente si'],
    section: 2
  },
  {
    id: 'q12',
    text: 'C’è sempre qualcuno lì che può prendere una decisione importante per te se qualcosa va oltre la tua autorità?',
    type: 'choice',
    options: ['Assolutamente sì', 'Sì', 'Qualche volta', 'No', 'Assolutamente no'],
    section: 2
  },
  {
    id: 'q13',
    text: 'L’azienda ti tiene informato sulle innovazioni e sui cambiamenti che ti riguardano direttamente?',
    type: 'choice',
    options: ['Assolutamente sì', 'Sì', 'Qualche volta', 'No', 'Assolutamente no'],
    section: 2
  },
  {
    id: 'q14',
    text: 'Hai abbastanza strumenti per comunicare con i tuoi colleghi?',
    type: 'choice',
    options: ['Assolutamente sì', 'Sì', 'Abbastanza', 'No', 'Assolutamente no'],
    section: 2
  },
  {
    id: 'q15',
    text: 'Quanto ritieni di essere coinvolto dal tuo Responsabile nel lavoro del tuo team?',
    type: 'choice',
    options: ['Moltissimo', 'Molto', 'Abbastanza', 'Poco', 'Per niente'],
    section: 2
  },
  {
    id: 'q16',
    text: 'Quanto ti senti parte della tua squadra di lavoro?',
    type: 'choice',
    options: ['Moltissimo', 'Molto', 'Abbastanza', 'Poco', 'Per niente'],
    section: 2
  },
  {
    id: 'q17',
    text: 'In che misura il tuo team apprezza le tue opinioni sul lavoro?',
    type: 'choice',
    options: ['Moltissimo', 'Molto', 'Abbastanza', 'Poco', 'Per niente'],
    section: 2
  },
  {
    id: 'q18',
    text: 'Quanto spesso il tuo contributo professionale risulta fondamentale?',
    type: 'choice',
    options: ['Molto spesso', 'Spesso', 'Abbastanza spesso', 'Poco', 'Per niente'],
    section: 3
  },
  {
    id: 'q19',
    text: 'Quanto è importante il tuo lavoro?',
    type: 'choice',
    options: ['Moltissimo', 'Molto', 'Abbastanza', 'Poco', 'Per niente'],
    section: 3
  },
  {
    id: 'q20',
    text: 'Trovi che il tuo lavoro sia impegnativo?',
    type: 'choice',
    options: ['Assolutamente sì', 'Sì', 'Abbastanza', 'No', 'Per niente'],
    section: 3
  },
  {
    id: 'q21',
    text: 'Quanto ritieni di essere importante per il buon esito e la riuscita del lavoro della tua Azienda?',
    type: 'choice',
    options: ['Moltissimo', 'Molto', 'Abbastanza', 'Poco', 'Per niente'],
    section: 3
  },
  {
    id: 'q22',
    text: 'Quanto spesso durante la settimana hai troppo lavoro o sei stressato?',
    type: 'choice',
    options: ['Molto spesso', 'Spesso', 'Abbastanza spesso', 'Poco', 'Per niente'],
    section: 3
  },
  {
    id: 'q23',
    text: 'Sei soddisfatto del tuo lavoro?',
    type: 'choice',
    options: ['Assolutamente sì', 'Sì', 'Qualche volta', 'No', 'Assolutamente no'],
    section: 3
  },
  {
    id: 'q24',
    text: 'Sei pagato adeguatamente per il tuo lavoro?',
    type: 'choice',
    options: ['Assolutamente sì', 'Sì', 'Sufficientemente', 'No', 'Assolutamente no'],
    section: 3
  },
  {
    id: 'q25',
    text: 'Troveresti facilmente lavoro al di fuori della tua azienda?',
    type: 'choice',
    options: ['Assolutamente sì', 'Sì', 'Forse sì', 'No', 'Assolutamente no'],
    section: 3
  },
  {
    id: 'q26',
    text: 'Quante opportunità di crescita ti vengono offerte dove lavori?',
    type: 'choice',
    options: ['Moltissime', 'Molte', 'Abbastanza', 'Poche', 'Nessuna'],
    section: 3
  },
  {
    id: 'q27',
    text: 'Pensi che l’ambiente di lavoro ti aiuti a trovare il giusto equilibrio tra lavoro e vita privata?',
    type: 'choice',
    options: ['Assolutamente sì', 'Sì', 'Qualche volta', 'No', 'Assolutamente no'],
    section: 3
  },
  {
    id: 'q28',
    text: 'Quali tra i seguenti vantaggi aziendali ritieni sarebbe opportuno che l’azienda mettesse a tua disposizione:',
    type: 'checkbox',
    options: [
      'Flessibilità orario lavorativo',
      'Auto aziendale',
      'Benefit aziendali (buoni carburante, buoni spesa)',
      'Altro (specificalo nello spazio sottostante)'
    ],
    section: 4
  },
  {
    id: 'q29',
    text: 'Altro (specificalo nello spazio sottostante):',
    type: 'text',
    section: 4
  },
  {
    id: 'q30',
    text: 'In che modo pensi di renderti utile per l’azienda in cui lavori?',
    type: 'text',
    section: 4
  },
  {
    id: 'q31',
    text: 'Quali delle tue migliori doti pensi di mettere costantemente a disposizione dell’azienda in cui lavori?',
    type: 'text',
    section: 4
  },
  {
    id: 'q32',
    text: 'Qual è secondo te il miglior risultato che l’azienda ottiene normalmente?',
    type: 'text',
    section: 4
  },
  {
    id: 'q33',
    text: 'Qual è stato secondo te il miglior risultato ottenuto dall’azienda da quando lavori in essa?',
    type: 'text',
    section: 4
  },
  {
    id: 'q34',
    text: 'Secondo te hai contribuito fattivamente al raggiungimento del risultato aziendale o è stato fondamentale il tuo contributo?',
    type: 'text',
    section: 4
  }
];
