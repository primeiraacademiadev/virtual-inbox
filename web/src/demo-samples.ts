import type { Locale } from "./i18n/catalog.js";

export type DemoSample = { subject: string; body: string };

// All demo material is shipped with the application. No network, AI or third-party APIs.
const samples: Record<Locale, readonly DemoSample[]> = {
  "pt-PT": [
    { subject: "Confirmação de teste", body: "Esta mensagem confirma que o envio de demonstração foi recebido corretamente." },
    { subject: "Atualização de estado", body: "A operação de exemplo mudou de estado. Podes verificar os detalhes na inbox." },
    { subject: "Convite de demonstração", body: "Gostaríamos de convidar-te para uma sessão fictícia na próxima semana." },
    { subject: "Lembrete de atividade", body: "Este é um lembrete criado localmente para testar a receção de mensagens." },
    { subject: "Resumo da manhã", body: "O resumo de exemplo inclui três eventos e não requer qualquer ação." },
    { subject: "Notificação de entrega", body: "A tua entrega fictícia foi concluída. Esta mensagem é apenas para testes." },
    { subject: "Pedido de confirmação", body: "Confirma, por favor, que esta mensagem aparece na caixa de receção." },
    { subject: "Resultado da verificação", body: "A verificação de demonstração terminou. Todos os dados apresentados são fictícios." },
  ],
  en: [
    { subject: "Test confirmation", body: "This message confirms that the demo delivery was received correctly." },
    { subject: "Status update", body: "The sample operation has changed status. Check the inbox for details." },
    { subject: "Demo invitation", body: "You are invited to a fictional session next week." },
    { subject: "Activity reminder", body: "This reminder was generated locally to test incoming messages." },
    { subject: "Morning summary", body: "The example summary includes three events and requires no action." },
    { subject: "Delivery notification", body: "Your fictional delivery is complete. This is a test message only." },
    { subject: "Confirmation request", body: "Please confirm that this message appears in your inbox." },
    { subject: "Verification result", body: "The demonstration check finished. All displayed information is fictional." },
  ],
  fr: [
    { subject: "Confirmation de test", body: "Ce message confirme que l’envoi de démonstration a bien été reçu." },
    { subject: "Mise à jour du statut", body: "L’opération fictive a changé de statut. Consultez les détails dans la boîte." },
    { subject: "Invitation de démonstration", body: "Vous êtes invité à une séance fictive la semaine prochaine." },
    { subject: "Rappel d’activité", body: "Ce rappel a été généré localement pour tester la réception des messages." },
    { subject: "Résumé du matin", body: "Le résumé d’exemple contient trois événements et ne demande aucune action." },
    { subject: "Notification de livraison", body: "Votre livraison fictive est terminée. Ce message sert uniquement aux tests." },
    { subject: "Demande de confirmation", body: "Veuillez confirmer que ce message apparaît dans la boîte de réception." },
    { subject: "Résultat de la vérification", body: "La vérification de démonstration est terminée. Toutes les données sont fictives." },
  ],
};

export function generateDemoSample(locale: Locale, previousSubject?: string): DemoSample {
  const options = samples[locale];
  const alternatives = options.filter((sample) => sample.subject !== previousSubject);
  const pool = alternatives.length ? alternatives : options;
  return { ...pool[Math.floor(Math.random() * pool.length)] };
}

type DemoUpdates = { setSubject: (subject: string) => void; setBody: (body: string) => void };

/** Apply a locally generated example without overwriting unrelated message fields. */
export function applyDemoSample(locale: Locale, previousSubject: string | undefined, updates: DemoUpdates) {
  const sample = generateDemoSample(locale, previousSubject);
  updates.setSubject(sample.subject);
  updates.setBody(sample.body);
  return sample;
}

/** A new composition gets a fresh message and no attachments. */
export function beginDemoCompose(
  locale: Locale,
  previousSubject: string | undefined,
  updates: DemoUpdates & { clearAttachments: () => void; showComposer: () => void },
) {
  applyDemoSample(locale, previousSubject, updates);
  updates.clearAttachments();
  updates.showComposer();
}

/** Changing locale must not overwrite a draft being edited. */
export function refreshDemoOnLocaleChange(locale: Locale, composing: boolean, updates: DemoUpdates) {
  if (composing) return false;
  applyDemoSample(locale, undefined, updates);
  return true;
}
