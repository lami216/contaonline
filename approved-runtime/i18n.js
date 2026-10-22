import {translations} from './language.js';
export function appLanguage(){try{return localStorage.getItem('alkarna-site-language')==='fr'?'fr':'ar'}catch{return 'ar'}}
export function localeTag(){return appLanguage()==='fr'?'fr-MR-u-nu-latn':'ar-MR-u-nu-latn'}
export function formatNumber(value,options={}){return Number(value).toLocaleString(appLanguage()==='fr'?'fr-FR':'en-US',{maximumFractionDigits:2,...options})}
const escapePattern=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.entries(translations).filter(([ar])=>/\{\w+\}/.test(ar)).sort((a,b)=>b[0].replace(/\{\w+\}/g,'').length-a[0].replace(/\{\w+\}/g,'').length).map(([ar,fr])=>{const keys=[];let last=0,source='';for(const match of ar.matchAll(/\{(\w+)\}/g)){source+=escapePattern(ar.slice(last,match.index))+'(.+?)';keys.push(match[1]);last=match.index+match[0].length}return {regex:new RegExp('^'+source+escapePattern(ar.slice(last))+'$','u'),keys,fr}});
export function translateText(value,language=appLanguage()){
 const raw=String(value??'');if(language!=='fr')return raw;
 if(!/[\u0600-\u06ff]/.test(raw))return raw.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g,'$3/$2/$1');
 const text=raw.trim();if(Object.hasOwn(translations,text))return raw.replace(text,translations[text]);
 const plain=text.replace(/[.。]$/u,'');if(plain!==text&&Object.hasOwn(translations,plain))return raw.replace(text,translations[plain]+'.');
 for(const p of patterns){const match=text.match(p.regex);if(match){let out=p.fr;p.keys.forEach((key,i)=>{out=out.replaceAll('{'+key+'}', ['metric','column','kind'].includes(key)?translateText(match[i+1],language):match[i+1])});return raw.replace(text,out)}}
 if(text.endsWith('⌄'))return raw.replace(text,translateText(text.slice(0,-1),language)+'⌄');
 const label=text.match(/^(.+?)\s*:\s+(.+)$/u);if(label&&(Object.hasOwn(translations,label[1])||!/[\u0600-\u06ff]/.test(label[1])))return raw.replace(text,translateText(label[1],language)+' : '+translateText(label[2],language));
 const count=text.match(/^([\d.,\u00a0\u202f–—\- ]+)\s+(.+)$/u);if(count&&Object.hasOwn(translations,count[2]))return raw.replace(text,count[1].trim()+' '+translations[count[2]]);
 // Translate punctuation-separated system labels without rewriting captured names.
 const chunks=raw.split(/(\s*[·•]\s*|\n|\s+—\s+)/u);if(chunks.length>1)return chunks.map((s,i)=>i%2?s:translateText(s,language)).join('');
 return raw;
}
export function languagePicker(action='site:language'){
 const selected=appLanguage();return `<div class="locale-switch" role="group" aria-label="Langue / اللغة"><button type="button" lang="ar" dir="rtl" data-action="${action}:ar" aria-pressed="${selected==='ar'}">العربية</button><button type="button" lang="fr" dir="ltr" data-action="${action}:fr" aria-pressed="${selected==='fr'}">Français</button></div>`;
}
