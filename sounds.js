// Sons do Telao: tons suaves de "marimba" sintetizados com WebAudio, com um pouco de reverb.
// Nada de arquivos de áudio: tudo é gerado na hora.
const Sound = (() => {
  let ctx = null, master = null, wet = null, loopTimer = null;
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('telao-sound')) || {}; } catch { return {}; } })();
  let enabled = prefs.enabled !== false;
  let volume = typeof prefs.volume === 'number' ? prefs.volume : 0.6;

  function save() { try { localStorage.setItem('telao-sound', JSON.stringify({ enabled, volume })); } catch {} }
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = volume * 0.5;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    const conv = ctx.createConvolver(); conv.buffer = impulse(1.8, 3.2);
    wet = ctx.createGain(); wet.gain.value = 0.22; wet.connect(conv); conv.connect(master);
  }
  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return buf;
  }
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  // Uma nota tipo marimba: senoide + harmônico agudo que some rápido.
  function note(midi, t, { dur = 0.6, vol = 0.3, bright = 0.12, type = 'sine' } = {}) {
    const f = hz(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(g);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(bright, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.12, dur));
    const o2 = ctx.createOscillator(); o2.frequency.value = f * 4; o2.connect(g2); g2.connect(g);
    g.connect(master); g.connect(wet);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  // [midi, atraso(s), opções]
  const P = {
    message:       [[81, 0, { dur: 0.35, vol: 0.16 }]],
    notify:        [[76, 0, { vol: 0.22 }], [83, 0.09, { vol: 0.22, dur: 0.8 }]],
    join:          [[67, 0], [71, 0.07], [74, 0.14, { dur: 0.9 }]],
    leave:         [[74, 0], [71, 0.07], [67, 0.14, { dur: 0.9 }]],
    userJoin:      [[79, 0, { vol: 0.2 }], [86, 0.08, { vol: 0.2 }]],
    userLeave:     [[86, 0, { vol: 0.2 }], [79, 0.08, { vol: 0.2 }]],
    mute:          [[64, 0, { dur: 0.16, vol: 0.34, type: 'triangle' }], [57, 0.08, { dur: 0.3, vol: 0.32, type: 'triangle' }]],
    unmute:        [[64, 0, { dur: 0.16, vol: 0.34, type: 'triangle' }], [71, 0.08, { dur: 0.3, vol: 0.32, type: 'triangle' }]],
    deafen:        [[67, 0, { dur: 0.14, vol: 0.3, type: 'triangle' }], [62, 0.07, { dur: 0.14, vol: 0.3, type: 'triangle' }], [55, 0.14, { dur: 0.34, vol: 0.3, type: 'triangle' }]],
    undeafen:      [[55, 0, { dur: 0.14, vol: 0.3, type: 'triangle' }], [62, 0.07, { dur: 0.14, vol: 0.3, type: 'triangle' }], [67, 0.14, { dur: 0.34, vol: 0.3, type: 'triangle' }]],
    streamStart:   [[72, 0, { vol: 0.3 }], [76, 0.06, { vol: 0.3 }], [79, 0.12, { vol: 0.3 }], [84, 0.18, { vol: 0.32, dur: 1 }]],
    streamStop:    [[84, 0, { vol: 0.3 }], [79, 0.07, { vol: 0.3 }], [72, 0.14, { vol: 0.3, dur: 0.9 }]],
    friendRequest: [[79, 0], [84, 0.1], [88, 0.2, { dur: 1 }]],
    friendAccepted:[[72, 0], [76, 0.08], [79, 0.16], [84, 0.24, { dur: 1.1 }]],
    invite:        [[76, 0], [81, 0.1], [85, 0.2, { dur: 1 }]],
    error:         [[64, 0, { vol: 0.22 }], [60, 0.1, { vol: 0.22 }]],
    click:         [[88, 0, { dur: 0.12, vol: 0.08 }]],
    watchJoin:     [[76, 0, { vol: 0.18, dur: 0.3 }], [83, 0.07, { vol: 0.18, dur: 0.6 }]],
    react:         [[84, 0, { dur: 0.15, vol: 0.12 }], [91, 0.05, { dur: 0.22, vol: 0.1 }]],
  };
  const LOOPS = {
    ring:     { every: 2.2, notes: [[76, 0], [79, 0.13], [84, 0.26], [79, 0.39, { dur: 0.8 }]] },
    ringback: { every: 2.6, notes: [[69, 0, { vol: 0.12 }], [72, 0.18, { vol: 0.12, dur: 0.8 }]] },
  };
  function playNotes(list) {
    const t0 = ctx.currentTime + 0.02;
    for (const [m, d, o] of list) note(m, t0 + d, { vol: 0.28, ...(o || {}) });
  }
  return {
    play(name) { if (!enabled || !P[name]) return; try { init(); playNotes(P[name]); } catch {} },
    loop(name) {
      this.stopLoop(); if (!enabled || !LOOPS[name]) return;
      try { init(); } catch { return; }
      const L = LOOPS[name]; playNotes(L.notes);
      loopTimer = setInterval(() => playNotes(L.notes), L.every * 1000);
    },
    stopLoop() { clearInterval(loopTimer); loopTimer = null; },
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; if (!enabled) this.stopLoop(); save(); },
    get volume() { return volume; },
    set volume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = volume * 0.5; save(); },
  };
})();
