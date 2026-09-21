// ============================================================
// RIDE TO US — điều phối màn hình, HUD, các đoạn cắt cảnh
// ============================================================
import {
  IMG, ITEMS, SOLO_SEGMENTS, SOLO_SEG_W, WALK_TERRAIN, BOSS_TERRAIN, MEET_TERRAIN, MAX_HEARTS, MAN_LINE, MEET_TEXT, MILESTONES, SCENES, SCENE_SPEEDS, SCENE_SINK, SCENE_TOP, GRASS_SCENES, PROPS, PROP_SETS,
  SYSTEM_MESSAGE, ENVELOPE_LABEL, LETTER_TEXT, VIDEO_SRC, GAME_TITLE,
} from "./content.js";
import { initAudio, sfx, setMuted, isMuted } from "./audio.js";
import { JourneyGame } from "./engine.js";

let currentGame = null;
let timeTimer = null;

// ---------------- ảnh ----------------
const imgCache = new Map();
function getImg(src) {
  if (!imgCache.has(src)) {
    const img = new Image();
    img.src = src;
    imgCache.set(src, img);
  }
  return imgCache.get(src);
}
function preload(src) {
  return new Promise((resolve) => {
    const img = getImg(src);
    if (img.complete) return resolve(img);
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
  });
}
function loaded(img) {
  return !!(img && img.complete && img.naturalWidth > 0);
}
// Ép ảnh về cùng hạt pixel với nhân vật: 1 pixel art ≈ 0.55 đơn vị thế giới.
// Ảnh gốc quá mịn (vd Man-Bike-Side-01 1156px cho 74 đơn vị) được thu về
// lưới tương ứng trước, để khi vẽ vào game hạt của nó khớp các sprite khác.
const ART_PX_PER_WU = 0.55;
function normalizeGrain(img, worldHeight) {
  if (!loaded(img)) return img;
  const gridH = Math.round(worldHeight / ART_PX_PER_WU);
  if (img.naturalHeight <= gridH * 1.25) return img;
  const gridW = Math.round(gridH * (img.naturalWidth / img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = gridW;
  c.height = gridH;
  c.getContext("2d").drawImage(img, 0, 0, gridW, gridH);
  return c;
}
async function preloadAll() {
  const srcs = new Set([...Object.values(IMG).flat(), ...Object.values(SCENES).flat(), ...Object.values(PROPS)]);
  ITEMS.forEach((it) => srcs.add(it.icon));
  MILESTONES.forEach((ms) => {
    if (ms.photo) srcs.add(ms.photo);
  });
  await Promise.all([...srcs].map(preload));
}

// Canvas khớp đúng tỉ lệ màn hình thiết bị (phủ kín, không méo, không cắt).
function canvasSizeForViewport() {
  const w = window.innerWidth || 960;
  const h = window.innerHeight || 360;
  const aspect = w / h;
  // tablet nằm ngang (iPad): lấy khung nhìn cao hơn để thấy xa hơn
  const base = w >= 900 && aspect >= 1.2 ? 700 : 620;
  const width = Math.round(Math.max(480, Math.min(1280, aspect * base)));
  const height = Math.round(width / aspect);
  return { width, height };
}

// ---------------- helpers màn hình ----------------
const $ = (id) => document.getElementById(id);
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}
const showModal = (id) => $(id).classList.remove("hidden");
const hideModal = (id) => $(id).classList.add("hidden");

// ---------------- HUD ----------------
function renderHearts(n) {
  const wrap = $("hud-hearts");
  wrap.innerHTML = "";
  for (let i = 0; i < MAX_HEARTS; i++) {
    const img = document.createElement("img");
    img.src = i < n ? IMG.heartFull : IMG.heartEmpty;
    img.alt = "";
    wrap.appendChild(img);
  }
}
function renderItemSlots(collectedIds) {
  const wrap = $("hud-items");
  wrap.innerHTML = "";
  ITEMS.forEach((it) => {
    const slot = document.createElement("div");
    slot.className = "hud-slot" + (collectedIds.has(it.id) ? " got" : "");
    slot.title = it.label;
    const icon = getImg(it.icon);
    if (loaded(icon)) {
      const img = document.createElement("img");
      img.src = it.icon;
      img.alt = "";
      slot.appendChild(img);
    } else {
      const lip = document.createElement("div");
      lip.className = "lip";
      slot.appendChild(lip);
    }
    wrap.appendChild(slot);
  });
}
let hintTimer = null;
function showHint(text, ms = 2600) {
  const el = $("hud-hint");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.add("hidden"), ms);
}
function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function renderScore(n) {
  $("hud-score").textContent = String(n).padStart(5, "0");
}
// thanh tiến độ pixel (Bar-0/25/50/75/100) — chọn khung gần nhất với %
function renderBar(pct) {
  const idx = Math.max(0, Math.min(4, Math.round((pct / 100) * 4)));
  $("hud-bar").src = IMG.bars[idx];
}
function hudSoloMode() {
  $("hud-hearts").classList.remove("hidden");
  $("hud-items").classList.remove("hidden");
  $("hud-milestone").classList.add("hidden");
  $("hud-portrait").classList.add("hidden");
  $("hud-stats").classList.remove("hidden");
  renderBar(0);
  renderScore(0);
  $("hud-time").textContent = "0:00";
}
function hudCoupleMode() {
  $("hud-hearts").classList.add("hidden");
  $("hud-items").classList.add("hidden");
  $("hud-milestone").classList.remove("hidden");
  $("hud-portrait").classList.remove("hidden");
  $("hud-stats").classList.remove("hidden");
  $("hud-milestone").innerHTML = "Together ♥";
  renderBar(0);
}

