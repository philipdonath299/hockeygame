export class SFX {
    constructor() {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { this.ctx = null; }
    }
    _beep(freq, dur, type = 'sine', gain = 0.3, when = 0) {
        if (!this.ctx) return;
        try {
            const g = this.ctx.createGain();
            const o = this.ctx.createOscillator();
            g.gain.setValueAtTime(gain, this.ctx.currentTime + when);
            g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + when + dur);
            o.frequency.setValueAtTime(freq, this.ctx.currentTime + when);
            o.type = type;
            o.connect(g); g.connect(this.ctx.destination);
            o.start(this.ctx.currentTime + when);
            o.stop(this.ctx.currentTime + when + dur);
        } catch (e) {}
    }
    _noise(dur, gain = 0.15) {
        if (!this.ctx) return;
        try {
            const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            const src = this.ctx.createBufferSource(); src.buffer = buf;
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(gain, this.ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
            src.connect(g); g.connect(this.ctx.destination); src.start();
        } catch (e) {}
    }
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
    hit(power = 1)   { this._noise(0.06 + power * 0.04, 0.22 + power * 0.12); this._beep(90 + power * 50, 0.1, 'square', 0.15 + power * 0.1); }
    wristShot()      { this._beep(320, 0.07, 'sawtooth', 0.2); this._noise(0.06, 0.12); }
    slapShot()       { this._noise(0.18, 0.3); this._beep(160, 0.18, 'sawtooth', 0.25); }
    pass()           { this._beep(500, 0.05, 'sine', 0.14); }
    save()           { this._beep(200, 0.2, 'square', 0.28); this._noise(0.12, 0.2); }
    tackle()         { this._noise(0.14, 0.35); this._beep(75, 0.12, 'square', 0.22); }
    pickup()         { this._beep(720, 0.04, 'sine', 0.08); }
    goal() {
        // Exciting goal horn sequence
        [523,659,784,1047,1319].forEach((f,i) => this._beep(f, 0.22, 'square', 0.35, i * 0.11));
        setTimeout(() => {
            [784,1047].forEach((f,i) => this._beep(f, 0.3, 'square', 0.25, i * 0.15));
        }, 700);
    }
    whistle()        { this._beep(2400, 0.25, 'sine', 0.28); this._beep(2100, 0.15, 'sine', 0.22, 0.28); }
    tick()           { this._beep(650, 0.03, 'square', 0.08); }
    charge(t)        { if (!this.ctx) return; this._beep(280 + t * 450, 0.04, 'sine', 0.05 + t * 0.07); }
    periodEnd()      { [523, 392, 330].forEach((f,i) => this._beep(f, 0.25, 'sine', 0.2, i*0.18)); }
    buttonPress()    { this._beep(880, 0.03, 'sine', 0.06); }
    skrape(intensity = 1) { 
        this._noise(0.04, 0.06 * intensity); 
        this._beep(250 + Math.random()*150, 0.04, 'sawtooth', 0.03 * intensity);
    }
    crowdCheer(dur = 2.0, intensity = 1) {
        this._noise(dur, 0.08 * intensity);
    }
}
