export class Feed {
  constructor(store,{socketFactory=url=>new WebSocket(url),onEvent=()=>{}}={}) {
    this.store=store;this.socketFactory=socketFactory;this.onEvent=onEvent;this.attempt=0;this.stopped=false;
    this.status={state:'connecting',startedAt:Date.now(),connectedAt:null,lastMessageAt:null,lastEventAt:store.stats().lastEventAt,retryAt:null,error:null};
  }
  start() {
    if(this.stopped||this.socket||this.timer)return;
    this.status.state='connecting';this.status.retryAt=null;
    try { this.socket=this.socketFactory('wss://pumpportal.fun/api/data'); }catch(e){this.retry(e.message);return}
    const ws=this.socket;this.lastSocket=ws;
    const active=()=>!this.stopped&&this.socket===ws;
    // Retire first: closing may dispatch synchronously or never acknowledge at all.
    const disconnect=(error,code)=>{
      if(!active())return;
      this.socket=null;clearTimeout(this.connectTimer);clearTimeout(this.watchdog);
      this.retry(error,code);
      try{ws.close()}catch{}
    };
    const armWatchdog=()=>{
      clearTimeout(this.watchdog);
      this.watchdog=setTimeout(()=>disconnect('Source silent for three minutes; reconnecting'),180000);
    };
    this.connectTimer=setTimeout(()=>disconnect('Source connection timed out'),20000);
    ws.addEventListener('open',()=>{
      if(!active())return;
      clearTimeout(this.connectTimer);this.status.state='connected';this.status.connectedAt=Date.now();this.status.lastMessageAt=null;this.status.error=null;
      armWatchdog();
      try{
        ws.send(JSON.stringify({method:'subscribeNewToken'}));
        ws.send(JSON.stringify({method:'subscribeMigration'}));
      }catch{disconnect('Source subscription failed')}
    });
    ws.addEventListener('message',event=>{
      if(!active())return;
      this.status.lastMessageAt=Date.now();armWatchdog();
      if(typeof event.data!=='string'||event.data.length>65536)return;
      try {
        const data=JSON.parse(event.data);
        if(data.errors||data.error){disconnect(String(data.errors||data.error).slice(0,200));return}
        if(this.store.ingest(data)){this.status.lastEventAt=Date.now();this.attempt=0;this.status.error=null;this.status.state='connected';this.onEvent(data)}
      }catch(e){this.status.error='Invalid source message or storage error';this.status.state='degraded';}
    });
    ws.addEventListener('error',()=>disconnect('Source connection failed'));
    ws.addEventListener('close',event=>{
      if(active()){disconnect(this.status.error||`Source disconnected (${event.code})`,event.code);return}
      // Transport errors can precede the policy close. Escalate only this retired
      // connection, never a stale generation or a stopped feed.
      if(!this.stopped&&!this.socket&&this.lastSocket===ws&&[1008,1013].includes(event.code)){
        clearTimeout(this.timer);this.timer=null;this.retry(`Source disconnected (${event.code})`,event.code);
      }
    });
  }
  retry(error,code) {
    if(this.stopped||this.timer)return;
    const delay=[1008,1013].includes(code)?3600000:Math.min(300000,5000*2**Math.min(this.attempt++,6));
    this.status.state='offline';this.status.error=error;this.status.retryAt=Date.now()+delay;
    this.timer=setTimeout(()=>{this.timer=null;this.start()},delay);
  }
  stop(){
    this.stopped=true;clearTimeout(this.timer);clearTimeout(this.watchdog);clearTimeout(this.connectTimer);
    this.timer=null;const socket=this.socket;this.socket=null;this.status.state='stopped';this.status.retryAt=null;
    try{socket?.close()}catch{}
  }
}

