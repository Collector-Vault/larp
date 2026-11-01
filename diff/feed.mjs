export class Feed {
  constructor(store,{socketFactory=url=>new WebSocket(url),onEvent=()=>{}}={}) {
    this.store=store;this.socketFactory=socketFactory;this.onEvent=onEvent;this.attempt=0;this.stopped=false;
    this.status={state:'connecting',startedAt:Date.now(),connectedAt:null,lastMessageAt:null,lastEventAt:store.stats().lastEventAt,retryAt:null,error:null};
  }
  start() {
    if(this.stopped)return;
    this.status.state='connecting';this.status.retryAt=null;
    try { this.socket=this.socketFactory('wss://pumpportal.fun/api/data'); }catch(e){this.retry(e.message);return}
    const ws=this.socket;
    const timeout=setTimeout(()=>ws.close(),20000);
    ws.addEventListener('open',()=>{
      clearTimeout(timeout);this.status.state='connected';this.status.connectedAt=Date.now();this.status.lastMessageAt=null;this.status.error=null;
      const armWatchdog=()=>{clearTimeout(this.watchdog);this.watchdog=setTimeout(()=>{this.status.error='Source silent for three minutes; reconnecting';this.status.state='offline';ws.close()},180000)};
      this.armWatchdog=armWatchdog;armWatchdog();
      ws.send(JSON.stringify({method:'subscribeNewToken'}));
      ws.send(JSON.stringify({method:'subscribeMigration'}));
    });
    ws.addEventListener('message',event=>{
      this.status.lastMessageAt=Date.now();
      this.armWatchdog?.();
      if(typeof event.data!=='string'||event.data.length>65536)return;
      try {
        const data=JSON.parse(event.data);
        if(data.errors||data.error){this.status.error=String(data.errors||data.error).slice(0,200);ws.close(1000,'Source error');return}
        if(this.store.ingest(data)){this.status.lastEventAt=Date.now();this.attempt=0;this.status.error=null;this.status.state='connected';this.onEvent(data)}
      }catch(e){this.status.error='Invalid source message or storage error';this.status.state='degraded';}
    });
    ws.addEventListener('error',()=>{this.status.error='Source connection failed';ws.close()});
    ws.addEventListener('close',event=>{clearTimeout(timeout);clearTimeout(this.watchdog);if(!this.stopped)this.retry(this.status.error||`Source disconnected (${event.code})`,event.code)});
  }
  retry(error,code) {
    const delay=[1008,1013].includes(code)?3600000:Math.min(300000,5000*2**Math.min(this.attempt++,6));
    this.status.state='offline';this.status.error=error;this.status.retryAt=Date.now()+delay;
    this.timer=setTimeout(()=>this.start(),delay);
  }
  stop(){this.stopped=true;clearTimeout(this.timer);clearTimeout(this.watchdog);this.socket?.close();this.status.state='stopped'}
}
