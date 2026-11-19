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
  function getScore() { return Math.floor(distance / 10) + bolts * 50; }
  function saveBest(s) {
    if (s > best) {
      best = s;
      try { window.localStorage.setItem(BEST_KEY, String(s)); } catch (e) { /* ignore */ }
    }
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function rectsHit(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function reset() {
    frame = 0; distance = 0; bolts = 0; speed = 5.5; spawnIn = 55;
    obstacles = []; pickups = []; particles = [];
    player.y = GROUND_Y - player.h; player.vy = 0; player.jumps = 0; player.onGround = true;
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
    beep(110, 0.35, "sawtooth");
    // burst of particles where the punk died
    for (var i = 0; i < 26; i++) {
      particles.push({ x: player.x + 23, y: player.y + 27, vx: rand(-4, 4), vy: rand(-7, 1), life: 30 + Math.random() * 20, c: ["#ff2e88", "#00e5ff", "#ffe600"][i % 3] });
    }
    finalScoreEl.textContent = String(s);
    bestLineEl.textContent = "Your best (this browser): " + best;
    overOverlay.classList.remove("hidden");
    updateHud();
    window.PunkGame.lastScore = s;
    window.dispatchEvent(new CustomEvent("punkgameover", { detail: { score: s } }));
  }

  function jump() {
    if (state === "ready") { start(); return; }
    if (state === "over") {
      if (frame - overAtFrame > 24) start(); // small lockout so the killing jump can't instantly restart
      return;
    }
    if (player.jumps < 2) {
      player.vy = player.jumps === 0 ? -14.2 : -12.5;
      player.jumps++;
      player.onGround = false;
      beep(player.jumps === 1 ? 520 : 660, 0.07, "square");
    }
  }

  // ---- spawning -------------------------------------------------------
  function spawnObstacle() {
    var roll = Math.random();
    if (roll < 0.45) {
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
      speed = Math.min(12.5, 5.5 + frame * 0.0016);
      distance += speed;
      runPhase += speed * 0.09;

      // player physics
      player.vy = Math.min(18, player.vy + 0.85);
      player.y += player.vy;
      if (player.y >= GROUND_Y - player.h) {
        player.y = GROUND_Y - player.h;
        player.vy = 0;
        player.jumps = 0;
        player.onGround = true;
      }

      // spawn
      spawnIn -= 1;
      if (spawnIn <= 0) {
        spawnObstacle();
        spawnIn = Math.max(38, Math.round(rand(62, 100) * (6.5 / speed)));
      }

      // move + collide obstacles
      for (var i = obstacles.length - 1; i >= 0; i--) {
        var ob = obstacles[i];
        ob.x -= speed;
        if (ob.x + ob.w < -20) { obstacles.splice(i, 1); continue; }
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
    lastScore: 0,
    start: start
  };

  updateHud();
  loop();
})();
