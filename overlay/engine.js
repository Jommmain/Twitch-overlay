// Pure trigger engine: no network, DOM or credentials; covered by node:test.
export class TriggerEngine {
  constructor(config, emit = () => {}) {
    this.c = config; this.emit = emit; this.reset('standalone');
  }
  reset(streamId) {
    this.streamId = streamId; this.live = false; this.viewers = 0; this.maxStep = 0;
    this.lastViewerStep = 0; this.uptimeStep = 0; this.startedAt = null;
    this.initialized = false; this.users = new Map(); this.clock = 0;
  }
  event(kind, value, extra = {}) {
    this.emit({kind, value, streamId:this.streamId, at:this.clock, ...extra});
  }
  setStream({id, live, viewers = 0, startedAt = null}, now) {
    this.clock = now;
    if (id && id !== this.streamId) this.reset(id);
    this.clock = now;
    if (!live) { this.tick(now); this.live = false; this.disconnect(now); return; }
    this.live = true;
    if (Number.isFinite(startedAt)) this.startedAt = startedAt;
    const n = Math.max(0, Math.floor(Number(viewers) || 0));
    const step = Math.floor(n / Math.max(1, this.c.viewerStep));
    if (!this.initialized) {
      if (!this.c.fireExistingMilestones) {
        this.maxStep = Math.max(this.maxStep,step);
        this.uptimeStep = Math.max(this.uptimeStep,this.startedAt === null ? 0 : Math.floor(Math.max(0,now-this.startedAt)/(this.c.uptimeMinutes*60)));
      }
      this.initialized = true;
    }
    const previous = this.maxStep;
    // Bound work during pathological API jumps; queue owns overflow coalescing.
    const first = Math.max(previous+1, step-199);
    for (let k=first;k<=step;k++) this.event('viewers',k*this.c.viewerStep);
    this.maxStep = Math.max(this.maxStep,step); this.lastViewerStep = step; this.viewers = n;
    this.tick(now);
  }
  presence(login, action, now) {
    if (!this.live || !/^[a-zA-Z0-9_]{1,32}$/.test(login)) return;
    this.tick(now);
    login = login.toLowerCase();
    let u = this.users.get(login);
    if (!u && action !== 'part') {
      if (this.users.size >= this.c.maxPresenceUsers) return;
      u = {login,seconds:0,milestone:0,active:false,last:now,seen:now};this.users.set(login,u);
    }
    if (!u) return;
    u.active = action !== 'part';u.last=now;u.seen=now;
  }
  disconnect(now) { this.tick(now);for (const u of this.users.values()) u.active=false; }
  tick(now) {
    this.clock = now;
    if (!this.live) return;
    const mode=this.c.timeMode;
    const period=Math.max(1,this.c.uptimeMinutes*60);
    if ((mode==='both'||mode==='uptime') && this.startedAt!==null) {
      const step=Math.floor(Math.max(0,now-this.startedAt)/period);
      for(let k=Math.max(this.uptimeStep+1,step-99);k<=step;k++) this.event('uptime',k*period);
      this.uptimeStep=Math.max(this.uptimeStep,step);
    }
    const watchPeriod=Math.max(1,this.c.watchMinutes*60);
    for(const u of this.users.values()) {
      if(u.active) {
        const end=Math.min(now,u.seen+this.c.presenceTtlSeconds);
        u.seconds+=Math.max(0,end-u.last);u.last=now;
        if(now>u.seen+this.c.presenceTtlSeconds)u.active=false;
      }
      const step=Math.floor(u.seconds/watchPeriod);
      if(mode==='both'||mode==='watch') {
        for(let k=u.milestone+1;k<=step;k++)this.event('watch',k*watchPeriod,{login:u.login,estimated:true});
      }
      u.milestone=Math.max(u.milestone,step);
    }
  }
  snapshot() { return {streamId:this.streamId,maxStep:this.maxStep,uptimeStep:this.uptimeStep}; }
  restore(s) {
    if(s && s.streamId===this.streamId){this.maxStep=Math.max(this.maxStep,Number(s.maxStep)||0);this.uptimeStep=Math.max(this.uptimeStep,Number(s.uptimeStep)||0);}
  }
}

export class EventQueue {
  constructor(c) {this.c=c;this.pending=[];this.seen=new Set();this.history=[];this.lastStart=-Infinity;this.activeUntil=-Infinity;this.serial=0;}
  push(event, now) {
    const key=event.kind==='manual'?`manual:${this.serial++}`:`${event.streamId}:${event.kind}:${event.login||''}:${event.value}`;
    if(this.seen.has(key))return false;
    this.seen.add(key);if(this.seen.size>20000)this.seen.delete(this.seen.values().next().value);
    const item={...event,queuedAt:now,key};
    if(this.pending.length>=this.c.maxQueuedEvents) {
      // Bound overload without silently losing the reason: merge into last run.
      const tail=this.pending.at(-1);tail.merged=(tail.merged||0)+1;tail.latestReason=item;
    } else this.pending.push(item);
    return true;
  }
  take(now) {
    if(now<this.activeUntil || now-this.lastStart<this.c.cooldownSeconds)return null;
    this.pending=this.pending.filter(e=>now-e.queuedAt<=this.c.queueMaxAgeSeconds);
    const e=this.pending.shift();if(!e)return null;
    this.lastStart=now;this.activeUntil=now+this.c.runSeconds+this.c.crowdSize*this.c.staggerSeconds;
    this.history.push(e);if(this.history.length>100)this.history.shift();return e;
  }
  clear() {this.pending.length=0;}
}

// Direction math is shared by animation and tests. Positive X means left-to-right.
export function resolveRunDirection(mode = 'alternate', lastDirection = null, roll = .5, forced = null) {
  if (forced === 'ltr') return 1;
  if (forced === 'rtl') return -1;
  if (mode === 'ltr' || mode === 'left-to-right') return 1;
  if (mode === 'rtl' || mode === 'right-to-left') return -1;
  if (mode === 'random') return roll < .5 ? 1 : -1;
  return lastDirection === 1 ? -1 : 1;
}
export function runPosition(progress, direction, width = 1920, margin = 220) {
  const t = Math.max(0, Math.min(1, progress));
  const ltr = -margin + t * (width + 2 * margin);
  return direction > 0 ? ltr : width - ltr;
}
export function dustTrail(direction, speed) {
  const sign = direction > 0 ? 1 : -1;
  return {offsetX:-sign*30, vx:-sign*Math.abs(speed)};
}
export function scatterTarget(direction, width = 1920) {
  return direction > 0 ? width + 100 : -100;
}
