import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { createGreenhouse, validateStatus, RETENTION_MS, POLL_MS } from './server.mjs';

test('polling, storage, retention, reconnect, command confirmation and demo isolation', async () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  await mkdir(path.join(dir, 'test-data'), { recursive: true });
  const dataDir = await mkdtemp(path.join(dir, 'test-data/run-'));
  let time = Date.now(), sequence = 1, failed = false, badAck = false, calls = 0;
  const status = {
    sampleId: 'boot1:1', values: {temp:24,humidity:65,soil:40,light:600,water:75},
    devices: {pump:{on:false,mode:'manual'},fan:{on:false,mode:'auto'},lamp:{on:true,mode:'manual'}},
    settings: {hot:29,dry:35,waterMin:20,lightStart:'06:00',lightEnd:'19:00'}
  };
  const mock = http.createServer(async (req,res) => {
    calls++;
    if (failed) {res.writeHead(503).end();return;}
    assert.equal(req.headers.authorization, 'Bearer test-device-token-123');
    if(req.method==='GET'){res.end(JSON.stringify(status));return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);
    if(req.url==='/api/settings')status.settings=body.settings;
    else {
      const id=req.url.split('/').at(-1);
      if(['on','off'].includes(body.action))status.devices[id].on=body.action==='on';
      else status.devices[id].mode=body.action;
    }
    status.sampleId='boot1:'+ ++sequence;
    res.end(JSON.stringify({commandId:badAck?'wrong':body.commandId,applied:true,status}));
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  let app;
  async function open(live=true){
    app=await createGreenhouse({root:dir,dataDir,live,espUrl:'http://127.0.0.1:'+mock.address().port,
      espToken:'test-device-token-123',now:()=>time,startPolling:false});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    return 'http://127.0.0.1:'+app.server.address().port;
  }
  try {
    assert.equal(POLL_MS,10000);
    let base=await open();
    const get=async url=>(await fetch(base+url)).json();
    await app.poll();
    assert.equal(app.connection().connected,true);
    assert.equal((await get('/api/history')).rows.length,1);
    await app.poll();
    assert.equal((await get('/api/history')).rows.length,1,'deduplicate sample ID');
    const configText=await (await fetch(base+'/runtime-config.js')).text();
    const config=JSON.parse(configText.replace('window.GREENHOUSE_RUNTIME=','').replace(/;$/,''));
    const post=(url,body,token=config.csrf)=>fetch(base+url,{method:'POST',
      headers:{'Content-Type':'application/json','X-Greenhouse-CSRF':token},body:JSON.stringify(body)});
    assert.equal((await post('/api/devices/pump',{action:'on'},'invalid')).status,400);
    let response=await post('/api/devices/pump',{action:'on'});
    assert.equal(response.status,200);
    assert.equal((await response.json()).confirmed,true);
    status.values.water=5;status.sampleId='boot1:'+ ++sequence;await app.poll();
    assert.equal((await post('/api/devices/pump',{action:'on'})).status,400);
    badAck=true;
    assert.equal((await post('/api/devices/pump',{action:'off'})).status,400,'never claim success for wrong ACK');
    assert.match(app.connection().error,/unconfirmed/);
    badAck=false;await app.poll();
    failed=true;time+=10000;await app.poll();
    assert.equal(app.connection().connected,false);
    assert.equal((await post('/api/devices/lamp',{action:'on'})).status,400);
    failed=false;status.sampleId='boot1:'+ ++sequence;await app.poll();
    assert.equal(app.connection().connected,true,'recover after reconnect');
    time+=RETENTION_MS+1;
    assert.equal((await get('/api/history?hours=720')).rows.length,0,'old rows removed');
    status.sampleId='boot1:'+ ++sequence;await app.poll();
    assert.equal((await get('/api/history?hours=720')).rows.length,1);
    await app.close();
    base=await open();
    assert.equal((await (await fetch(base+'/api/history?hours=720')).json()).rows.length,1,'history persists after restart');
    assert.equal(app.connection().connected,false,'restart needs fresh read');
    assert.throws(()=>validateStatus({...status,values:{...status.values,temp:999}}));
    assert.equal((await fetch(base+'/api/history?hours=721')).status,400);
    await app.close();
    base=await open(false);
    const before=calls;
    await app.poll();
    assert.equal(calls,before,'demo never contacts ESP32');
    assert.equal((await (await fetch(base+'/api/status')).json()).connection.mode,'demo');
  } finally {
    if(app)await app.close();
    await new Promise(resolve=>mock.close(resolve));
  }
});

test('browser keeps demo isolated and routes live controls without simulated changes', async () => {
  const { readFile } = await import('node:fs/promises');
  const { Script, createContext, runInContext } = await import('node:vm');
  const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  for(const live of [false,true]){
    const elements=new Map();
    const element=id=>{
      if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:id==='range'?'24':'temp',
        addEventListener(){},focus(){},elements:{namedItem(){return {value:''}}}});
      return elements.get(id);
    };
    const commands=[];
    const context=createContext({
      document:{hidden:false,activeElement:null,getElementById:element,querySelectorAll(){return[]},querySelector(){return null},addEventListener(){}},
      window:{GREENHOUSE_RUNTIME:{live},addEventListener(){},scrollTo(){}},
      location:{hash:'#overview'},localStorage:{getItem(){return null},setItem(){}},
      setInterval(){},setTimeout(){},clearTimeout(){},
      sendLiveCommand:(...args)=>commands.push(args)
    });
    new Script(source).runInContext(context);
    if(live){
      assert.equal(runInContext('state.history.length',context),0);
      assert.equal(runInContext('state.values.temp',context),null);
      runInContext("command('pump','on')",context);
      assert.deepEqual(commands,[['pump','on']]);
      assert.equal(runInContext('state.devices.pump.on',context),null);
      assert.equal(runInContext('applyRules()',context),false);
    }else{
      assert.equal(runInContext('state.values.temp',context),24.6);
      runInContext("command('pump','auto');scenario('dry')",context);
      assert.equal(runInContext('state.devices.pump.on',context),true);
      assert.equal(commands.length,0);
    }
  }
});
