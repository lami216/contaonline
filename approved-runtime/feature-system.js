export function installSystemFeatures(api){
 let exitAfterSave=false;
 const previousSettings=settings;settings=function(){return previousSettings()+section('حماية البيانات')+listMenu([['تذكير النسخ قبل الخروج',S.exitBackupReminder===false?'موقوف':'فعال','shield','site:feature:backup-reminder']])};
 globalThis.karnaBeforeExit=()=>{if(!api.actor||S.exitBackupReminder===false)return false;const last=(S.auditEvents||[]).filter(e=>!['site:backup','site:feature:exit-backup'].includes(e.action)).at(-1)?.at;if(!last||S.lastBackupAt&&last<=S.lastBackupAt)return false;act('site:feature:exit-reminder');return true};
 return {
  handles:command=>['backup-reminder','exit-reminder','exit-backup','exit-now'].includes(command),
  permission(command){return command==='backup-reminder'||command==='exit-backup'?'settings.backup.manage':null},
  sheet(){if(modal!=='feature-exit-reminder')return null;return api.modalMarkup('قبل إغلاق المحل',`<p class="notice">لديك تغييرات بعد آخر نسخة احتياطية. احفظ نسخة خارج التطبيق لحماية بياناتك.</p><div class="feature-action-pair">${api.can('settings.backup.manage')?'<button class="feature-button" data-action="site:feature:exit-backup">حفظ نسخة والخروج</button>':''}<button class="feature-button" data-action="close">متابعة العمل</button></div><button class="feature-button" data-action="site:feature:exit-now">خروج دون نسخة الآن</button>`,'','حفظ','feature-sheet')},
  async action(command){if(command==='backup-reminder'){S.exitBackupReminder=S.exitBackupReminder===false;return render()}if(command==='exit-reminder'){modal='feature-exit-reminder';return render()}if(command==='exit-now'){modal=null;window.NativeHost?.closeApp();return render()}if(command==='exit-backup'){await api.siteAction('site:backup');S.lastBackupAt=new Date().toISOString();exitAfterSave=true;}},
  afterSave(){if(exitAfterSave){exitAfterSave=false;window.NativeHost?.closeApp()}}
 };
}