// ---------------- luồng game ----------------
function startJourney() {
  showScreen("screen-level");
  hudSoloMode();
  renderHearts(MAX_HEARTS);
  renderItemSlots(new Set());

  const canvas = $("game-canvas");
  const size = canvasSizeForViewport();
  canvas.width = size.width;
  canvas.height = size.height;

  const images = {
    playerSolo: normalizeGrain(getImg(IMG.playerSolo), 74),
    walkFrames: IMG.walkFrames.map(getImg),
    gear: { key: getImg(IMG.key), helmet: getImg(IMG.helmet) },
    coupleFrames: IMG.coupleFrames.map(getImg),
    woman: getImg(IMG.woman),
    womanCheer: IMG.womanCheer.map(getImg),
    cloud: getImg(IMG.cloud),
    road: getImg(IMG.road),
    brick: getImg(IMG.brick),
    brickRow: getImg(IMG.brickRow),
    blockSurprise: getImg(IMG.blockSurprise),
    blockUsed: getImg(IMG.blockUsed),
    itemHeart: getImg(IMG.itemHeart),
    terrainHills: getImg(IMG.terrainHills),
    terrainRiverLake: getImg(IMG.terrainRiverLake),
    terrainRiceField: getImg(IMG.terrainRiceField),
    terrainSunset: getImg(IMG.terrainSunset),
    scenes: Object.fromEntries(Object.entries(SCENES).map(([id, layers]) => [id, layers.map(getImg)])),
    sceneSpeeds: SCENE_SPEEDS,
    sceneSink: SCENE_SINK,
    sceneTop: SCENE_TOP,
    grassFloat: getImg(IMG.grassFloat),
    grassGround: getImg(IMG.grassGround),
    egg: getImg(IMG.egg),
    props: Object.fromEntries(Object.entries(PROPS).map(([k, v]) => [k, getImg(v)])),
    pickup: Object.fromEntries(ITEMS.map((it) => [it.id, getImg(it.icon)])),
    polaroids: MILESTONES.map((ms) => (ms.photo ? getImg(ms.photo) : null)),
  };

  const collected = new Set();
  if (currentGame) currentGame.destroy();
  currentGame = new JourneyGame(
    canvas,
    { soloSegments: SOLO_SEGMENTS, soloSegW: SOLO_SEG_W, walkTerrain: WALK_TERRAIN, bossTerrain: BOSS_TERRAIN, meetTerrain: MEET_TERRAIN, items: ITEMS, milestones: MILESTONES, maxHearts: MAX_HEARTS, grassScenes: GRASS_SCENES, propSets: PROP_SETS },
    images,
    {
      onItem: (item, count, total) => {
        collected.add(item.id);
        renderItemSlots(collected);
        renderBar((count / total) * 100);
        showHint(count < total ? `${item.label} ✓  ·  ${count}/${total}` : "All 5 gifts! Now go find her ♥", count < total ? 1800 : 3200);
      },
      onHearts: (n) => renderHearts(n),
      onGameOver: () => showModal("modal-gameover"),
      onMeet: () => playMeeting(),
      onMilestone: (ms, j) => {
        if (!ms) {
          renderBar(100);
          return;
        }
        $("hud-milestone").innerHTML = `<b>${ms.date}</b>${ms.name}`;
        renderBar((j / MILESTONES.length) * 100);
        if (ms.event === "rain") showHint("It's raining! Jump the walls and grab the umbrella ☂", 3600);
      },
      onExtra: (ex) => { if (ex.id === "umbrella") showHint("Rain's over — let's keep going ♥", 2600); },
      onChest: () => openSystemMessage(),
      onGift: () => openVideo(false),
      onScore: (n) => renderScore(n),
      onJump: (k) => sfx(k === 2 ? "jump2" : "jump"),
      onGear: (ge, ready) => showHint(ready ? "All set — hop on the bike!" : `${ge.label} ✓`, ready ? 2600 : 1400),
      onMount: () => setTimeout(() => showHint("Collect all 5 gifts — press ▲ twice to jump higher", 3600), 900),
      onBoss: (ev, b) => {
        if (ev === "start") showHint("A cloud of doubt! Jump over it 3 times", 3200);
        if (ev === "dodge" && b.dodges < 3) showHint(`Nice! ${b.dodges}/3`, 1200);
        if (ev === "defeated") showHint("Doubt cleared — the road is open ✦", 3000);
      },
    }
  );
  currentGame.start();
  initAudio();
  clearInterval(timeTimer);
  timeTimer = setInterval(() => {
    if (currentGame && currentGame.phase === "solo") $("hud-time").textContent = fmtTime(currentGame.timeSolo);
  }, 250);
  setTimeout(() => showHint("Grab your key and helmet, then hop on the bike", 3600), 600);
}

