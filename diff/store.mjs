import {DatabaseSync} from 'node:sqlite';
export const validMint = value => typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
const text = value => typeof value === 'string' ? value.slice(0,200) : null;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);this.db.exec('PRAGMA busy_timeout=5000');
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, mint TEXT NOT NULL, kind TEXT NOT NULL, received INTEGER NOT NULL, name TEXT, symbol TEXT, cap REAL, amount REAL, raw TEXT NOT NULL, UNIQUE(mint,kind));
      CREATE INDEX IF NOT EXISTS received_idx ON events(received);
      CREATE TABLE IF NOT EXISTS watches (mint TEXT PRIMARY KEY);
    `);
  }
  ingest(e, at=Date.now()) {
    if (!e || !validMint(e.mint) || !['create','migration'].includes(e.txType) || !Number.isFinite(at)) return false;
    const raw=JSON.stringify(e);
    if(raw.length>65536)return false;
    const result=this.db.prepare('INSERT OR IGNORE INTO events(mint,kind,received,name,symbol,cap,amount,raw) VALUES(?,?,?,?,?,?,?,?)').run(e.mint,e.txType,at,text(e.name),text(e.symbol),number(e.marketCapSol),number(e.solAmount),raw);
    return result.changes>0;
  }
  list({q='',kind='',watch=false,limit=200,offset=0}={}) {
    const pattern='%'+q.slice(0,200).replace(/[!%_]/g,'!$&')+'%';
    return this.db.prepare(`SELECT e.*, COALESCE(e.name,c.name) resolved_name, COALESCE(e.symbol,c.symbol) resolved_symbol,
      EXISTS(SELECT 1 FROM watches w WHERE w.mint=e.mint) watched
      FROM events e LEFT JOIN events c ON c.mint=e.mint AND c.kind='create'
      WHERE (?='' OR e.kind=?) AND (?=0 OR EXISTS(SELECT 1 FROM watches w WHERE w.mint=e.mint))
      AND (e.mint LIKE ? ESCAPE '!' OR COALESCE(e.name,c.name,'') LIKE ? ESCAPE '!' OR COALESCE(e.symbol,c.symbol,'') LIKE ? ESCAPE '!')
      ORDER BY e.received DESC,e.id DESC LIMIT ? OFFSET ?`).all(kind,kind,watch?1:0,pattern,pattern,pattern,Math.min(500,Math.max(1,limit)),Number.isSafeInteger(offset)&&offset>=0?offset:0).map(r=>({id:r.id,mint:r.mint,kind:r.kind,receivedAt:r.received,name:r.resolved_name,symbol:r.resolved_symbol,marketCapSol:r.cap,solAmount:r.amount,watched:!!r.watched,raw:JSON.parse(r.raw)}));
  }
  listPage({q='',kind='',watch=false,offset=0}={}) {
    const limit=200,pattern='%'+q.slice(0,200).replace(/[!%_]/g,'!$&')+'%';
    const total=this.db.prepare(`SELECT COUNT(*) n FROM events e LEFT JOIN events c ON c.mint=e.mint AND c.kind='create'
      WHERE (?='' OR e.kind=?) AND (?=0 OR EXISTS(SELECT 1 FROM watches w WHERE w.mint=e.mint))
      AND (e.mint LIKE ? ESCAPE '!' OR COALESCE(e.name,c.name,'') LIKE ? ESCAPE '!' OR COALESCE(e.symbol,c.symbol,'') LIKE ? ESCAPE '!')`).get(kind,kind,watch?1:0,pattern,pattern,pattern).n;
    offset=Number.isSafeInteger(offset)&&offset>=0?Math.floor(offset/limit)*limit:0;
    offset=Math.min(offset,Math.max(0,Math.ceil(total/limit)-1)*limit);
    const events=this.list({q,kind,watch,limit,offset});
    return {events,page:{limit,offset,total,from:events.length?offset+1:0,to:offset+events.length,hasPrevious:offset>0,hasNext:offset+events.length<total}};
  }
  stats(now=Date.now()) {
    const r=this.db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN kind='create' AND received>=? AND received<=? THEN 1 ELSE 0 END) hour, MAX(received) lastEventAt FROM events`).get(now-3600000,now);
    return {...r,hour:r.hour||0,watched:this.db.prepare('SELECT COUNT(*) n FROM watches').get().n};
  }
  setWatch(mint,enabled) {
    if(!validMint(mint))throw new Error('Invalid mint');
    if(!this.db.prepare('SELECT 1 FROM events WHERE mint=?').get(mint))throw new Error('Unknown mint');
    this.db.prepare(enabled?'INSERT OR IGNORE INTO watches(mint) VALUES(?)':'DELETE FROM watches WHERE mint=?').run(mint);
  }
  close(){this.db.close()}
}

