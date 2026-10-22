import type {Locale} from "./catalog";
export const errorMessages:Record<Locale,Record<string,string>>={
 "pt-PT":{INBOX_NOT_FOUND:"Caixa de entrada não encontrada",IDENTITY_GENERATION_EXHAUSTED:"Não foi possível gerar um identificador disponível",MESSAGE_NOT_FOUND:"Mensagem não encontrada",INVALID_TTL:"Prazo de validade inválido",RECIPIENT_EXPIRED:"Destinatário expirado",TLS_CERTIFICATE_INVALID:"Certificado TLS inválido",MESSAGE_TOO_LARGE:"Mensagem demasiado grande",FORBIDDEN:"Operação não autorizada",CONFLICT:"Conflito com recurso existente",CAPACITY_EXCEEDED:"Capacidade da sandbox excedida",RESOURCE_NOT_FOUND:"Recurso não encontrado",INVALID_REQUEST:"Pedido inválido",INTERNAL_ERROR:"Erro interno do servidor"},
 en:{INBOX_NOT_FOUND:"Inbox not found",IDENTITY_GENERATION_EXHAUSTED:"No available identifier could be generated",MESSAGE_NOT_FOUND:"Message not found",INVALID_TTL:"Invalid expiration period",RECIPIENT_EXPIRED:"Recipient expired",TLS_CERTIFICATE_INVALID:"Invalid TLS certificate",MESSAGE_TOO_LARGE:"Message too large",FORBIDDEN:"Forbidden",CONFLICT:"Resource conflict",CAPACITY_EXCEEDED:"Sandbox capacity exceeded",RESOURCE_NOT_FOUND:"Resource not found",INVALID_REQUEST:"Invalid request",INTERNAL_ERROR:"Internal server error"},
 fr:{INBOX_NOT_FOUND:"Boîte introuvable",IDENTITY_GENERATION_EXHAUSTED:"Impossible de générer un identifiant disponible",MESSAGE_NOT_FOUND:"Message introuvable",INVALID_TTL:"Durée de vie invalide",RECIPIENT_EXPIRED:"Destinataire expiré",TLS_CERTIFICATE_INVALID:"Certificat TLS invalide",MESSAGE_TOO_LARGE:"Message trop volumineux",FORBIDDEN:"Opération interdite",CONFLICT:"Conflit de ressource",CAPACITY_EXCEEDED:"Capacité du simulateur dépassée",RESOURCE_NOT_FOUND:"Ressource introuvable",INVALID_REQUEST:"Requête invalide",INTERNAL_ERROR:"Erreur interne du serveur"}
};
export function localizeError(error:unknown,locale:Locale):string{
 const e=error as {errorCode?:string;message?:string};
 const code=e?.errorCode;
 return code?(errorMessages[locale][code]||errorMessages.en[code]||e.message||code):e?.message||String(error);
}
