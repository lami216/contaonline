import { loadPrivacySettings, renderPrivacyPolicy, text } from './privacy-content.js';
const settings=await loadPrivacySettings();
function render(language){document.documentElement.lang=language;document.documentElement.dir=language==='fr'?'ltr':'rtl';renderPrivacyPolicy(document.getElementById('privacy-policy'),settings);document.getElementById('privacy-back').textContent=text('العودة إلى التطبيق','Retour à l’application');for(const button of document.querySelectorAll('[data-policy-language]'))button.setAttribute('aria-pressed',String(button.dataset.policyLanguage===language));}
for(const button of document.querySelectorAll('[data-policy-language]'))button.onclick=()=>render(button.dataset.policyLanguage);
render(localStorage.getItem('alkarna-site-language')==='fr'?'fr':'ar');