// --- chương 2: gặp nhau ---
function playMeeting() {
  const bubble = $("bubble-man");
  bubble.textContent = MAN_LINE;
  // đặt bong bóng ngay trên đầu nhân vật (đổi toạ độ canvas → % màn hình)
  const g = currentGame;
  bubble.style.left = ((g.player.x + g.player.w * 0.5 - g.camX) / g.CW) * 100 + "%";
  bubble.style.top = ((g.player.y - 12) / g.CH) * 100 + "%";
  bubble.classList.remove("hidden");
  setTimeout(() => {
    bubble.classList.add("hidden");
    $("meet-text").textContent = MEET_TEXT;
    $("meet-stats").innerHTML =
      `MISSION COMPLETE<br>score <b>${g.score}</b> · time <b>${fmtTime(g.timeSolo)}</b> · hearts lost <b>${g.heartsLost}</b>`;
    showScreen("screen-meet");
  }, 1900);
}

// --- chương 4: hòm hồng → System Message ---
function openSystemMessage() {
  $("system-text").textContent = SYSTEM_MESSAGE;
  $("system-reply").textContent = "";
  showModal("modal-system");
}

// --- hòm quà → thư → video ---
function openEnvelope() {
  $("envelope-label").textContent = ENVELOPE_LABEL;
  showModal("modal-envelope");
}
function openLetter(fromEnding) {
  $("letter-text").textContent = LETTER_TEXT;
  $("letter-close").classList.toggle("hidden", !fromEnding);
  $("btn-watch-video").classList.toggle("hidden", fromEnding);
  $("btn-watch-video").textContent = "Continue the journey ▸";
  showModal("modal-letter");
}
function openVideo(fromEnding) {
  const video = $("video-player");
  const missing = $("video-missing");
  missing.classList.add("hidden");
  video.classList.remove("hidden");
  video.src = VIDEO_SRC;
  video.load();
  $("btn-video-done").textContent = fromEnding ? "Close" : "Continue ▸";
  $("btn-video-done").dataset.fromEnding = fromEnding ? "1" : "";
  showModal("modal-video");
}
function closeVideo() {
  const video = $("video-player");
  video.pause();
  video.removeAttribute("src");
  video.load();
  hideModal("modal-video");
}

function showEnding() {
  if (currentGame) {
    currentGame.finish();
    currentGame.destroy();
    currentGame = null;
  }
  showScreen("screen-ending");
}

