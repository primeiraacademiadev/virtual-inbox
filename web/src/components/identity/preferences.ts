export type IdentityLocale="pt-PT"|"en-US"|"fr-FR";
export type IdentityPrefs={locale:IdentityLocale;emailStrategy:string;phoneStrategy:string;safeTestData:boolean;includeCountryCode:boolean};
export type GenerationOptions={locales:IdentityLocale[];strategies:{email:string[];sms:string[]};defaults:{locale:IdentityLocale;emailStrategy:string;phoneStrategy:string;safeTestData:boolean;includeCountryCode:boolean;maxAttempts:number;domain:string};phoneProfiles:Record<string,{countryCode:string;pattern:string}>};
export const localeForUi=(locale:string):IdentityLocale=>locale.startsWith("fr")?"fr-FR":locale.startsWith("en")?"en-US":"pt-PT";
export const initialPrefs=(uiLocale:string):IdentityPrefs=>({locale:localeForUi(uiLocale),emailStrategy:"FIRST_LAST",phoneStrategy:"NATIONAL_FORMAT",safeTestData:false,includeCountryCode:true});
const key="virtual-inbox-generation";
export function restorePrefs(uiLocale:string):IdentityPrefs{
 try{const stored=JSON.parse(sessionStorage.getItem(key)||"null");if(stored&&typeof stored==="object"&&["pt-PT","en-US","fr-FR"].includes(stored.locale))return {...initialPrefs(uiLocale),...stored}}catch{}
 return initialPrefs(uiLocale);
}
export function savePrefs(prefs:IdentityPrefs){try{sessionStorage.setItem(key,JSON.stringify(prefs))}catch{}}
