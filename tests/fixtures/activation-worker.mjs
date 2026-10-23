import { parentPort, workerData } from 'node:worker_threads';
import { ServiceStore } from '../../server/store.mjs';
import { Licensing } from '../../server/licensing.mjs';
const store=new ServiceStore(workerData.filename),licensing=new Licensing(store,workerData.signer);
const barrier=new Int32Array(workerData.barrier);
parentPort.postMessage({ready:true});Atomics.wait(barrier,0,0);
try{parentPort.postMessage({result:await licensing.enroll(workerData.session,workerData.input,workerData.now)});}catch(error){parentPort.postMessage({error:error.message});}finally{store.close();}
