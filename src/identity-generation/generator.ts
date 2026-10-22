import {randomInt,randomUUID} from "node:crypto";
import pt from "./catalogs/pt-PT.json" with {type:"json"};
import en from "./catalogs/en-US.json" with {type:"json"};
import fr from "./catalogs/fr-FR.json" with {type:"json"};
import {Fault,type Channel} from "../domain-types.js";

export const locales=["pt-PT","en-US","fr-FR"] as const;
export type IdentityLocale=typeof locales[number];
export const emailStrategies=["FIRST_LAST","LAST_FIRST","FIRST_MIDDLE_LAST","FIRST_LAST_SUFFIX","RANDOM"] as const;
export type EmailStrategy=typeof emailStrategies[number];
export const phoneStrategies=["NATIONAL_FORMAT"] as const;
export type PhoneStrategy=typeof phoneStrategies[number];
export type Generation={locale?:IdentityLocale;strategy?:EmailStrategy|PhoneStrategy;safeTestData?:boolean;includeCountryCode?:boolean;domain?:string};
const catalogs:Record<IdentityLocale,typeof pt>={"pt-PT":pt,"en-US":en,"fr-FR":fr};
const env=process.env;
const bool=(value:string|undefined,fallback:boolean)=>value===undefined?fallback:value==="true";
const configuredLocale=env.IDENTITY_DEFAULT_LOCALE||"pt-PT";
const configuredEmailStrategy=env.IDENTITY_DEFAULT_EMAIL_STRATEGY||"FIRST_LAST";
const configuredPhoneStrategy=env.IDENTITY_DEFAULT_PHONE_STRATEGY||"NATIONAL_FORMAT";
const configuredAttempts=Number(env.IDENTITY_DEFAULT_GENERATION_MAX_ATTEMPTS||100);
if(!locales.includes(configuredLocale as IdentityLocale))throw Error("Invalid IDENTITY_DEFAULT_LOCALE");
if(!emailStrategies.includes(configuredEmailStrategy as EmailStrategy))throw Error("Invalid IDENTITY_DEFAULT_EMAIL_STRATEGY");
if(!phoneStrategies.includes(configuredPhoneStrategy as PhoneStrategy))throw Error("Invalid IDENTITY_DEFAULT_PHONE_STRATEGY");
if(!Number.isSafeInteger(configuredAttempts)||configuredAttempts<1||configuredAttempts>10000)throw Error("Invalid IDENTITY_DEFAULT_GENERATION_MAX_ATTEMPTS");
export const generationDefaults={
 locale:configuredLocale as IdentityLocale,
 emailStrategy:configuredEmailStrategy as EmailStrategy,
 phoneStrategy:configuredPhoneStrategy as PhoneStrategy,
 includeCountryCode:bool(env.IDENTITY_DEFAULT_PHONE_INCLUDE_COUNTRY_CODE,true),
 safeTestData:bool(env.IDENTITY_DEFAULT_SAFE_TEST_DATA,false),
 maxAttempts:configuredAttempts,
 domain:env.IDENTITY_DEFAULT_EMAIL_DOMAIN||"sandbox.test"
};
function pick<T>(options:readonly T[]):T{return options[randomInt(options.length)]}
function slug(value:string){return value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]/g,"").toLowerCase()}
function resolveParams(channel:Channel,input:Generation={}){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw new Fault(400,"Invalid generation options","INVALID_REQUEST");
 const locale=input.locale??generationDefaults.locale;
 if(!locales.includes(locale))throw new Fault(400,"Unsupported locale","INVALID_REQUEST");
 const strategy=input.strategy??(channel==="email"?generationDefaults.emailStrategy:generationDefaults.phoneStrategy);
 if(channel==="email"?!emailStrategies.includes(strategy as EmailStrategy):!phoneStrategies.includes(strategy as PhoneStrategy))throw new Fault(400,"Invalid generation strategy","INVALID_REQUEST");
 const domain=input.domain??generationDefaults.domain;
 if(channel==="email"&&(!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)||domain.length>180))throw new Fault(400,"Invalid email domain","INVALID_REQUEST");
 if(input.safeTestData!==undefined&&typeof input.safeTestData!=="boolean")throw new Fault(400,"Invalid safeTestData","INVALID_REQUEST");
 if(input.includeCountryCode!==undefined&&typeof input.includeCountryCode!=="boolean")throw new Fault(400,"Invalid includeCountryCode","INVALID_REQUEST");
 return {locale,strategy,domain,safeTestData:input.safeTestData??generationDefaults.safeTestData,includeCountryCode:input.includeCountryCode??generationDefaults.includeCountryCode};
}
export function generateAddress(channel:Channel,input:Generation={}):string{
 const options=resolveParams(channel,input);
 if(channel==="email"){
  const catalog=catalogs[options.locale];
  const first=slug(pick(catalog.firstNames)),second=slug(pick(catalog.firstNames)),last=slug(pick(catalog.lastNames));
  let local="";
  switch(options.strategy){
   case "FIRST_LAST":local=first+"."+last;break;
   case "LAST_FIRST":local=last+"."+first;break;
   case "FIRST_MIDDLE_LAST":local=first+"."+second+"."+last;break;
   case "FIRST_LAST_SUFFIX":local=first+"."+last+"."+randomInt(100,10000);break;
   case "RANDOM":local="inbox-"+randomUUID().slice(0,10);break;
   default:throw new Fault(400,"Invalid email strategy","INVALID_REQUEST");
  }
  return local+"@"+(options.safeTestData?"sandbox.test":options.domain);
 }
 const profile=catalogs[options.locale].phone;
 // A suffix recognisable as test data; in normal mode these are national-format
 // numbers and may be assigned to real subscribers. No safety claim is made.
 if(options.safeTestData){
  const national=options.includeCountryCode?"9"+String(randomInt(0,100000)).padStart(5,"0")+"401":"000"+String(randomInt(0,1000)).padStart(3,"0")+"401";
  return options.includeCountryCode?"+999"+national:national;
 }
 const prefix=pick(profile.mobilePrefixes);
 const n=profile.nationalLength-prefix.length-profile.pattern.length;
 if(n<0)throw new Fault(500,"Invalid phone mask","INTERNAL_ERROR");
 const middle=Array.from({length:n},()=>String(randomInt(10))).join("");
 const national=prefix+middle+profile.pattern;
 const e164National=profile.trunk&&national.startsWith(profile.trunk)?national.slice(profile.trunk.length):national;
 return options.includeCountryCode?"+"+profile.countryCode+e164National:national;
}
export function canonicalAddress(channel:Channel,address:string,locale:IdentityLocale=generationDefaults.locale){
 if(channel==="email")return address.trim().toLowerCase();
 const trimmed=address.trim();if(trimmed.startsWith("+"))return trimmed;
 const profile=catalogs[locale].phone;
 if(!/^\d+$/.test(trimmed)||trimmed.length!==profile.nationalLength||!profile.mobilePrefixes.some(prefix=>trimmed.startsWith(prefix)))return trimmed;
 const withoutTrunk=profile.trunk&&trimmed.startsWith(profile.trunk)?trimmed.slice(profile.trunk.length):trimmed;
 return "+"+profile.countryCode+withoutTrunk;
}
export function generationOptions(){return {locales,strategies:{email:emailStrategies,sms:phoneStrategies},defaults:generationDefaults,phoneProfiles:Object.fromEntries(locales.map(locale=>[locale,{countryCode:"+"+catalogs[locale].phone.countryCode,pattern:catalogs[locale].phone.pattern}]))};}
