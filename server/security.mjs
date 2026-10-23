import { randomBytes, scrypt as derive, timingSafeEqual, createHash, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
/** @param {string} password @param {string} salt @param {number} length @param {import('node:crypto').ScryptOptions} options @returns {Promise<Buffer>} */
const scrypt=(password,salt,length,options)=>new Promise((resolve,reject)=>derive(password,salt,length,options,(error,result)=>error?reject(error):resolve(result)));
export const token=()=>randomBytes(32).toString('base64url');
/** @param {string} value */
export const digest=value=>createHash('sha256').update(value).digest('hex');
/** @param {string} password */
export async function passwordHash(password){
  if(typeof password!=='string'||password.length<12||password.length>256)throw Error('Password must have 12–256 characters');
  const salt=randomBytes(16).toString('hex');
  const value=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  return `scrypt$32768$8$1$${salt}$${value.toString('hex')}`;
}
/** @param {string} password @param {string} stored */
export async function passwordMatches(password,stored){
  if(typeof password!=='string'||password.length>256)return false;
  const parts=String(stored).split('$');
  if(parts.length!==6||parts[0]!=='scrypt'||parts[1]!=='32768'||parts[2]!=='8'||parts[3]!=='1'||!/^[a-f0-9]{32}$/.test(parts[4])||!/^[a-f0-9]{128}$/.test(parts[5]))return false;
  const value=await scrypt(password,parts[4],64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  return timingSafeEqual(value,Buffer.from(parts[5],'hex'));
}
/** @param {string} secret @param {Buffer} key */
export function encrypt(secret,key){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  return Buffer.concat([iv,cipher.update(secret,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64url');
}
/** @param {string} value @param {Buffer} key */
export function decrypt(value,key){
  const bytes=Buffer.from(value,'base64url'),cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString('utf8');
}
// RFC 6238, 30-second steps, SHA-1, six digits. Secret is 20 random bytes.
/** @param {Buffer} secret @param {number} step */
export function otpAt(secret,step){
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const mac=createHmac('sha1',secret).update(counter).digest(),offset=mac[19]&15;
  return String((mac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
/** @param {Buffer} secret @param {string} value @param {number} now @param {number} lastStep */
export function verifyOtp(secret,value,now,lastStep=-1){
  if(!/^\d{6}$/.test(value||''))return null;
  const step=Math.floor(now/30000);
  for(const candidate of [step,step-1,step+1])if(candidate>lastStep&&timingSafeEqual(Buffer.from(otpAt(secret,candidate)),Buffer.from(value)))return candidate;
  return null;
}
/** @param {Buffer} bytes */
export function base32(bytes){let bits=0,value=0,out='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;out+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(value>>>bits)&31];}}if(bits)out+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(value<<(5-bits))&31];return out;}
