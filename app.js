(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const screens = $$('.screen');
  const canvas = $('#gameCanvas');
  const ctx = canvas.getContext('2d');

  const DIFFICULTIES = {
    easy:   { speed: .72, size: 1.2, spawn: 1.12, lives: 5, ammo: Infinity },
    normal: { speed: 1, size: 1, spawn: 1, lives: 3, ammo: Infinity },
    hard:   { speed: 1.28, size: .85, spawn: .78, lives: 3, ammo: Infinity },
    expert: { speed: 1.55, size: .76, spawn: .62, lives: 2, ammo: 35 }
  };
  const LEVELS = [
    { name: 'ТРЕНУВАННЯ', mission: 'ЗБИВАЙ ЧЕРВОНІ ЦІЛІ', time: 35, good: ['target', 'balloon'], badChance: 0, curve: 0 },
    { name: 'ШВИДКІ ПРЕДМЕТИ', mission: 'ВЛУЧАЙ У ШВИДКІ ЦІЛІ', time: 40, good: ['target', 'bottle', 'box', 'drone'], badChance: 0, curve: .35 },
    { name: 'БЕРЕЖИ ПОДАРУНКИ', mission: 'НЕ СТРІЛЯЙ У ДОБРІ ЦІЛІ', time: 42, good: ['target', 'bottle', 'box', 'drone'], badChance: .3, curve: .35 },
    { name: 'НІЧНИЙ РЕЖИМ', mission: 'ЗАЧИСТИ ТЕМНИЙ ПОРТАЛ', time: 45, good: ['target', 'drone', 'bottle'], badChance: .25, curve: .55, night: true },
    { name: 'БОС-ДРОН', mission: 'ЗНИЩ ГОЛОВНИЙ ДРОН', time: 55, good: ['drone'], badChance: .2, curve: .7, boss: true }
  ];
  const ICONS = {
    target: { emoji: '◎', color: '#ff4f34', points: 10 },
    balloon: { emoji: '●', color: '#ff3d58', points: 10 },
    bottle: { emoji: '▰', color: '#42d8ff', points: 10 },
    box: { emoji: '◆', color: '#ff9f22', points: 10 },
    drone: { emoji: '✦', color: '#96e8ff', points: 25 },
    gift: { emoji: '◆', color: '#ffca3d', points: -20, bad: true },
    heart: { emoji: '♥', color: '#ff5c82', points: -20, bad: true },
    star: { emoji: '★', color: '#ffd34f', points: -20, bad: true },
    freeze: { emoji: '❄', color: '#7de8ff', points: 0, bonus: 'freeze' },
    double: { emoji: '×2', color: '#ffca3d', points: 0, bonus: 'double' },
    shield: { emoji: '⬡', color: '#56f1a5', points: 0, bonus: 'shield' },
    wide: { emoji: '◉', color: '#fd76ff', points: 0, bonus: 'wide' }
  };

  const state = {
    screen: 'menuScreen', running: false, paused: false, level: 0, score: 0, lives: 3,
    time: 35, shots: 0, hits: 0, misses: 0, combo: 0, bestCombo: 0, ammo: Infinity,
    targets: [], particles: [], rings: [], lastFrame: 0, spawnTimer: 0, bossSpawned: false,
    aim: { x: innerWidth / 2, y: innerHeight / 2 }, slowUntil: 0, doubleUntil: 0,
    wideUntil: 0, shield: 0, difficulty: 'normal', effects: true, muted: false
  };

  const audio = {
    context: null, analyser: null, stream: null, data: null, active: false, threshold: .19,
    level: 0, lastLevel: 0, lastShotAt: 0, calibrating: false, samples: [], sensitivity: 1
  };
  const camera = {
    stream: null, active: false, tracking: false, found: false, directionFound: false, frameRequest: 0,
    workCanvas: document.createElement('canvas'), workCtx: null,
    point: { x: .5, y: .5 }, rawPoint: { x: .5, y: .5 }, confidence: 0,
    calibration: { minX: .12, maxX: .88, minY: .12, maxY: .88 },
    calibrationStep: 0, cornerA: null, manualUntil: 0
  };
  camera.workCanvas.width = 192;
  camera.workCanvas.height = 108;
  camera.workCtx = camera.workCanvas.getContext('2d', { willReadFrequently: true });

  function showScreen(id) {
    screens.forEach(s => s.classList.toggle('active', s.id === id));
    state.screen = id;
  }

  function openModal(id) {
    $$('.modal').forEach(m => m.classList.remove('active'));
    $('#' + id).classList.add('active');
    $('#modalBackdrop').classList.add('active');
  }

  function closeModal() {
    $('#modalBackdrop').classList.remove('active');
    $$('.modal').forEach(m => m.classList.remove('active'));
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.aim.x = Math.min(state.aim.x, innerWidth);
    state.aim.y = Math.min(state.aim.y, innerHeight);
    updateCrosshair();
  }

  function updateCrosshair() {
    $('#crosshair').style.left = state.aim.x + 'px';
    $('#crosshair').style.top = state.aim.y + 'px';
  }

  function updateCameraState() {
    const el = $('#cameraState');
    el.classList.toggle('active', camera.active && camera.directionFound && camera.tracking);
    el.classList.toggle('searching', camera.active && !camera.directionFound);
    el.querySelector('span').textContent = !camera.active
      ? 'МИША / ПАЛЕЦЬ'
      : camera.directionFound
        ? (camera.tracking ? 'КАМЕРА · НАВЕДЕННЯ' : 'КАМЕРА · ПАУЗА')
        : 'КАМЕРА · ШУКАЮ БЛАСТЕР';
  }

  function startGame(reset = true) {
    closeModal();
    if (reset) {
      state.level = 0;
      state.score = 0;
    }
    const diff = DIFFICULTIES[state.difficulty];
    const level = LEVELS[state.level];
    Object.assign(state, {
      running: true, paused: false, lives: diff.lives, time: level.time, shots: 0, hits: 0,
      misses: 0, combo: 0, bestCombo: 0, ammo: diff.ammo, targets: [], particles: [],
      rings: [], spawnTimer: .55, bossSpawned: false, slowUntil: 0, doubleUntil: 0,
      wideUntil: 0, shield: 0, lastFrame: performance.now()
    });
    showScreen('gameScreen');
    updateHUD();
    $('#gameHint').textContent = camera.active
      ? 'КАМЕРА РУХАЄ ПРИЦІЛ · ЗВУК БЛАСТЕРА — ПОСТРІЛ · SPACE — РЕЗЕРВ'
      : 'РУХАЙ ПРИЦІЛ МИШЕЮ · SPACE / КЛІК — ПОСТРІЛ';
    $('#gameHint').style.opacity = '1';
    updateCameraState();
    setTimeout(() => { if (state.running) $('#gameHint').style.opacity = '0'; }, 4500);
    requestAnimationFrame(loop);
  }

  function nextLevel() {
    state.level++;
    if (state.level >= LEVELS.length) {
      state.level = 0;
      state.score = 0;
    }
    startGame(false);
  }

  function updateHUD() {
    const level = LEVELS[state.level];
    $('#levelValue').textContent = `${state.level + 1} / 5`;
    $('#levelName').textContent = level.name;
    $('#missionText').textContent = level.mission;
    $('#timerValue').textContent = `00:${Math.max(0, Math.ceil(state.time)).toString().padStart(2, '0')}`;
    $('#scoreValue').textContent = Math.max(0, state.score).toString().padStart(6, '0');
    $('#livesValue').textContent = '♥ '.repeat(Math.max(0, state.lives)).trim();
    $('#combo span').textContent = multiplier();
    $('#combo').classList.toggle('active', state.combo >= 3);
  }

  function multiplier() {
    return Math.min(4, 1 + Math.floor(state.combo / 4));
  }

  function createTarget(forceBoss = false) {
    const level = LEVELS[state.level];
    const diff = DIFFICULTIES[state.difficulty];
    if (level.boss && !state.bossSpawned) {
      state.bossSpawned = true;
      const radius = 75 * diff.size;
      state.targets.push({
        type: 'drone', boss: true, good: true, x: innerWidth * .78, y: innerHeight * .42,
        vx: -105, vy: 85, radius, hp: 12, maxHp: 12, age: 0, wobble: 1
      });
      return;
    }
    const r = Math.random();
    let type;
    if (r < .08 && state.level > 0) type = ['freeze','double','shield','wide'][Math.floor(Math.random()*4)];
    else if (r < level.badChance + .08) type = ['gift','heart','star'][Math.floor(Math.random()*3)];
    else type = level.good[Math.floor(Math.random() * level.good.length)];

    const fromTop = Math.random() < .18 && state.level > 0;
    const dir = Math.random() < .5 ? 1 : -1;
    const baseRadius = type === 'drone' ? 36 : type === 'target' ? 34 : 30;
    const radius = baseRadius * diff.size * (.86 + Math.random() * .28);
    const speed = (110 + state.level * 23 + Math.random() * 75) * diff.speed;
    const target = {
      type, good: !ICONS[type].bad, bonus: ICONS[type].bonus, radius,
      x: fromTop ? 70 + Math.random() * (innerWidth - 140) : (dir > 0 ? -radius : innerWidth + radius),
      y: fromTop ? -radius : 125 + Math.random() * Math.max(120, innerHeight - 230),
      vx: fromTop ? (Math.random() - .5) * 65 : speed * dir,
      vy: fromTop ? speed : (Math.random() - .5) * 22,
      age: 0, wobble: level.curve * (30 + Math.random() * 45), hp: 1
    };
    state.targets.push(target);
  }

  function shoot(source = 'fallback') {
    if (!state.running || state.paused || state.screen !== 'gameScreen') return;
    if (state.ammo <= 0) {
      tone(95, .08, 'sawtooth', .06);
      return;
    }
    state.ammo--;
    state.shots++;
    const now = performance.now();
    const shotRadius = now < state.wideUntil ? 86 : 42;
    let hit = null;
    let bestDist = Infinity;
    state.targets.forEach(t => {
      const d = Math.hypot(t.x - state.aim.x, t.y - state.aim.y);
      if (d <= t.radius + shotRadius && d < bestDist) { hit = t; bestDist = d; }
    });
    $('#crosshair').classList.remove('fire');
    void $('#crosshair').offsetWidth;
    $('#crosshair').classList.add('fire');
    $('#flash').classList.remove('active');
    void $('#flash').offsetWidth;
    $('#flash').classList.add('active');
    state.rings.push({ x: state.aim.x, y: state.aim.y, radius: 8, alpha: 1 });
    tone(125, .08, 'square', .08);

    if (hit) {
      hitTarget(hit);
    } else {
      state.misses++;
      state.combo = 0;
      tone(75, .1, 'sine', .035);
    }
    updateHUD();
  }

  function hitTarget(target) {
    const icon = ICONS[target.type];
    if (target.boss) {
      target.hp--;
      state.hits++;
      state.combo++;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      state.score += 25 * multiplier() * (performance.now() < state.doubleUntil ? 2 : 1);
      burst(target.x, target.y, '#65ddff', 12);
      tone(260 + (12 - target.hp) * 18, .09, 'square', .06);
      if (target.hp <= 0) {
        burst(target.x, target.y, '#ff7b18', 60);
        state.targets = state.targets.filter(t => t !== target);
        state.score += 500;
        state.time = Math.min(state.time, 3);
      }
      return;
    }
    state.targets = state.targets.filter(t => t !== target);
    if (target.bonus) {
      applyBonus(target.bonus);
      burst(target.x, target.y, icon.color, 26);
      tone(620, .16, 'sine', .08);
      return;
    }
    if (!target.good) {
      state.score = Math.max(0, state.score - 20);
      state.combo = 0;
      if (state.shield) state.shield = 0;
      else state.lives--;
      burst(target.x, target.y, '#ff4667', 22);
      tone(90, .24, 'sawtooth', .08);
      if (state.lives <= 0) endLevel(false);
    } else {
      state.hits++;
      state.combo++;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      const double = performance.now() < state.doubleUntil ? 2 : 1;
      state.score += icon.points * multiplier() * double;
      burst(target.x, target.y, icon.color, 18);
      tone(360 + state.combo * 12, .08, 'triangle', .055);
    }
  }

  function applyBonus(type) {
    const now = performance.now();
    if (type === 'freeze') state.slowUntil = now + 3000;
    if (type === 'double') state.doubleUntil = now + 10000;
    if (type === 'wide') state.wideUntil = now + 8000;
    if (type === 'shield') state.shield = 1;
  }

  function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 230;
      state.particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, life: .35 + Math.random()*.5, max: .85, color, size: 2 + Math.random()*5 });
    }
  }

  function endLevel(success = true) {
    if (!state.running) return;
    state.running = false;
    const accuracy = state.shots ? Math.round(state.hits / state.shots * 100) : 0;
    const record = JSON.parse(localStorage.getItem('bsh-record') || '{"score":0,"combo":0,"level":1}');
    const isRecord = state.score > record.score;
    const nextRecord = {
      score: Math.max(record.score, state.score),
      combo: Math.max(record.combo, state.bestCombo),
      level: Math.max(record.level, Math.min(5, state.level + (success ? 2 : 1)))
    };
    localStorage.setItem('bsh-record', JSON.stringify(nextRecord));
    $('#resultTitle').textContent = success ? (state.level === 4 ? 'МАЙСТЕР БЛАСТЕРА!' : 'РІВЕНЬ ПРОЙДЕНО!') : 'ПОРТАЛ ПРОРВАВСЯ';
    $('#finalScore').textContent = state.score.toLocaleString('uk-UA');
    $('#newRecord').style.visibility = isRecord ? 'visible' : 'hidden';
    $('#statHits').textContent = state.hits;
    $('#statAccuracy').textContent = accuracy + '%';
    $('#statCombo').textContent = 'x' + state.bestCombo;
    $('#statMisses').textContent = state.misses;
    const starCount = !success ? 0 : accuracy >= 80 ? 3 : accuracy >= 55 ? 2 : 1;
    $('#stars').innerHTML = [0,1,2].map(i => `<span style="opacity:${i < starCount ? 1 : .16}">★</span>`).join(' ');
    $('#nextBtn span').textContent = state.level === 4 ? 'ГРАТИ ЗНОВУ' : success ? 'НАСТУПНИЙ РІВЕНЬ' : 'СПРОБУВАТИ ЩЕ';
    $('#nextBtn').onclick = success ? nextLevel : () => startGame(false);
    showScreen('resultScreen');
  }

  function loop(now) {
    if (!state.running || state.screen !== 'gameScreen') return;
    const dt = Math.min(.034, (now - state.lastFrame) / 1000 || 0);
    state.lastFrame = now;
    if (!state.paused) {
      state.time -= dt;
      updateWorld(dt, now);
      drawWorld(now);
      updateAudio();
      updateHUD();
      if (state.time <= 0) endLevel(!LEVELS[state.level].boss || !state.targets.some(t => t.boss));
    }
    requestAnimationFrame(loop);
  }

  function updateWorld(dt, now) {
    const level = LEVELS[state.level], diff = DIFFICULTIES[state.difficulty];
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0 && (!level.boss || state.targets.length < 7)) {
      createTarget();
      state.spawnTimer = (.7 + Math.random() * .75) * diff.spawn;
    }
    const slow = now < state.slowUntil ? .34 : 1;
    state.targets.forEach(t => {
      t.age += dt;
      t.x += t.vx * dt * slow;
      t.y += (t.vy + Math.sin(t.age * 3.3) * t.wobble) * dt * slow;
      if (t.boss) {
        if (t.x < t.radius || t.x > innerWidth - t.radius) t.vx *= -1;
        if (t.y < 130 || t.y > innerHeight - t.radius) t.vy *= -1;
        if (Math.random() < dt * .8) {
          const bad = ['gift','heart','star'][Math.floor(Math.random()*3)];
          state.targets.push({ type: bad, good: false, radius: 25, x: t.x, y: t.y, vx: (Math.random()-.5)*260, vy: 140+Math.random()*110, age: 0, wobble: 30, hp:1 });
        }
      }
    });
    state.targets = state.targets.filter(t => t.boss || (t.x > -180 && t.x < innerWidth+180 && t.y > -180 && t.y < innerHeight+180));
    state.particles.forEach(p => { p.life -= dt; p.x += p.vx*dt; p.y += p.vy*dt; p.vy += 300*dt; p.vx *= .985; });
    state.particles = state.particles.filter(p => p.life > 0);
    state.rings.forEach(r => { r.radius += dt*230; r.alpha -= dt*3; });
    state.rings = state.rings.filter(r => r.alpha > 0);
  }

  function drawWorld(now) {
    const level = LEVELS[state.level];
    const g = ctx.createLinearGradient(0,0,innerWidth,innerHeight);
    g.addColorStop(0, level.night ? '#010611' : '#071b35');
    g.addColorStop(.55, level.night ? '#05101c' : '#0b3358');
    g.addColorStop(1, '#061426');
    ctx.fillStyle = g; ctx.fillRect(0,0,innerWidth,innerHeight);
    drawArena(level, now);
    state.targets.forEach(drawTarget);
    state.particles.forEach(p => {
      ctx.globalAlpha = Math.max(0,p.life/p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);
    });
    state.rings.forEach(r => {
      ctx.globalAlpha = r.alpha; ctx.strokeStyle = '#ff9b32'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(r.x,r.y,r.radius,0,Math.PI*2); ctx.stroke();
    });
    ctx.globalAlpha = 1;
    if (level.night) {
      const mask = ctx.createRadialGradient(state.aim.x,state.aim.y,30,state.aim.x,state.aim.y,210);
      mask.addColorStop(0,'rgba(0,0,0,0)'); mask.addColorStop(1,'rgba(0,0,0,.82)');
      ctx.fillStyle = mask; ctx.fillRect(0,0,innerWidth,innerHeight);
    }
  }

  function drawArena(level, now) {
    ctx.save();
    ctx.strokeStyle = 'rgba(74,171,232,.095)'; ctx.lineWidth = 1;
    const grid = 72;
    for (let x = ((now*.012)%grid)-grid; x < innerWidth+grid; x+=grid) {
      ctx.beginPath(); ctx.moveTo(x,90); ctx.lineTo(x-190,innerHeight); ctx.stroke();
    }
    for (let y = 120; y < innerHeight; y+=grid) {
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(innerWidth,y); ctx.stroke();
    }
    ctx.translate(innerWidth/2,innerHeight/2);
    for (let i=0;i<4;i++) {
      ctx.strokeStyle = i%2 ? 'rgba(255,104,24,.12)' : 'rgba(41,185,255,.12)';
      ctx.lineWidth = 2; ctx.setLineDash([10+i*5,12]);
      ctx.beginPath(); ctx.ellipse(0,0,175+i*70,175+i*70,now*.00008*(i%2?1:-1),0,Math.PI*2); ctx.stroke();
    }
    ctx.restore(); ctx.setLineDash([]);
  }

  function drawTarget(t) {
    const icon = ICONS[t.type];
    ctx.save(); ctx.translate(t.x,t.y);
    const pulse = 1 + Math.sin(t.age*6)*.035;
    ctx.scale(pulse,pulse);
    ctx.shadowBlur = 24; ctx.shadowColor = icon.color;
    ctx.fillStyle = 'rgba(4,18,38,.82)';
    ctx.strokeStyle = icon.color; ctx.lineWidth = t.boss ? 5 : 3;
    ctx.beginPath(); ctx.arc(0,0,t.radius,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = icon.color + '77'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0,0,t.radius*.76,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle = icon.color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${t.boss ? t.radius*.75 : t.radius*.95}px Russo One, sans-serif`;
    if (t.type === 'bottle') {
      ctx.rotate(.2); ctx.fillRect(-t.radius*.24,-t.radius*.48,t.radius*.48,t.radius*.96);
    } else if (t.type === 'gift') {
      ctx.fillRect(-t.radius*.42,-t.radius*.34,t.radius*.84,t.radius*.68);
      ctx.fillStyle = '#fff2a3'; ctx.fillRect(-t.radius*.08,-t.radius*.43,t.radius*.16,t.radius*.86);
    } else {
      ctx.fillText(icon.emoji,0,t.type === 'balloon' ? -3 : 1);
    }
    if (t.boss) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(-t.radius,-t.radius-19,t.radius*2,8);
      ctx.fillStyle = '#ff6b18'; ctx.fillRect(-t.radius,-t.radius-19,t.radius*2*(t.hp/t.maxHp),8);
      ctx.fillStyle = '#fff'; ctx.font = '9px Inter'; ctx.fillText(`ДРОН · ${t.hp}/${t.maxHp}`,0,-t.radius-28);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '700 7px Inter';
      ctx.fillText(icon.bonus ? 'БОНУС' : t.good ? `+${icon.points}` : 'НЕ СТРІЛЯЙ',0,t.radius+13);
    }
    ctx.restore();
  }

  function tone(freq, duration, type = 'sine', volume = .04) {
    if (!state.effects || state.muted) return;
    try {
      const ac = audio.context || new (window.AudioContext || window.webkitAudioContext)();
      if (!audio.context) audio.context = ac;
      const osc = ac.createOscillator(), gain = ac.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(35,freq*.55), ac.currentTime+duration);
      gain.gain.setValueAtTime(volume, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+duration);
      osc.connect(gain).connect(ac.destination); osc.start(); osc.stop(ac.currentTime+duration);
    } catch {}
  }

  async function enableMicrophone() {
    const button = $('#enableMicBtn');
    button.querySelector('span').textContent = 'ОЧІКУЮ ДОЗВОЛУ…';
    try {
      audio.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      audio.context = audio.context || new (window.AudioContext || window.webkitAudioContext)();
      await audio.context.resume();
      const source = audio.context.createMediaStreamSource(audio.stream);
      audio.analyser = audio.context.createAnalyser();
      audio.analyser.fftSize = 1024;
      audio.analyser.smoothingTimeConstant = .08;
      audio.data = new Uint8Array(audio.analyser.fftSize);
      source.connect(audio.analyser);
      audio.active = true;
      audio.calibrating = true;
      audio.samples = [];
      button.querySelector('span').textContent = 'ЗРОБИ 3 ПОСТРІЛИ';
      button.disabled = true;
      $('#calibrationText').textContent = 'Готово! Тримай бластер на звичній відстані та зроби три окремі постріли.';
      calibrationLoop();
    } catch (err) {
      button.querySelector('span').textContent = 'СПРОБУВАТИ ЗНОВУ';
      $('#calibrationText').textContent = 'Не вдалося отримати доступ. Перевір дозвіл браузера або грай через Space і клік.';
      button.disabled = false;
      $('#micState').textContent = 'SPACE / КЛІК';
    }
  }

  function readMicLevel() {
    if (!audio.active || !audio.analyser) return 0;
    audio.analyser.getByteTimeDomainData(audio.data);
    let sum = 0, peak = 0;
    for (let i=0;i<audio.data.length;i++) {
      const v = Math.abs((audio.data[i]-128)/128);
      sum += v*v; peak = Math.max(peak,v);
    }
    return Math.min(1, Math.sqrt(sum/audio.data.length)*2.4 + peak*.36);
  }

  function calibrationLoop() {
    if (!audio.calibrating) return;
    const now = performance.now();
    const level = readMicLevel();
    audio.level = level;
    $('#calibrationLevel').style.width = `${Math.min(100,level*100)}%`;
    const transient = level > Math.max(.12, audio.lastLevel*1.65) && now-audio.lastShotAt > 420;
    if (transient) {
      audio.lastShotAt = now;
      audio.samples.push(level);
      $$('#calibrationShots i')[audio.samples.length-1]?.classList.add('done');
      tone(500+audio.samples.length*120,.09,'triangle',.05);
      if (audio.samples.length >= 3) {
        audio.threshold = Math.max(.11, audio.samples.sort((a,b)=>a-b)[1] * .58);
        audio.calibrating = false;
        $('#calibrationThreshold').style.left = `${Math.min(96,audio.threshold*100)}%`;
        $('#calibrationText').textContent = 'Калібрування завершено. Бластер підключено до порталу!';
        $('#enableMicBtn span').textContent = 'ГОТОВО — ПОЧАТИ ГРУ';
        $('#enableMicBtn b').textContent = '✓';
        $('#enableMicBtn').disabled = false;
        $('#enableMicBtn').onclick = () => startGame(true);
        $('#micState').textContent = 'МІКРОФОН ✓';
        return;
      }
    }
    audio.lastLevel = level*.75 + audio.lastLevel*.25;
    requestAnimationFrame(calibrationLoop);
  }

  function updateAudio() {
    if (!audio.active || audio.calibrating) {
      $('#micLevel').style.width = '0%';
      return;
    }
    const now = performance.now(), level = readMicLevel();
    const threshold = audio.threshold * audio.sensitivity;
    const transient = level > threshold && level > audio.lastLevel*1.25 && now-audio.lastShotAt > 280;
    audio.level = level;
    $('#micLevel').style.width = `${Math.min(100,level*100)}%`;
    $('#micThreshold').style.left = `${Math.min(96,threshold*100)}%`;
    if (transient) { audio.lastShotAt = now; shoot('microphone'); }
    audio.lastLevel = level*.7 + audio.lastLevel*.3;
  }

  function openCameraModal() {
    camera.calibrationStep = 0;
    camera.cornerA = null;
    $('#captureCameraBtn').onclick = captureCameraCalibration;
    $('#captureCameraBtn').textContent = 'ЗАФІКСУВАТИ: ВЕРХНІЙ ЛІВИЙ КУТ';
    $('#captureCameraBtn').disabled = !camera.active || !camera.directionFound;
    $('#enableCameraBtn span').textContent = camera.active ? 'КАМЕРА УВІМКНЕНА' : 'УВІМКНУТИ КАМЕРУ';
    $('#enableCameraBtn b').textContent = camera.active ? '✓' : '◆';
    $('#cameraText').textContent = camera.active
      ? 'Наведи бластер у верхній лівий кут і зафіксуй позицію. Потім повтори для нижнього правого кута.'
      : 'Камера знайде помаранчеве дуло й синій корпус, визначить напрямок між ними та переведе його у рух прицілу.';
    openModal('cameraModal');
  }

  async function enableCamera() {
    const button = $('#enableCameraBtn');
    if (camera.active) {
      camera.tracking = true;
      $('#cameraToggle').checked = true;
      updateCameraState();
      return;
    }
    button.querySelector('span').textContent = 'ОЧІКУЮ ДОЗВОЛУ…';
    try {
      camera.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      const video = $('#cameraVideo');
      video.srcObject = camera.stream;
      await video.play();
      camera.active = true;
      camera.tracking = true;
      $('#cameraToggle').checked = true;
      $('#cameraPlaceholder').classList.add('hidden');
      button.querySelector('span').textContent = 'КАМЕРА УВІМКНЕНА';
      button.querySelector('b').textContent = '✓';
      $('#cameraText').textContent = 'Покажи камері помаранчеве дуло й синій корпус. Коли напрямок буде знайдено, наведи бластер у верхній лівий кут.';
      updateCameraState();
      cancelAnimationFrame(camera.frameRequest);
      cameraLoop();
    } catch (err) {
      button.querySelector('span').textContent = 'СПРОБУВАТИ ЗНОВУ';
      $('#cameraText').textContent = 'Не вдалося отримати доступ до камери. Перевір дозвіл браузера — миша й палець усе одно працюватимуть.';
      camera.active = false;
      camera.tracking = false;
      $('#cameraToggle').checked = false;
      updateCameraState();
    }
  }

  function cameraLoop() {
    if (!camera.active) return;
    const video = $('#cameraVideo');
    if (video.readyState >= 2) detectOrangeMuzzle(video);
    camera.frameRequest = requestAnimationFrame(cameraLoop);
  }

  function detectOrangeMuzzle(video) {
    const w = camera.workCanvas.width, h = camera.workCanvas.height;
    camera.workCtx.drawImage(video, 0, 0, w, h);
    const frame = camera.workCtx.getImageData(0, 0, w, h);
    const data = frame.data;
    let count = 0, sumX = 0, sumY = 0, blueCount = 0, blueX = 0, blueY = 0;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const orange = r > 145 && g > 35 && g < 205 && b < 145 && r > g * 1.16 && g > b * .92 && (r - b) > 70;
        const blue = b > 75 && b > r * 1.14 && b > g * 1.04 && (b - r) > 24;
        if (orange) {
          count++; sumX += x; sumY += y;
        } else if (blue) {
          blueCount++; blueX += x; blueY += y;
        }
      }
    }
    camera.found = count > 18;
    camera.directionFound = camera.found && blueCount > 26;
    camera.confidence = Math.min(1, Math.min(count / 180, blueCount / 420));
    const reticle = $('#trackingReticle');
    const label = $('.preview-label');
    label.classList.toggle('found', camera.found);
    $('#trackingLabel').textContent = camera.directionFound
      ? `НАПРЯМОК ЗНАЙДЕНО · ${Math.round(camera.confidence * 100)}%`
      : camera.found ? 'ДУЛО Є · ШУКАЮ СИНІЙ КОРПУС' : 'ШУКАЮ БЛАСТЕР';
    reticle.classList.toggle('found', camera.found);
    $('#captureCameraBtn').disabled = !camera.directionFound;
    if (camera.found) {
      const tipX = 1 - (sumX / count / w);
      const tipY = sumY / count / h;
      let detectedX = tipX, detectedY = tipY;
      if (camera.directionFound) {
        const bodyX = 1 - (blueX / blueCount / w);
        const bodyY = blueY / blueCount / h;
        const dx = tipX - bodyX, dy = tipY - bodyY;
        const length = Math.hypot(dx, dy);
        if (length > .035) {
          detectedX = Math.max(0, Math.min(1, tipX + dx / length * .14));
          detectedY = Math.max(0, Math.min(1, tipY + dy / length * .14));
        }
      }
      camera.rawPoint.x = detectedX;
      camera.rawPoint.y = detectedY;
      camera.point.x += (detectedX - camera.point.x) * .26;
      camera.point.y += (detectedY - camera.point.y) * .26;
      reticle.style.left = `${camera.point.x * 100}%`;
      reticle.style.top = `${camera.point.y * 100}%`;
      if (camera.directionFound && camera.tracking && performance.now() > camera.manualUntil && state.screen === 'gameScreen') {
        const c = camera.calibration;
        const nx = Math.max(0, Math.min(1, (camera.point.x - c.minX) / Math.max(.08, c.maxX - c.minX)));
        const ny = Math.max(0, Math.min(1, (camera.point.y - c.minY) / Math.max(.08, c.maxY - c.minY)));
        state.aim.x += (nx * innerWidth - state.aim.x) * .38;
        state.aim.y += (ny * innerHeight - state.aim.y) * .38;
        updateCrosshair();
      }
    }
    updateCameraState();
  }

  function captureCameraCalibration() {
    if (!camera.directionFound) return;
    if (camera.calibrationStep === 0) {
      camera.cornerA = { ...camera.point };
      camera.calibrationStep = 1;
      $('#captureCameraBtn').textContent = 'ЗАФІКСУВАТИ: НИЖНІЙ ПРАВИЙ КУТ';
      $('#cameraText').textContent = 'Чудово. Тепер наведи бластер у нижній правий кут екрана й зафіксуй другу позицію.';
      tone(540, .1, 'triangle', .05);
      return;
    }
    const a = camera.cornerA, b = camera.point;
    const rangeX = Math.abs(b.x - a.x), rangeY = Math.abs(b.y - a.y);
    if (rangeX < .08 || rangeY < .08) {
      $('#cameraText').textContent = 'Позиції надто близькі. Розведи бластер далі: спочатку верхній лівий, потім нижній правий кут.';
      camera.calibrationStep = 0;
      camera.cornerA = null;
      $('#captureCameraBtn').textContent = 'ЗАФІКСУВАТИ: ВЕРХНІЙ ЛІВИЙ КУТ';
      return;
    }
    camera.calibration = {
      minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
      minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y)
    };
    camera.tracking = true;
    $('#cameraToggle').checked = true;
    $('#cameraText').textContent = 'Калібрування завершено. Камера керує прицілом, а мікрофон окремо спрацьовує на звук пострілу.';
    $('#captureCameraBtn').textContent = 'ГОТОВО — ЗАКРИТИ';
    $('#captureCameraBtn').onclick = () => {
      closeModal();
      $('#captureCameraBtn').onclick = captureCameraCalibration;
    };
    tone(740, .18, 'sine', .07);
    updateCameraState();
  }

  function showRecords() {
    const r = JSON.parse(localStorage.getItem('bsh-record') || '{"score":0,"combo":0,"level":1}');
    $('#recordScore').textContent = r.score.toLocaleString('uk-UA');
    $('#recordCombo').textContent = 'x' + r.combo;
    $('#recordLevel').textContent = r.level + ' / 5';
    openModal('recordsModal');
  }

  $('#startBtn').addEventListener('click', () => {
    state.difficulty = $('#difficultySelect').value;
    startGame(true);
  });
  $('#calibrateBtn').addEventListener('click', () => {
    audio.calibrating = false; audio.samples = [];
    $$('#calibrationShots i').forEach(i => i.classList.remove('done'));
    $('#enableMicBtn').disabled = false;
    $('#enableMicBtn span').textContent = audio.active ? 'ПОЧАТИ КАЛІБРУВАННЯ' : 'УВІМКНУТИ МІКРОФОН';
    $('#enableMicBtn').onclick = enableMicrophone;
    openModal('calibrationModal');
  });
  $('#enableMicBtn').onclick = enableMicrophone;
  $('#cameraBtn').addEventListener('click', openCameraModal);
  $('#enableCameraBtn').addEventListener('click', enableCamera);
  $('#captureCameraBtn').onclick = captureCameraCalibration;
  $('#settingsBtn').addEventListener('click', () => openModal('settingsModal'));
  $('#settingsCalibrate').addEventListener('click', () => { closeModal(); $('#calibrateBtn').click(); });
  $('#settingsCamera').addEventListener('click', () => { closeModal(); openCameraModal(); });
  $('#recordsBtn').addEventListener('click', showRecords);
  $$('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));
  $('#modalBackdrop').addEventListener('click', e => { if (e.target === e.currentTarget && !state.paused) closeModal(); });
  $('#menuBtn').addEventListener('click', () => showScreen('menuScreen'));
  $('#pauseBtn').addEventListener('click', () => { state.paused = true; openModal('pauseModal'); });
  $('#resumeBtn').addEventListener('click', () => { closeModal(); state.paused = false; state.lastFrame = performance.now(); });
  $('#quitBtn').addEventListener('click', () => { state.running = false; state.paused = false; closeModal(); showScreen('menuScreen'); });
  $('#soundToggle').addEventListener('click', e => {
    state.muted = !state.muted;
    e.currentTarget.textContent = state.muted ? '×' : '♪';
    e.currentTarget.setAttribute('aria-label', state.muted ? 'Увімкнути звук' : 'Вимкнути звук');
  });
  $('#effectsToggle').addEventListener('change', e => state.effects = e.target.checked);
  $('#sensitivityRange').addEventListener('input', e => audio.sensitivity = Number(e.target.value));
  $('#cameraToggle').addEventListener('change', e => {
    if (e.target.checked && !camera.active) {
      e.target.checked = false;
      closeModal();
      openCameraModal();
      return;
    }
    camera.tracking = e.target.checked;
    updateCameraState();
  });

  canvas.addEventListener('pointermove', e => {
    camera.manualUntil = performance.now() + 1600;
    state.aim.x = e.clientX; state.aim.y = e.clientY; updateCrosshair();
  });
  canvas.addEventListener('pointerdown', e => {
    camera.manualUntil = performance.now() + 1600;
    state.aim.x = e.clientX; state.aim.y = e.clientY; updateCrosshair(); shoot('pointer');
  });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); shoot('keyboard'); }
    if (e.code === 'Escape' && state.running) {
      if (state.paused) $('#resumeBtn').click(); else $('#pauseBtn').click();
    }
  });
  window.addEventListener('resize', resize);
  resize();
})();
