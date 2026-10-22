import {createContext,useContext,useEffect,useMemo,useState,type ReactNode} from "react";
import {labels,locales,parseLocale,translate,type Locale,type MessageKey} from "./catalog";
type I18n={locale:Locale;setLocale:(locale:Locale)=>void;t:(key:MessageKey)=>string;formatDate:(value:string|Date)=>string;formatNumber:(value:number)=>string};
const Context=createContext<I18n|null>(null);
const key="virtual-inbox-locale";
export function LocaleProvider({children}:{children:ReactNode}){
 const [locale,setLocale]=useState<Locale>(()=>{try{const stored=localStorage.getItem(key);if(stored)return parseLocale(stored)}catch{}return parseLocale(navigator.languages?.[0]||navigator.language)});
 useEffect(()=>{document.documentElement.lang=locale;try{localStorage.setItem(key,locale)}catch{}},[locale]);
 const value=useMemo<I18n>(()=>({locale,setLocale,t:key=>translate(locale,key),formatDate:value=>new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)),formatNumber:value=>new Intl.NumberFormat(locale).format(value)}),[locale]);
 return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useI18n(){const value=useContext(Context);if(!value)throw Error("LocaleProvider missing");return value}
export {labels,locales};