// ---------------- nối nút bấm ----------------
function wireUI() {
  // toàn màn hình: tự xin khi bấm Start (phải nằm trong cử chỉ người dùng), nút ⛶ và phím F để bật/tắt
  const docEl = document.documentElement;
  const fsSupported = !!(docEl.requestFullscreen || docEl.webkitRequestFullscreen);
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const enterFs = () => {
    if (!fsSupported || isFs()) return;
    const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
    try {
      const r = req.call(docEl, { navigationUI: "hide" });
      if (r && r.catch) r.catch(() => {});
    } catch (e) { /* trình duyệt không cho (iPhone) */ }
  };
  const exitFs = () => {
    const ex = document.exitFullscreen || document.webkitExitFullscreen;
    if (ex) ex.call(document);
  };
  const fsBtn = $("btn-fullscreen");
  const renderFs = () => {
    fsBtn.textContent = isFs() ? "✕" : "⛶";
    fsBtn.setAttribute("aria-label", isFs() ? "Exit full screen" : "Full screen");
  };
  if (!fsSupported) fsBtn.classList.add("hidden");
  fsBtn.addEventListener("click", () => (isFs() ? exitFs() : enterFs()));
  document.addEventListener("fullscreenchange", renderFs);
  document.addEventListener("webkitfullscreenchange", renderFs);
  window.addEventListener("keydown", (e) => {
    if (e.key === "f" || e.key === "F") (isFs() ? exitFs() : enterFs());
  });
  renderFs();

  $("btn-start").addEventListener("click", () => {
    enterFs();
    startJourney();
  });

  // tiếng "blip" cho mọi nút retro (pixel-btn / ✕) — bắt ở pha capture để kêu trước khi màn hình đổi
  document.addEventListener(
    "click",
    (e) => {
      const b = e.target.closest && e.target.closest(".pixel-btn, .win-x.btn, .sound-btn");
      if (!b) return;
      initAudio();
      sfx("click");
    },
    true
  );
  // bật / tắt âm thanh
  const soundBtn = $("btn-sound");
  const renderSound = () => {
    soundBtn.textContent = isMuted() ? "🔇" : "🔊";
    soundBtn.setAttribute("aria-label", isMuted() ? "Sound off" : "Sound on");
  };
  renderSound();
  soundBtn.addEventListener("click", () => {
    initAudio();
    setMuted(!isMuted());
    renderSound();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "m" || e.key === "M") {
      setMuted(!isMuted());
      renderSound();
    }
  });

  $("btn-retry").addEventListener("click", () => {
    hideModal("modal-gameover");
    currentGame && currentGame.retrySegment();
  });

  $("btn-meet-continue").addEventListener("click", () => {
    showScreen("screen-level");
    hudCoupleMode();
    currentGame && currentGame.beginCouple();
  });

  $("btn-sys-maybe").addEventListener("click", () => {
    $("system-reply").textContent = "> Maybe? Take your time… the button is still waiting.";
    $("modal-system").querySelector(".win").classList.remove("shake");
    void $("modal-system").offsetWidth;
    $("modal-system").querySelector(".win").classList.add("shake");
  });
  $("btn-sys-stop").addEventListener("click", () => {
    $("system-reply").textContent = "> Nice try. That option has been disabled by admin ♥";
    $("modal-system").querySelector(".win").classList.remove("shake");
    void $("modal-system").offsetWidth;
    $("modal-system").querySelector(".win").classList.add("shake");
  });
  $("btn-sys-yes").addEventListener("click", () => {
    hideModal("modal-system");
    showScreen("screen-unlock");
  });
  $("btn-unlock-continue").addEventListener("click", () => {
    showScreen("screen-level");
    $("hud-milestone").innerHTML = "Level 2 · unlocked ♥";
    openEnvelope();
  });

  $("btn-open-letter").addEventListener("click", () => {
    hideModal("modal-envelope");
    openLetter(false);
  });
  $("letter-close").addEventListener("click", () => hideModal("modal-letter"));
  // đọc thư xong (ở Sa Pa) → đi tiếp tới Hoàn Kiếm, hòm video sẽ rơi xuống ở đó
  $("btn-watch-video").addEventListener("click", () => {
    hideModal("modal-letter");
    currentGame && currentGame.resumeJourney();
    showHint("One more stop — ride on to Hoàn Kiếm ♥", 3000);
  });
  $("video-player").addEventListener("error", () => {
    $("video-player").classList.add("hidden");
    $("video-missing").classList.remove("hidden");
  });
  $("btn-video-done").addEventListener("click", () => {
    const fromEnding = $("btn-video-done").dataset.fromEnding === "1";
    closeVideo();
    if (!fromEnding) showEnding();
  });

  $("btn-play-again").addEventListener("click", startJourney);
  $("btn-ending-letter").addEventListener("click", () => openLetter(true));
  $("btn-ending-video").addEventListener("click", () => openVideo(true));

  // chạm vào canvas = mở hòm khi đang đứng cạnh
  $("game-canvas").addEventListener("click", () => currentGame && currentGame.interact());

  // nút cảm ứng
  const bind = (id, key) => {
    const el = $(id);
    const press = (e) => {
      e.preventDefault();
      currentGame && currentGame.pressKey(key);
    };
    const release = (e) => {
      e.preventDefault();
      currentGame && currentGame.releaseKey(key);
    };
    el.addEventListener("touchstart", press, { passive: false });
    el.addEventListener("touchend", release, { passive: false });
    el.addEventListener("touchcancel", release, { passive: false });
    el.addEventListener("mousedown", press);
    el.addEventListener("mouseup", release);
    el.addEventListener("mouseleave", release);
  };
  bind("btn-left", "ArrowLeft");
  bind("btn-right", "ArrowRight");
  bind("btn-jump", "ArrowUp");

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!currentGame) return;
      const s = canvasSizeForViewport();
      currentGame.resize(s.width, s.height);
    }, 150);
  });
}

async function init() {
  document.title = GAME_TITLE + " — Ride to Us";
  wireUI();
  const startBtn = $("btn-start");
  startBtn.textContent = "Loading…";
  startBtn.disabled = true;
  await preloadAll();
  startBtn.disabled = false;
  startBtn.textContent = "Start the journey";
  if (location.hash === "#autostart") startBtn.click(); // mở thẳng vào game (dùng để test)
}

init();
