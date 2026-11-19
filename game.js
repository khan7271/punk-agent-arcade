"use strict";
/* =====================================================================
   NEON PUNK RUNNER — a punk arcade runner. No dependencies, no wallet
   needed to play. Emits window event "punkgameover" { score } on death.
   ===================================================================== */
(function () {
  var canvas = document.getElementById("gameCanvas");
  var ctx = canvas.getContext("2d");
  var W = canvas.width;   // 880
  var H = canvas.height;  // 360
  var GROUND_Y = 308;

  var scoreHud = document.getElementById("scoreHud");
  var boltsHud = document.getElementById("boltsHud");
  var bestHud = document.getElementById("bestHud");
  var speedHud = document.getElementById("speedHud");
  var levelHud = document.getElementById("levelHud");
  var levelLineEl = document.getElementById("levelLine");
  var levelBannerEl = document.getElementById("levelBanner");
  var taskToastEl = document.getElementById("taskToast");
  var readyOverlay = document.getElementById("readyOverlay");
  var overOverlay = document.getElementById("gameOverOverlay");
  var finalScoreEl = document.getElementById("finalScore");
  var bestLineEl = document.getElementById("bestLine");

  // ---- state ---------------------------------------------------------
  var state = "ready"; // ready | playing | over
  var frame = 0;
  var distance = 0;
  var bolts = 0;
  var speed = 5.5;
  var spawnIn = 60;
  var overAtFrame = -1000;
  var runPhase = 0;

  var player = { x: 90, y: GROUND_Y - 54, w: 46, h: 54, vy: 0, jumps: 0, onGround: true };
  var obstacles = [];
  var pickups = [];
  var particles = [];

  var BEST_KEY = "punk-agent-arcade-best";
  var best = 0;
  try { best = parseInt(window.localStorage.getItem(BEST_KEY) || "0", 10) || 0; } catch (e) { best = 0; }

  // ---- levels ----------------------------------------------------------
  // Level up every 250 points OR every ~20 seconds survived — whichever
  // comes first. Each level raises speed + obstacle density and can add a
  // new obstacle type. Level-ups pay +100 bonus points.
  var LEVEL_POINTS = 250;
  var LEVEL_SECONDS = 20;
  var LEVEL_BONUS = 100;
  var level = 1;
  var bonusPoints = 0; // level-up + task bonuses — part of the score
  var dodgedThisRun = 0;
  var djumpsThisRun = 0;
  var runTasks = {}; // task id -> true once completed this run
  var levelBannerTimer = null;
  var toastTimer = null;

  var BEST_LEVEL_KEY = "punk-agent-arcade-best-level";
  var bestLevel = 1;
  try { bestLevel = parseInt(window.localStorage.getItem(BEST_LEVEL_KEY) || "1", 10) || 1; } catch (e) { bestLevel = 1; }

  // ---- hard tasks (missions) -------------------------------------------
  // Completing a task mid-run pays +200 bonus points and a banner.
  // Completed tasks persist in localStorage and show with a checkmark.
  var TASKS_KEY = "punk-agent-arcade-tasks";
  var TASK_BONUS = 200;
  var TASKS = [
    { id: "bolts10",   title: "Bolt Hoarder", desc: "Collect 10 bolts in one run",              check: function () { return bolts >= 10; } },
    { id: "survive60", title: "Survivor",     desc: "Survive 60 seconds in one run",            check: function () { return frame / 60 >= 60; } },
    { id: "score500",  title: "High Roller",  desc: "Score 500 in a single run",                check: function () { return getScore() >= 500; } },
    { id: "dodge15",   title: "Untouchable",  desc: "Dodge 15 obstacles in a row without a hit", check: function () { return dodgedThisRun >= 15; } },
    { id: "djump5",    title: "Air Show",     desc: "Double-jump 5 times in one run",           check: function () { return djumpsThisRun >= 5; } }
  ];
  var tasksDone = {}; // id -> true, persisted across runs
  try {
    JSON.parse(window.localStorage.getItem(TASKS_KEY) || "[]").forEach(function (id) { tasksDone[id] = true; });
  } catch (e) { /* ignore */ }
  function saveTasksDone() {
    try { window.localStorage.setItem(TASKS_KEY, JSON.stringify(Object.keys(tasksDone))); } catch (e) { /* ignore */ }
  }

  // ---- haptics (Telegram Mini App, no-op on desktop) --------------------
  function haptic(kind) {
    try {
      var tg = window.Telegram && window.Telegram.WebApp;
      if (tg && tg.HapticFeedback) {
        if (kind === "heavy") tg.HapticFeedback.impactOccurred("heavy");
        else if (kind === "medium") tg.HapticFeedback.impactOccurred("medium");
        else if (kind === "success") tg.HapticFeedback.notificationOccurred("success");
        else tg.HapticFeedback.impactOccurred("light");
      }
    } catch (e) { /* haptics are optional */ }
  }

  // ---- scenery (precomputed so it doesn't flicker) -------------------
  var stars = [];
  for (var i = 0; i < 60; i++) {
    stars.push({ x: Math.random() * W, y: Math.random() * 190, r: Math.random() * 1.6 + 0.6 });
  }
  var buildings = [];
  var bx = 0;
  while (bx < W + 80) {
    var bw = 40 + Math.random() * 60;
    buildings.push({ x: bx, w: bw, h: 60 + Math.random() * 120 });
    bx += bw + 6;
  }

  // ---- audio (tiny WebAudio blips, guarded) --------------------------
  var audioCtx = null;
  function beep(freq, dur, type) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type || "square";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.06, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* sound is optional */ }
  }

  // ---- helpers --------------------------------------------------------
  function getScore() { return Math.floor(distance / 10) + bolts * 50 + bonusPoints; }
  function saveBest(s) {
    if (s > best) {
      best = s;
      try { window.localStorage.setItem(BEST_KEY, String(s)); } catch (e) { /* ignore */ }
    }
  }
  function saveBestLevel(l) {
    if (l > bestLevel) {
      bestLevel = l;
      try { window.localStorage.setItem(BEST_LEVEL_KEY, String(l)); } catch (e) { /* ignore */ }
    }
  }
  function showLevelBanner(text) {
    if (!levelBannerEl) return;
    levelBannerEl.textContent = text;
    levelBannerEl.classList.remove("hidden");
    levelBannerEl.classList.remove("flash");
    void levelBannerEl.offsetWidth; // restart the animation
    levelBannerEl.classList.add("flash");
    if (levelBannerTimer) clearTimeout(levelBannerTimer);
    levelBannerTimer = setTimeout(function () { levelBannerEl.classList.add("hidden"); }, 1700);
  }
  function showTaskToast(text) {
    if (!taskToastEl) return;
    taskToastEl.textContent = text;
    taskToastEl.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { taskToastEl.classList.add("hidden"); }, 2600);
  }
  function levelUp() {
    level++;
    bonusPoints += LEVEL_BONUS;
    saveBestLevel(level);
    beep(660, 0.1, "square");
    setTimeout(function () { beep(880, 0.12, "square"); }, 110);
    haptic("medium");
    showLevelBanner("⚡ LEVEL " + level + " UP! +" + LEVEL_BONUS + " PTS");
    updateHud();
  }
  function checkLevelUp() {
    var fromScore = Math.floor(getScore() / LEVEL_POINTS) + 1;
    var fromTime = Math.floor((frame / 60) / LEVEL_SECONDS) + 1;
    var target = Math.max(fromScore, fromTime, level);
    while (level < target) levelUp();
  }
  function checkTasks() {
    for (var i = 0; i < TASKS.length; i++) {
      var t = TASKS[i];
      if (runTasks[t.id]) continue;
      var done = false;
      try { done = t.check(); } catch (e) { done = false; }
      if (!done) continue;
      runTasks[t.id] = true;
      bonusPoints += TASK_BONUS;
      if (!tasksDone[t.id]) { tasksDone[t.id] = true; saveTasksDone(); }
      beep(990, 0.1, "sine");
      setTimeout(function () { beep(1320, 0.14, "sine"); }, 100);
      haptic("success");
      showTaskToast("✅ TASK COMPLETE: " + t.title + " +" + TASK_BONUS + " PTS");
      renderTasksPanels();
      updateHud();
    }
  }
  function renderTasksPanels() {
    var html = TASKS.map(function (t) {
      var done = !!tasksDone[t.id];
      return "<div class=\"task-row" + (done ? " done" : "") + "\"><span class=\"task-mark\">" +
        (done ? "✅" : "○") + "</span><span><b>" + t.title + "</b> — " + t.desc +
        " <span class=\"task-bonus\">+" + TASK_BONUS + " pts</span></span></div>";
    }).join("");
    ["tasksPanelReady", "tasksPanelOver"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = "<h3>🎯 HARD TASKS</h3>" + html;
    });
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function rectsHit(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function reset() {
    frame = 0; distance = 0; bolts = 0; speed = 5.5; spawnIn = 55;
    level = 1; bonusPoints = 0; dodgedThisRun = 0; djumpsThisRun = 0; runTasks = {};
    obstacles = []; pickups = []; particles = [];
    player.y = GROUND_Y - player.h; player.vy = 0; player.jumps = 0; player.onGround = true;
    if (levelBannerEl) levelBannerEl.classList.add("hidden");
    if (taskToastEl) taskToastEl.classList.add("hidden");
    renderTasksPanels();
    updateHud();
  }

  function start() {
    reset();
    state = "playing";
    readyOverlay.classList.add("hidden");
    overOverlay.classList.add("hidden");
    beep(440, 0.08, "square");
  }

  function gameOver() {
    state = "over";
    overAtFrame = frame;
    var s = getScore();
    saveBest(s);
    saveBestLevel(level);
    beep(110, 0.35, "sawtooth");
    haptic("heavy");
    // burst of particles where the punk died
    for (var i = 0; i < 26; i++) {
      particles.push({ x: player.x + 23, y: player.y + 27, vx: rand(-4, 4), vy: rand(-7, 1), life: 30 + Math.random() * 20, c: ["#ff2e88", "#00e5ff", "#ffe600"][i % 3] });
    }
    finalScoreEl.textContent = String(s);
    bestLineEl.textContent = "Your best (this browser): " + best;
    if (levelLineEl) levelLineEl.textContent = "Level reached: " + level + " · Best level: " + bestLevel;
    renderTasksPanels();
    overOverlay.classList.remove("hidden");
    updateHud();
    window.PunkGame.lastScore = s;
    window.PunkGame.lastLevel = level;
    window.dispatchEvent(new CustomEvent("punkgameover", { detail: { score: s } }));
  }

  function jump() {
    if (state === "ready") { start(); return; }
    if (state === "over") {
      if (frame - overAtFrame > 24) start(); // small lockout so the killing jump can't instantly restart
      return;
    }
    if (player.jumps < 2) {
      var wasAirJump = player.jumps === 1; // second jump = double jump
      player.vy = player.jumps === 0 ? -14.2 : -12.5;
      player.jumps++;
      if (wasAirJump) djumpsThisRun++;
      player.onGround = false;
      beep(player.jumps === 1 ? 520 : 660, 0.07, "square");
    }
  }

  // ---- spawning -------------------------------------------------------
  // Obstacle mix gets meaner with the level: walls from level 2,
  // hover drones from level 3 (stay low — jumping into one kills you).
  function spawnObstacle() {
    var roll = Math.random();
    if (level >= 3 && roll < 0.15) {
      obstacles.push({ kind: "drone", x: W + 20, y: GROUND_Y - 132, w: 44, h: 30, bob: Math.random() * 6 });
    } else if (level >= 2 && roll < 0.32) {
      obstacles.push({ kind: "wall", x: W + 20, y: GROUND_Y - 100, w: 44, h: 100 });
    } else if (roll < 0.45) {
      obstacles.push({ kind: "spike", x: W + 20, y: GROUND_Y - 34, w: 34, h: 34 });
    } else if (roll < 0.8) {
      obstacles.push({ kind: "barrier", x: W + 20, y: GROUND_Y - 70, w: 34, h: 70 });
    } else {
      obstacles.push({ kind: "spike", x: W + 20, y: GROUND_Y - 34, w: 34, h: 34 });
      obstacles.push({ kind: "spike", x: W + 66, y: GROUND_Y - 34, w: 34, h: 34 });
    }
    // bolt arc above the gap, sometimes
    if (Math.random() < 0.6) {
      var baseY = GROUND_Y - rand(95, 150);
      for (var i = 0; i < 3; i++) {
        pickups.push({ x: W + 40 + i * 34, y: baseY - Math.abs(i - 1) * 12, r: 12, taken: false });
      }
    }
  }

  // ---- update ---------------------------------------------------------
  function update() {
    frame++;
    if (state === "playing") {
      // speed grows with the level (+ a slow time ramp), capped
      speed = Math.min(13.5, 5 + level * 0.55 + frame * 0.0008);
      distance += speed;
      runPhase += speed * 0.09;

      // levels + tasks are checked every frame while playing
      checkLevelUp();
      checkTasks();

      // player physics
      player.vy = Math.min(18, player.vy + 0.85);
      player.y += player.vy;
      if (player.y >= GROUND_Y - player.h) {
        player.y = GROUND_Y - player.h;
        player.vy = 0;
        player.jumps = 0;
        player.onGround = true;
      }

      // spawn — denser as the level rises
      spawnIn -= 1;
      if (spawnIn <= 0) {
        spawnObstacle();
        spawnIn = Math.max(30, Math.round(rand(62, 100) * (6.5 / speed) * Math.max(0.55, 1 - level * 0.04)));
      }

      // move + collide obstacles
      for (var i = obstacles.length - 1; i >= 0; i--) {
        var ob = obstacles[i];
        ob.x -= speed;
        if (ob.x + ob.w < -20) { obstacles.splice(i, 1); dodgedThisRun++; continue; }
        if (rectsHit(player.x + 7, player.y + 4, player.w - 14, player.h - 6, ob.x + 3, ob.y + 3, ob.w - 6, ob.h - 3)) {
          gameOver();
          return;
        }
      }
      // move + collect bolts
      for (var j = pickups.length - 1; j >= 0; j--) {
        var p = pickups[j];
        p.x -= speed;
        if (p.x < -30) { pickups.splice(j, 1); continue; }
        if (!p.taken && rectsHit(player.x, player.y, player.w, player.h, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2)) {
          p.taken = true;
          bolts++;
          beep(880, 0.09, "sine");
          haptic("light");
          pickups.splice(j, 1);
        }
      }
      updateHud();
    }
    // particles always animate
    for (var k = particles.length - 1; k >= 0; k--) {
      var pt = particles[k];
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.3; pt.life--;
      if (pt.life <= 0) particles.splice(k, 1);
    }
  }

  function updateHud() {
    scoreHud.textContent = String(getScore());
    boltsHud.textContent = String(bolts);
    bestHud.textContent = String(Math.max(best, getScore()));
    speedHud.textContent = "x" + (speed / 5.5).toFixed(1);
    if (levelHud) levelHud.textContent = String(level);
  }

  // ---- drawing --------------------------------------------------------
  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#12041f");
    g.addColorStop(0.6, "#1b0a33");
    g.addColorStop(1, "#07070d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // stars
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(frame * 0.02 + i));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
    // skyline (scrolls slowly)
    ctx.fillStyle = "#0d0d1a";
    var off = state === "playing" ? (distance * 0.25) % 120 : 0;
    for (var b = 0; b < buildings.length; b++) {
      var bd = buildings[b];
      var x = bd.x - off;
      ctx.fillRect(x, GROUND_Y - bd.h, bd.w, bd.h);
      ctx.fillStyle = "#ffe600";
      ctx.globalAlpha = 0.5;
      for (var wy = 0; wy < 3; wy++) {
        for (var wx = 0; wx < 2; wx++) {
          if ((b + wy + wx) % 2 === 0) ctx.fillRect(x + 8 + wx * 18, GROUND_Y - bd.h + 12 + wy * 22, 6, 8);
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#0d0d1a";
    }
    // ground
    ctx.fillStyle = "#16162a";
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.fillStyle = "#ff2e88";
    ctx.fillRect(0, GROUND_Y, W, 4);
    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(0, GROUND_Y + 8, W, 2);
  }

  function drawPlayer() {
    var x = player.x, y = player.y;
    var legSwing = player.onGround ? Math.sin(runPhase) * 6 : 0;
    // legs
    ctx.fillStyle = "#111122";
    ctx.fillRect(x + 10, y + player.h - 10, 10, 10 + (player.onGround ? Math.max(0, legSwing) : 0));
    ctx.fillRect(x + 26, y + player.h - 10, 10, 10 + (player.onGround ? Math.max(0, -legSwing) : 0));
    // body
    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(x + 4, y + 12, 38, 34);
    ctx.strokeStyle = "#001318";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 4, y + 12, 38, 34);
    // chest bolt
    ctx.fillStyle = "#ffe600";
    ctx.beginPath();
    ctx.moveTo(x + 26, y + 16); ctx.lineTo(x + 16, y + 30); ctx.lineTo(x + 22, y + 30);
    ctx.lineTo(x + 18, y + 42); ctx.lineTo(x + 30, y + 26); ctx.lineTo(x + 24, y + 26);
    ctx.closePath(); ctx.fill();
    // head
    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(x + 6, y - 6, 34, 20);
    ctx.strokeRect(x + 6, y - 6, 34, 20);
    // mohawk
    ctx.fillStyle = "#ff2e88";
    ctx.beginPath();
    ctx.moveTo(x + 10, y - 6); ctx.lineTo(x + 15, y - 22); ctx.lineTo(x + 20, y - 6);
    ctx.moveTo(x + 20, y - 6); ctx.lineTo(x + 25, y - 26); ctx.lineTo(x + 30, y - 6);
    ctx.moveTo(x + 30, y - 6); ctx.lineTo(x + 35, y - 22); ctx.lineTo(x + 38, y - 6);
    ctx.fill();
    // eyes
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + 26, y, 7, 7);
    ctx.fillRect(x + 35, y, 7, 7);
    ctx.fillStyle = "#000000";
    ctx.fillRect(x + 29, y + 2, 3, 3);
    ctx.fillRect(x + 38, y + 2, 3, 3);
  }

  function drawObstacles() {
    for (var i = 0; i < obstacles.length; i++) {
      var ob = obstacles[i];
      if (ob.kind === "spike") {
        ctx.fillStyle = "#ff2e88";
        ctx.beginPath();
        for (var s = 0; s < 3; s++) {
          var sx = ob.x + s * 12;
          ctx.moveTo(sx, ob.y + ob.h);
          ctx.lineTo(sx + 6, ob.y);
          ctx.lineTo(sx + 12, ob.y + ob.h);
        }
        ctx.fill();
        ctx.fillStyle = "#4d0a26";
        ctx.fillRect(ob.x, ob.y + ob.h - 6, ob.w, 6);
      } else if (ob.kind === "drone") {
        // hover drone — bobs gently, deadly if you jump into it; run under it
        var bobY = ob.y + Math.sin(frame * 0.12 + (ob.bob || 0)) * 5;
        ctx.save();
        ctx.shadowColor = "#ff2e88";
        ctx.shadowBlur = 14;
        ctx.fillStyle = "#ff2e88";
        ctx.beginPath();
        ctx.ellipse(ob.x + ob.w / 2, bobY + ob.h / 2, ob.w / 2, ob.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "#1a1a2a";
        ctx.beginPath();
        ctx.arc(ob.x + ob.w / 2, bobY + ob.h / 2, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffe600";
        ctx.beginPath();
        ctx.arc(ob.x + ob.w / 2, bobY + ob.h / 2, 3.5, 0, Math.PI * 2);
        ctx.fill();
        // rotor blur
        ctx.strokeStyle = "rgba(0,229,255,0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ob.x - 6, bobY - 4);
        ctx.lineTo(ob.x + ob.w + 6, bobY - 4);
        ctx.stroke();
      } else if (ob.kind === "wall") {
        // tall brick wall — jump early, jump high
        ctx.fillStyle = "#3d2b63";
        ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
        ctx.strokeStyle = "#ff2e88";
        ctx.lineWidth = 2;
        ctx.strokeRect(ob.x, ob.y, ob.w, ob.h);
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 1;
        for (var wy = ob.y + 16; wy < ob.y + ob.h; wy += 16) {
          ctx.beginPath(); ctx.moveTo(ob.x, wy); ctx.lineTo(ob.x + ob.w, wy); ctx.stroke();
        }
        ctx.fillStyle = "#ffe600";
        ctx.font = "bold 13px 'Arial Black', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("!", ob.x + ob.w / 2, ob.y + 20);
      } else {
        // barrier: hazard stripes
        ctx.fillStyle = "#ffe600";
        ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
        ctx.fillStyle = "#111111";
        ctx.beginPath();
        for (var d = -ob.h; d < ob.w; d += 16) {
          ctx.moveTo(ob.x + d, ob.y + ob.h);
          ctx.lineTo(ob.x + d + 8, ob.y + ob.h);
          ctx.lineTo(ob.x + d + 8 + ob.h, ob.y);
          ctx.lineTo(ob.x + d + ob.h, ob.y);
        }
        ctx.fill();
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.strokeRect(ob.x, ob.y, ob.w, ob.h);
      }
    }
  }

  function drawPickups() {
    for (var i = 0; i < pickups.length; i++) {
      var p = pickups[i];
      ctx.save();
      ctx.shadowColor = "#ffe600";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#ffe600";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#111111";
      ctx.beginPath();
      ctx.moveTo(p.x + 3, p.y - 7); ctx.lineTo(p.x - 4, p.y + 2); ctx.lineTo(p.x, p.y + 2);
      ctx.lineTo(p.x - 3, p.y + 8); ctx.lineTo(p.x + 5, p.y - 2); ctx.lineTo(p.x + 1, p.y - 2);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var pt = particles[i];
      ctx.globalAlpha = Math.max(0, pt.life / 40);
      ctx.fillStyle = pt.c;
      ctx.fillRect(pt.x, pt.y, 5, 5);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    drawBackground();
    drawPickups();
    drawObstacles();
    if (state !== "over") drawPlayer();
    drawParticles();
    if (state === "ready") {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ffe600";
      ctx.font = "bold 26px 'Arial Black', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PRESS START — THEN RUN!", W / 2, 120);
      ctx.font = "15px 'Segoe UI', sans-serif";
      ctx.fillStyle = "#f2f2f7";
      ctx.fillText("SPACE / ↑ / TAP to jump (double jump in the air)", W / 2, 150);
    }
  }

  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }

  // ---- input ----------------------------------------------------------
  document.getElementById("startBtn").addEventListener("click", function () { start(); });
  document.getElementById("playAgainBtn").addEventListener("click", function () { start(); });
  canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); jump(); });
  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
      e.preventDefault();
      jump();
    } else if (e.code === "Enter" && state !== "playing") {
      start();
    }
  });

  // ---- public API for web3.js ----------------------------------------
  window.PunkGame = {
    getScore: getScore,
    getState: function () { return state; },
    getLevel: function () { return level; },
    getBestLevel: function () { return bestLevel; },
    getTasks: function () {
      return TASKS.map(function (t) {
        return { id: t.id, title: t.title, desc: t.desc, bonus: TASK_BONUS, done: !!tasksDone[t.id], doneThisRun: !!runTasks[t.id] };
      });
    },
    lastScore: 0,
    lastLevel: 1,
    start: start
  };

  renderTasksPanels();
  updateHud();
  loop();
})();
