import type {Locale} from "./catalog";
const events:Record<Locale,Record<string,string>>={
 "pt-PT":{"recipient.created":"Destinatário criado","recipient.deleted":"Destinatário eliminado","recipient.expired":"Destinatário expirado","message.received":"Mensagem recebida","message.captured":"Mensagem capturada","message.deleted":"Mensagem eliminada","network.settings.updated":"Configuração de rede alterada","tls.identity.uploaded":"Certificado TLS importado"},
 en:{"recipient.created":"Recipient created","recipient.deleted":"Recipient deleted","recipient.expired":"Recipient expired","message.received":"Message received","message.captured":"Message captured","message.deleted":"Message deleted","network.settings.updated":"Network settings updated","tls.identity.uploaded":"TLS certificate imported"},
 fr:{"recipient.created":"Destinataire créé","recipient.deleted":"Destinataire supprimé","recipient.expired":"Destinataire expiré","message.received":"Message reçu","message.captured":"Message intercepté","message.deleted":"Message supprimé","network.settings.updated":"Paramètres réseau modifiés","tls.identity.uploaded":"Certificat TLS importé"}
};
const reasons:Record<Locale,Record<string,string>>={
 "pt-PT":{UNKNOWN_RECIPIENT:"Destinatário desconhecido",EXPIRED_RECIPIENT:"Destinatário expirado"},
 en:{UNKNOWN_RECIPIENT:"Unknown recipient",EXPIRED_RECIPIENT:"Expired recipient"},
 fr:{UNKNOWN_RECIPIENT:"Destinataire inconnu",EXPIRED_RECIPIENT:"Destinataire expiré"}
};
export const eventLabel=(locale:Locale,type:string)=>events[locale][type]||type;
export const captureReasonLabel=(locale:Locale,reason:string)=>reasons[locale][reason]||reason;
