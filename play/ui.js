/*__CARD_ART_JS__*/
const WASM_B64 = "__WASM_B64__";
const CARD_ART_MANIFEST = __CARD_ART_MANIFEST_JSON__;

const COLORS = ["w", "u", "g", "r", "k"];
const NAMES = ["白宝石", "蓝宝石", "绿宝石", "红宝石", "黑宝石", "黄金"];
const LETTERS = ["W", "U", "G", "R", "K", "gold"];
const DISPLAY_SLOTS = 4;
const MAX_RESERVED = 3;
const PAIRS = [[0,1],[0,2],[0,3],[0,4],[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]];
const TRIPLES = [[0,1,2],[0,1,3],[0,1,4],[0,2,3],[0,2,4],[0,3,4],[1,2,3],[1,2,4],[1,3,4],[2,3,4]];
const $ = (id) => document.getElementById(id);

let STATIC, game, humanSeat = 0, log = [], legalSet = new Set(), cardArt;
let sel = { colors: [], double: false };
let aiMovesThisTurn = 0;
let aiThinking = false;
let tutorialStep = -1;

const POLICY_BUNDLES = __POLICY_BUNDLES_JSON__;
const opponentPrefKey = LOCAL_GAME ? 'splendor-local-opponent-v1' : 'splendor-opponent-v2';
function normalizeOpponent(value) {
  return value === 'simple' || Object.hasOwn(POLICY_BUNDLES, value) ? value : 'simple';
}
function readOpponentPreference() {
  try {
    const parse = saved => { try { return JSON.parse(saved); } catch { return saved; } };
    const current = localStorage.getItem(opponentPrefKey);
    if (current !== null) return normalizeOpponent(parse(current));
    // Preserve difficulty once when upgrading the previous 40M/100M release.
    const legacy = parse(localStorage.getItem('splendor-opponent-v1'));
    const migrated = legacy === 'transformer40m' ? 'transformer100m'
      : legacy === 'transformer100m' || legacy === 'policy' ? 'transformer200m' : 'simple';
    localStorage.setItem(opponentPrefKey, migrated);
    return migrated;
  } catch { return 'simple'; }
}
let opponentMode = readOpponentPreference(), sessionVersion = 0, humanBusy = false, gameError = "";
let actionMode = "take", selectedCard = null;
let turnLimitSeconds = 0, turnDeadline = 0, timedTurnKey = null;
let ownedCardsOpen = false, ownedCardsScroll = 0;
let ownedCardsPosition = null, ownedCardsDrag = null;
const opponentName = () => POLICY_BUNDLES[opponentMode]?.metadata.display_name || "简单机器人";
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function b64ToBytes(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- action indexing ------------------------------------------------------
const pairIdx = {}, tripleIdx = {};
PAIRS.forEach((p, i) => (pairIdx[p.join(",")] = 5 + i));
TRIPLES.forEach((t, i) => (tripleIdx[t.join(",")] = 15 + i));

function takeIndex(s) {
  if (s.double) return 25 + s.colors[0];
  const key = [...s.colors].sort((a, b) => a - b).join(",");
  if (s.colors.length === 1) return s.colors[0];
  if (s.colors.length === 2) return pairIdx[key];
  return tripleIdx[key];
}
const buyDisplayIdx = (t, s) => 45 + t * 4 + s;
const reserveDisplayIdx = (t, s) => 30 + t * 4 + s;
const reserveDeckIdx = (t) => 42 + t;
const buyReservedIdx = (i) => 57 + i;
const discardIdx = (g) => 60 + g;
const nobleIdx = (id) => 66 + id;
const PASS_IDX = 76;

function cardDesc(id) {
  const c = STATIC.cards[id];
  return `${c.points} 分 · ${NAMES[c.bonus]}折扣`;
}

function gemHtml(cls, n) {
  return `<span class="gem ${cls}">${n}</span>`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- optional human turn clock -------------------------------------------
function formatTurnLimit(seconds) {
  const mins = Math.floor(seconds / 60), secs = seconds % 60;
  return mins ? `${mins} 分钟${secs ? ` ${secs} 秒` : ""}` : `${secs} 秒`;
}
function updateTurnLimitSetting() {
  const seconds = Number($("turn-limit-range").value);
  $("turn-limit-value").textContent = formatTurnLimit(seconds);
  $("turn-limit-range").disabled = !$("turn-limit-enabled").checked;
  $("turn-limit-range").setAttribute("aria-valuetext", formatTurnLimit(seconds));
}
function resetTurnClock() {
  turnDeadline = 0; timedTurnKey = null;
  $("turn-clock").hidden = true;
  $("turn-clock").textContent = "";
}
function paintTurnClock() {
  const el = $("turn-clock");
  const seconds = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
  el.hidden = !turnDeadline || seconds >= 60;
  el.textContent = el.hidden ? "" : `剩余 00:${String(seconds).padStart(2, "0")}`;
  el.classList.toggle("urgent", !el.hidden && seconds <= 10);
  el.setAttribute("aria-label", el.hidden ? "" : `你的回合剩余 ${seconds} 秒`);
}
function syncTurnClock() {
  if (!turnLimitSeconds || !game || game.phase() === "GameOver" || game.current() !== humanSeat || gameError) {
    resetTurnClock(); return;
  }
  const key = `${sessionVersion}:${game.round()}:${humanSeat}`;
  // Start only once per turn, after the opponent's animations have settled.
  // Payments, rerenders, tab switching and opening settings do not restart it.
  if (timedTurnKey !== key && !humanBusy && !aiThinking) {
    timedTurnKey = key; turnDeadline = Date.now() + turnLimitSeconds * 1000;
  }
  paintTurnClock();
}
async function expireHumanTurn() {
  if (!turnDeadline || Date.now() < turnDeadline || humanBusy || aiThinking || !game || game.current() !== humanSeat || game.phase() === "GameOver" || gameError) return;
  const epoch = sessionVersion, before = currentState(), seat = humanSeat;
  humanBusy = true;
  try {
    game.finish_timed_out_turn();
    invalidateHint();
    log.push({seat, verb:"回合超时", html:`<span class="mini-chip">${before.phase === "Play" ? "自动跳过" : "自动完成结算"}</span>`, fresh:true});
    recordNobleAwards(before, currentState(), seat, PASS_IDX);
    const refills = markRefills(before.display);
    sel = {colors:[], double:false}; selectedCard = null;
    hidePopover(); refreshLegal(); render();
    await animateRefill(refills, epoch);
    if (epoch !== sessionVersion) return;
    humanBusy = false;
    await aiMoves(epoch);
    if (epoch !== sessionVersion) return;
    tutorialOnMove(); render();
  } catch (error) {
    if (epoch !== sessionVersion) return;
    humanBusy = false; gameError = "回合超时处理失败：" + error.message; render();
  }
}
function tickTurnClock() {
  if (!turnDeadline) return;
  paintTurnClock();
  if (Date.now() >= turnDeadline) void expireHumanTurn();
}
setInterval(tickTurnClock, 200);
document.addEventListener("visibilitychange", tickTurnClock);
window.addEventListener("focus", tickTurnClock);

// ---- flying pieces --------------------------------------------------------
// Moves are animated by cloning the piece into a fixed overlay and tweening it
// from where it currently is to where it is going, before the board re-renders.
const FLY_MS = 500;

function rectOf(sel) {
  const el = typeof sel === "string" ? document.querySelector(sel) : sel;
  return el ? el.getBoundingClientRect() : null;
}

function seatPanelRect(seat) {
  return rectOf(`[data-seat="${seat}"]`);
}

/// Animate `html` from rect `from` to rect `to`. Returns a promise that
/// settles when the flight finishes.
function fly(html, from, to, { size = null } = {}) {
  if (REDUCED_MOTION || !from || !to) return Promise.resolve();
  const layer = $("fly");
  const node = document.createElement("div");
  node.className = "flyer" + (size ? " card-flyer" : "");
  node.innerHTML = html;
  node.style.left = from.left + "px";
  node.style.top = from.top + "px";
  if (size) {
    node.style.width = size.w + "px";
    node.style.height = size.h + "px";
  }
  layer.appendChild(node);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  requestAnimationFrame(() => {
    node.style.transform = `translate(${dx}px, ${dy}px) scale(${size ? 0.62 : 1})`;
    node.style.opacity = "0.15";
  });
  return sleep(FLY_MS).then(() => node.remove());
}

/// Build the flight plan for an action, reading the board as it is *now*.
function planFlight(state, idx, seat) {
  const gemFly = (colors) => {
    const dest = seatPanelRect(seat);
    return colors.map((c) => {
      const from = rectOf(`[data-pile="${c}"] .gem`);
      return { html: gem(COLORS[c], 1), from, to: dest };
    });
  };
  if (idx < 5) return gemFly([idx]);
  if (idx < 15) return gemFly(PAIRS[idx - 5]);
  if (idx < 25) return gemFly(TRIPLES[idx - 15]);
  if (idx < 30) return gemFly([idx - 25, idx - 25]);
  if (idx < 45 || (idx >= 45 && idx < 60)) {
    // Reserve or buy: the card itself travels to the acting player's panel.
    let from = null, id = null;
    if (idx >= 30 && idx < 42) {
      const t = (idx - 30) / 4 | 0, s = (idx - 30) % 4;
      from = rectOf(`[data-slot="${t},${s}"]`);
      id = state.display[t][s];
    } else if (idx >= 42 && idx < 45) {
      from = rectOf(`[data-deck="${idx - 42}"]`);
    } else if (idx >= 45 && idx < 57) {
      const t = (idx - 45) / 4 | 0, s = (idx - 45) % 4;
      from = rectOf(`[data-slot="${t},${s}"]`);
      id = state.display[t][s];
    } else {
      id = state.players[seat].reserved[idx - 57];
      from = seatPanelRect(seat);
    }
    const html = id !== null && id !== undefined
      ? cardHtml(id)
      : `<div class="card"><div class="band"></div><div class="body"></div></div>`;
    return [{ html, from, to: seatPanelRect(seat), size: { w: from?.width || 110, h: from?.height || 164 } }];
  }
  if (idx >= 60 && idx < 66) {
    // Discard: the token goes back to the bank.
    const g = idx - 60;
    return [{
      html: gem(g === 5 ? "y" : COLORS[g], 1),
      from: seatPanelRect(seat),
      to: rectOf(`[data-pile="${g === 5 ? 5 : g}"] .gem`) || rectOf("#bank"),
    }];
  }
  return [];
}

/// Always returns a promise so callers can wait for the move to land before
/// starting the next one.
async function animateMove(state, idx, seat, epoch = sessionVersion) {
  if (epoch !== sessionVersion) return;
  // Purchase is committed only after all payments, not at card selection.
  if ((idx >= 45 && idx < 60) || idx >= 77) return;
  if (REDUCED_MOTION) return;
  const plan = planFlight(state, idx, seat);
  if (!plan.length) return;
  // A card leaving the board: blank its slot for the flight, so the eye
  // follows the flyer instead of seeing the card in two places at once.
  // (After the move lands, pendingRefill keeps the slot empty until its
  // replacement is dealt.)
  const vacated = [];
  if (idx >= 30 && idx < 60) {
    const slot = cardSlotSelector(idx);
    const el = slot && document.querySelector(slot);
    if (el) {
      el.style.visibility = "hidden";
      vacated.push(el);
    }
  }
  await Promise.all(plan.map(async (p, i) => {
    await sleep(i * 70);
    if (epoch !== sessionVersion) return;
    await fly(p.html, p.from, p.to, { size: p.size });
    if (epoch !== sessionVersion) return;
  }));
  if (epoch !== sessionVersion) return;
  for (const el of vacated) el.style.visibility = "";
}

/// After a card is taken from the display, show its replacement being dealt
/// from the deck. `before` is the display as it was prior to the move.
/// Slots whose replacement card has not been dealt yet. render() keeps these
/// blank, so a new card never flashes into place before its deal animation.
const pendingRefill = new Set();

/// Work out which slots changed, and mark them pending *before* the next
/// render paints them.
function markRefills(before) {
  if (REDUCED_MOTION || !before) return [];
  const after = currentState().display;
  const jobs = [];
  for (let t = 0; t < 3; t++) {
    for (let s = 0; s < DISPLAY_SLOTS; s++) {
      const id = after[t][s];
      if (id !== null && before[t][s] !== id) {
        jobs.push({ t, s, id });
        pendingRefill.add(`${t},${s}`);
      }
    }
  }
  return jobs;
}

async function animateRefill(jobs, epoch = sessionVersion) {
  if (epoch !== sessionVersion || REDUCED_MOTION || !jobs?.length) return;
  await Promise.all(jobs.map((j) => dealFromDeck(j.t, j.s, j.id, epoch)));
  if (epoch !== sessionVersion) return;
  for (const j of jobs) pendingRefill.delete(`${j.t},${j.s}`);
  render();
}

/// Keep both faces at the destination card's full dimensions. Only scale the
/// whole card at the deck; a narrow deck must never crop the face being dealt.
async function dealFromDeck(tier, slot, cardId, epoch = sessionVersion) {
  if (epoch !== sessionVersion || REDUCED_MOTION || cardId === null || cardId === undefined) return;
  const deck = rectOf(`[data-deck="${tier}"]`);
  const dest = rectOf(`[data-slot="${tier},${slot}"]`);
  if (!deck || !dest) return;

  const node = document.createElement("div");
  node.className = "flyer deal-flyer";
  node.dataset.tier = tier;
  node.setAttribute("aria-hidden", "true");
  node.style.left = dest.left + "px";
  node.style.top = dest.top + "px";
  node.style.width = dest.width + "px";
  node.style.height = dest.height + "px";
  const dx = deck.left + deck.width / 2 - dest.left - dest.width / 2;
  const dy = deck.top + deck.height / 2 - dest.top - dest.height / 2;
  const scale = Math.min(deck.width / dest.width, deck.height / dest.height);
  node.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
  node.innerHTML = `<div class="faces">
    <div class="face-front"><span>${["I", "II", "III"][tier]}</span></div>
    <div class="face-back">${cardHtml(cardId, {clickable:false})}</div>
  </div>`;
  $("fly").appendChild(node);
  try {
    // Commit the starting pose, then travel and reveal the complete painting.
    void node.offsetWidth;
    await sleep(30);
    if (epoch !== sessionVersion) return;
    node.style.transform = "translate(0px, 0px) scale(1)";
    await sleep(100);
    if (epoch !== sessionVersion) return;
    node.classList.add("flipped");
    await sleep(560);
  } finally {
    node.remove();
  }
}

/// The display slot an action takes a card from, if any.
function cardSlotSelector(idx) {
  if (idx >= 30 && idx < 42) {
    const t = ((idx - 30) / 4) | 0, s = (idx - 30) % 4;
    return `[data-slot="${t},${s}"]`;
  }
  if (idx >= 45 && idx < 57) {
    const t = ((idx - 45) / 4) | 0, s = (idx - 45) % 4;
    return `[data-slot="${t},${s}"]`;
  }
  return null;
}

function idxLabel(state, idx) {
  if (idx >= 77) return `pay ${LETTERS[idx - 77]}`;
  if (idx < 5) return `take ${LETTERS[idx]}`;
  if (idx < 15) { const [a, b] = PAIRS[idx - 5]; return `take ${LETTERS[a]}+${LETTERS[b]}`; }
  if (idx < 25) { const [a, b, c] = TRIPLES[idx - 15]; return `take ${LETTERS[a]}+${LETTERS[b]}+${LETTERS[c]}`; }
  if (idx < 30) return `take ${LETTERS[idx - 25]}+${LETTERS[idx - 25]}`;
  if (idx < 42) { const t = (idx - 30) / 4 | 0, s = (idx - 30) % 4; return `reserve T${t + 1} (${cardDesc(state.display[t][s])})`; }
  if (idx < 45) return `reserve T${idx - 42 + 1} deck (blind)`;
  if (idx < 57) { const t = (idx - 45) / 4 | 0, s = (idx - 45) % 4; return `select purchase T${t + 1} ${cardDesc(state.display[t][s])}`; }
  if (idx < 60) return `buy reserved ${cardDesc(state.players[state.current].reserved[idx - 57])}`;
  if (idx < 66) return `discard ${LETTERS[idx - 60]}`;
  if (idx < 76) return `take noble (+3)`;
  return "pass";
}

/// Structured log entry: a verb plus gem/card chips, so the log reads as
/// pictures rather than colour-letter codes ("take G+R+K").
function logEntry(state, idx) {
  if (idx >= 77) return { verb: "支付", html: `<span class="mini-chip">${NAMES[idx - 77]}</span>` };
  // Tokens show their count, matching how tokens read everywhere else.
  const gems = (list) => {
    const counts = {};
    for (const c of list) counts[c] = (counts[c] || 0) + 1;
    return Object.entries(counts).map(([c, n]) => gemHtml(COLORS[c], n)).join("");
  };
  // A bought/reserved card reads as "the gem it grants" + "points", so the log
  // says what the player gained rather than which slot it came from.
  const cardChip = (id, tier) => {
    if (id === null || id === undefined) {
      return `<span class="mini-chip card-chip"><span>${tier} 级暗牌</span></span>`;
    }
    const c = STATIC.cards[id];
    // A diamond matches the card's own bonus marker; it carries a ring so a
    // pale colour still reads against the chip background.
    const pts = c.points > 0 ? ` +${c.points} 分` : "";
    return `<span class="mini-chip card-chip"><span class="diamond ${COLORS[c.bonus]}"></span><span>${c.tier} 级${pts}</span></span>`;
  };
  if (idx < 5) return { verb: "取得", html: gems([idx]) };
  if (idx < 15) return { verb: "取得", html: gems(PAIRS[idx - 5]) };
  if (idx < 25) return { verb: "取得", html: gems(TRIPLES[idx - 15]) };
  if (idx < 30) return { verb: "取得", html: gems([idx - 25, idx - 25]) };
  if (idx < 42) {
    const t = (idx - 30) / 4 | 0, s = (idx - 30) % 4;
    return { verb: "预留", html: cardChip(state.display[t][s], t + 1) };
  }
  if (idx < 45) return { verb: "预留", html: cardChip(null, idx - 42 + 1) };
  if (idx < 57) {
    const t = (idx - 45) / 4 | 0, s = (idx - 45) % 4;
    return { verb: "选购", html: cardChip(state.display[t][s], t + 1) };
  }
  if (idx < 60) {
    const player = state.players[state.current], slot = idx - 57;
    return { verb: "购买", html: cardChip(player.reserved[slot], player.reserved_tiers[slot]) };
  }
  if (idx < 66) {
    const g = idx - 60;
    return { verb: "归还", html: gemHtml(g === 5 ? "y" : COLORS[g], 1) };
  }
  if (idx < 76) return { verb: "迎来贵族", html: `<span class="mini-chip">+3 分</span>` };
  return { verb: "跳过", html: "" };
}

// Noble visits can be automatic at the end of any action (including payment
// or discarding), so detect the award from state changes rather than action IDs.
const nobleNoticeTimers = new Set();
function clearNobleNotices() {
  for (const timer of nobleNoticeTimers) clearTimeout(timer);
  nobleNoticeTimers.clear();
  $("noble-notices").replaceChildren();
}
function recordNobleAwards(before, after, seat, idx) {
  const player = after.players[seat];
  const gained = player.nobles.filter(id => !before.players[seat].nobles.includes(id));
  for (const id of gained) {
    const points = STATIC.nobles[id].points;
    const automatic = idx < 66 || idx >= 76;
    // Explicit ChooseNoble already has a log entry; never count it twice.
    if (automatic) log.push({seat, verb:"自动迎来贵族", html:`<span class="mini-chip">+${points} 分</span><span class="subtle">总分 ${player.points}</span>`, fresh:true});
    const notice = document.createElement("div");
    notice.className = "noble-notice";
    notice.innerHTML = `<div><strong>${seat === humanSeat ? "你" : "对手"}${automatic ? "自动" : ""}迎来贵族</strong><span>总分 ${player.points} 分</span></div><b>+${points}<small> 分</small></b>`;
    $("noble-notices").appendChild(notice);
    const timer = setTimeout(() => { notice.remove(); nobleNoticeTimers.delete(timer); }, 5500);
    nobleNoticeTimers.add(timer);
  }
}

// ---- game flow ------------------------------------------------------------
/// The AI's turn is paced: think, reveal the move in the log, then apply it,
/// so its play reads as a sequence of moves rather than a sudden state jump.
async function aiMoves(epoch = sessionVersion) {
  if (epoch !== sessionVersion) return;
  aiMovesThisTurn = 0;
  aiThinking = game.phase() !== "GameOver" && game.current() !== humanSeat;
  render();
  try {
    while (epoch === sessionVersion && game.phase() !== "GameOver" && game.current() !== humanSeat) {
      if (!REDUCED_MOTION) await sleep(aiMovesThisTurn ? 220 : 500);
      if (epoch !== sessionVersion) return;
      const binding = {session:epoch,revision:actionRevision,actor:game.current(),phase:game.phase(),
        model_id:POLICY_BUNDLES[opponentMode]?.metadata.model_id,weights_sha256:POLICY_BUNDLES[opponentMode]?.metadata.weights_sha256};
      const idx = opponentMode === "simple" ? game.greedy_index()
        : LOCAL_GAME ? (await requestLocalAction(opponentMode,JSON.parse(game.observation_json(game.current())),Array.from(game.mask()),binding,'opponent')).index
        : await choosePolicyAction(opponentMode,game.encode(),game.mask(),binding);
      if (epoch !== sessionVersion) return;
      if (binding.revision !== actionRevision || binding.actor !== game.current() || binding.phase !== game.phase()) throw new Error("局面已变化，已丢弃旧行动。");
      if (!Array.from(game.legal_indices()).includes(idx)) throw new Error("对手返回了不可执行的行动。");
      const state = currentState(), seat = game.current();
      const before = state.display.map(row => row.slice());
      await animateMove(state, idx, seat, epoch);
      if (epoch !== sessionVersion) return;
      log.push({ seat, ...logEntry(state, idx), fresh: true });
      aiMovesThisTurn++;
      game.apply_index(idx);
      invalidateHint();
      recordNobleAwards(state, currentState(), seat, idx);
      const refills = markRefills(before);
      refreshLegal(); render();
      await animateRefill(refills, epoch);
    }
  } catch (error) {
    if (epoch === sessionVersion) gameError = "对手暂时无法继续：" + error.message + " 请在设置中新开一局。";
  } finally {
    if (epoch === sessionVersion) { aiThinking = false; render(); }
  }
}

function refreshLegal() {
  legalSet = new Set(Array.from(game.legal_indices()));
  // Assign each newly visible card once, before rendering or refill animation.
  // Only the human observation is used; opponent dark reserves stay unknown.
  cardArt.syncVisible(currentState());
}

function applyHuman(idx) {
  if (turnDeadline && Date.now() >= turnDeadline) { void expireHumanTurn(); return false; }
  if (!legalSet.has(idx) || aiThinking || humanBusy || gameError || game.current() !== humanSeat) return false;
  const epoch = sessionVersion, state = currentState();
  const before = state.display.map(row => row.slice());
  humanBusy = true;
  const flight = animateMove(state, idx, humanSeat, epoch);
  try { game.apply_index(idx); }
  catch (error) { humanBusy = false; gameError = error.message; render(); return false; }
  invalidateHint();
  log.push({ seat: humanSeat, ...logEntry(state, idx), fresh: true });
  recordNobleAwards(state, currentState(), humanSeat, idx);
  const refills = markRefills(before);
  sel = { colors: [], double: false }; selectedCard = null;
  hidePopover(); refreshLegal(); render();
  flight.then(async () => {
    if (epoch !== sessionVersion) return;
    await animateRefill(refills, epoch);
    if (epoch !== sessionVersion) return;
    humanBusy = false;
    if (game.phase() === "Play" || game.phase() === "GameOver") await aiMoves(epoch);
    if (epoch !== sessionVersion) return;
    tutorialOnMove(); render();
  }).catch(error => {
    if (epoch !== sessionVersion) return;
    humanBusy = false; gameError = error.message; render();
  });
  return true;
}

/// A task step completes when the board reaches the state it asked for. This
/// is checked after every move, so a step can span several turns (e.g. "keep
/// taking gems until you can afford a card").
function tutorialOnMove() {
  const step = TUTORIAL[tutorialStep];
  if (step?.done && step.done(currentState())) advanceTutorial();
}

function newGame(seat, opponent = opponentMode, timeLimit = turnLimitSeconds) {
  opponent = normalizeOpponent(opponent);
  if (!cardArt) cardArt = SplendorCardArt.create(STATIC.cards, CARD_ART_MANIFEST);
  sessionVersion++;
  cancelPolicyRequests();
  invalidateHint();
  turnLimitSeconds = Number.isFinite(timeLimit) && timeLimit >= 5 ? Math.min(1800, Math.round(timeLimit / 5) * 5) : 0;
  resetTurnClock();
  ownedCardsOpen = false; ownedCardsScroll = 0;
  humanBusy = false; aiThinking = false; gameError = "";
  pendingRefill.clear(); $("fly").innerHTML = ""; clearNobleNotices(); hidePopover();
  if (game) game.free();
  const seed = new Uint32Array(2); crypto.getRandomValues(seed);
  game = new wasm_bindgen.WasmGame(2, (BigInt(seed[0]) << 32n) | BigInt(seed[1]));
  humanSeat = seat; opponentMode = opponent;
  try { localStorage.setItem(opponentPrefKey,opponentMode); } catch {}
  cardArt.reset();
  log = []; aiMovesThisTurn = 0; selectedCard = null; actionMode = "take";
  sel = { colors: [], double: false };
  refreshLegal(); render();
  aiMoves(sessionVersion);
}

// ---- interactions ---------------------------------------------------------
function pileClick(c) {
  const state = currentState();
  if (state.phase !== "Play" || game.current() !== humanSeat || aiThinking || humanBusy || gameError) return;
  if (state.bank[c] === 0 || c >= 5) return;
  selectedCard = null; actionMode = "take";
  const i = sel.colors.indexOf(c);
  if (sel.double) sel = i >= 0 ? { colors: [], double: false } : { colors: [c], double: false };
  else if (i >= 0) {
    if (sel.colors.length === 1 && legalSet.has(25 + c)) sel.double = true;
    else sel.colors.splice(i, 1);
  } else if (sel.colors.length < 3) sel.colors.push(c);
  render();
}

function confirmTake() {
  if (sel.colors.length) applyHuman(takeIndex(sel));
}

function tokenClick(g) {
  if (game.phase() === "Discard") applyHuman(discardIdx(g));
  if (game.phase() === "PayCard") applyHuman(77 + g);
}

function nobleClick(id) {
  if (game.phase() === "ChooseNoble") applyHuman(nobleIdx(id));
}

function missingFor(state, cardId) {
  const p = state.players[humanSeat];
  const c = STATIC.cards[cardId];
  let miss = 0;
  for (let i = 0; i < 5; i++) miss += Math.max(0, c.cost[i] - p.bonuses[i] - p.tokens[i]);
  return Math.max(0, miss - p.tokens[5]);
}

function goldClick(ev) {
  const pop = $("popover");
  pop.innerHTML = '<p class="title">黄金 · 万能筹码</p><p class="note">购买时可用黄金代替任意颜色。黄金不能直接从银行领取：预留一张牌时，若银行还有黄金，即可获得一枚。</p>';
  pop.style.display = "block";
  const r = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(ev.clientX + 8, innerWidth - r.width - 8)) + "px";
  pop.style.top = Math.max(8, Math.min(ev.clientY + 8, innerHeight - r.height - 8)) + "px";
  ev.stopPropagation();
}

function showPopover(ev, title, actions) {
  const pop = $("popover");
  pop.innerHTML = `<p class="title">${title}</p>`;
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.textContent = a.label;
    btn.disabled = !a.idx || !legalSet.has(a.idx);
    if (btn.disabled && a.why) {
      const why = document.createElement("div");
      why.className = "why";
      why.textContent = a.why;
      btn.appendChild(why);
    }
    if (!btn.disabled) btn.addEventListener("click", () => applyHuman(a.idx));
    pop.appendChild(btn);
  }
  pop.style.display = "block";
  const r = pop.getBoundingClientRect();
  pop.style.left = Math.min(ev.clientX + 8, innerWidth - r.width - 8) + "px";
  pop.style.top = Math.min(ev.clientY + 8, innerHeight - r.height - 8) + "px";
  ev.stopPropagation();
}
function hidePopover() { $("popover").style.display = "none"; }
document.addEventListener("click", (ev) => {
  if (!$("popover").contains(ev.target)) hidePopover();
});

function canSelectCard() {
  return game.phase() === "Play" && game.current() === humanSeat && !aiThinking && !humanBusy && !gameError;
}
function displayCardClick(ev, t, s) {
  if (!canSelectCard()) return;
  const id = currentState().display[t][s];
  if (id === null) return;
  selectedCard = { type:"display", id, t, s };
  if (actionMode === "take") actionMode = "buy";
  sel = { colors: [], double: false }; render();
}
function deckClick(ev, t) {
  if (!canSelectCard() || currentState().deck_sizes[t] === 0) return;
  selectedCard = { type:"deck", id:null, t };
  actionMode = "reserve"; sel = { colors: [], double: false }; render();
}
function reservedCardClick(ev, i) {
  if (!canSelectCard()) return;
  const id = currentState().players[humanSeat].reserved[i];
  if (id === null || id === undefined) return;
  selectedCard = { type:"reserved", id, i };
  actionMode = "buy"; sel = { colors: [], double: false }; render();
}

// ---- rendering ------------------------------------------------------------
function gem(cls, n, extra = "") {
  return `<span class="gem ${cls} ${extra}">${n}</span>`;
}
function bonus(cls, n, extra = "") {
  return `<span class="requirement" ${extra}><span class="diamond ${cls}"></span><span>${n}</span></span>`;
}
function cardHtml(id, { mini = false, clickable = false } = {}) {
  const cls = mini ? "card mini" : "card";
  if (id === null || id === undefined) return `<div class="${cls} empty" aria-label="空牌位"></div>`;
  const c = STATIC.cards[id];
  const art = cardArt.get(id);
  const entries = c.cost.map((n,i) => n ? gem(COLORS[i],n) : "").filter(Boolean);
  const costText = c.cost.map((n,i)=>n ? NAMES[i]+n+"枚" : "").filter(Boolean).join("、");
  return `<div class="${cls} ${clickable ? "clickable" : ""}" data-card="${id}" aria-label="${cardDesc(id)}，费用：${costText || "免费"}" title="${cardDesc(id)} · ${costText || "免费"}">
    <div class="band"><span class="pts">${c.points}<small>分</small></span><span class="diamond ${COLORS[c.bonus]}" title="${NAMES[c.bonus]}永久折扣"></span></div>
    <div class="art" aria-hidden="true" data-art-key="${art.key}"></div>
    <div class="body"><div class="costs${entries.length >= 4 ? " dense" : ""}">${entries.join("") || '<span class="subtle">免费</span>'}</div></div>
  </div>`;
}
function ownedCardsHtml(player) {
  return `<div id="owned-cards" class="owned-cards"><button id="owned-cards-toggle" type="button" aria-expanded="${ownedCardsOpen}" aria-controls="owned-cards-panel" aria-haspopup="dialog"><span class="owned-cards-icon" aria-hidden="true"></span><span>已购卡牌</span><span class="owned-cards-count">${player.owned.length} 张</span><span class="owned-cards-chevron" aria-hidden="true">›</span></button></div>`;
}
function positionOwnedCardsPanel() {
  const panel = $("owned-cards-panel"), owner = document.querySelector(".player.you");
  if (!ownedCardsOpen || !owner) return;
  const anchor = owner.getBoundingClientRect(), box = panel.getBoundingClientRect();
  const left = anchor.right + 12 + box.width <= innerWidth - 12
    ? anchor.right + 12 : (innerWidth - box.width) / 2;
  panel.style.left = Math.max(12, Math.min(ownedCardsPosition?.x ?? left, innerWidth - box.width - 12)) + "px";
  panel.style.top = Math.max(12, Math.min(ownedCardsPosition?.y ?? anchor.top, innerHeight - box.height - 12)) + "px";
}
function setOwnedCardsOpen(open, restoreFocus = false) {
  ownedCardsOpen = open;
  $("owned-cards-panel").hidden = !open;
  $("owned-cards-toggle")?.setAttribute("aria-expanded", String(open));
  if (open) {
    positionOwnedCardsPanel();
    $("owned-cards-close").focus({preventScroll:true});
  } else if (restoreFocus) $("owned-cards-toggle")?.focus({preventScroll:true});
}
function renderOwnedCards(player) {
  const cardPoints = player.owned.reduce((sum, id) => sum + STATIC.cards[id].points, 0);
  const noblePoints = player.nobles.reduce((sum, id) => sum + STATIC.nobles[id].points, 0);
  $("owned-panel-count").textContent = player.owned.length + " 张";
  $("owned-score").textContent = `发展牌 ${cardPoints} 分 · 贵族 ${noblePoints} 分`;
  $("owned-card-grid").innerHTML = player.owned.map(id => `<div role="listitem">${cardHtml(id, {mini:true})}</div>`).join("");
  $("owned-card-grid").hidden = !player.owned.length;
  $("owned-cards-empty").hidden = !!player.owned.length;
  $("owned-cards-panel").hidden = !ownedCardsOpen;
  if (ownedCardsOpen) $("owned-card-grid").scrollTop = ownedCardsScroll;
  $("owned-cards-toggle").onclick = () => setOwnedCardsOpen(!ownedCardsOpen);
}
function initOwnedCardsPanel() {
  const panel = $("owned-cards-panel"), heading = $("owned-cards-heading");
  heading.onpointerdown = event => {
    if (event.button !== 0 || !event.isPrimary || event.target.closest("button")) return;
    const rect = panel.getBoundingClientRect();
    ownedCardsDrag = {id:event.pointerId, x:event.clientX, y:event.clientY, left:rect.left, top:rect.top};
    heading.setPointerCapture(event.pointerId);
  };
  heading.onpointermove = event => {
    const drag = ownedCardsDrag;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) <= 5 && !panel.classList.contains("dragging")) return;
    panel.classList.add("dragging");
    ownedCardsPosition = {x:drag.left + dx, y:drag.top + dy};
    positionOwnedCardsPanel();
  };
  const endDrag = event => {
    if (ownedCardsDrag?.id !== event.pointerId) return;
    const rect = panel.getBoundingClientRect();
    if (panel.classList.contains("dragging")) ownedCardsPosition = {x:rect.left, y:rect.top};
    ownedCardsDrag = null; panel.classList.remove("dragging");
  };
  heading.onpointerup = endDrag; heading.onpointercancel = endDrag; heading.onlostpointercapture = endDrag;
  heading.onkeydown = event => {
    if (event.target !== heading) return;
    const delta = {ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]}[event.key];
    if (!delta) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    ownedCardsPosition = {x:rect.left + delta[0], y:rect.top + delta[1]};
    positionOwnedCardsPanel();
  };
  $("owned-cards-close").onclick = () => setOwnedCardsOpen(false, true);
  document.addEventListener("pointerdown", event => {
    if (ownedCardsOpen && !event.target.closest("#owned-cards-panel, #owned-cards-toggle")) setOwnedCardsOpen(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && ownedCardsOpen && !$("settings-dialog").open) {
      event.preventDefault(); setOwnedCardsOpen(false, true);
    }
  });
  window.addEventListener("resize", positionOwnedCardsPanel);
  window.addEventListener("scroll", event => {
    if (!$("owned-cards-panel").contains(event.target)) positionOwnedCardsPanel();
  }, {capture:true, passive:true});
}
function backHtml(tier, mini = true) {
  return `<div class="card back ${mini ? "mini" : ""}" aria-label="${tier}级暗预留"><span class="tier-no">${["","I","II","III"][tier] || "?"}</span><small>暗预留</small></div>`;
}
function wireAction(el, handler) {
  if (!el) return;
  el.addEventListener("click",handler);
  if (el.tagName !== "BUTTON") {
    el.tabIndex = 0; el.setAttribute("role","button");
    el.addEventListener("keydown",ev=>{if(ev.key === "Enter" || ev.key === " "){ev.preventDefault();handler(ev);}});
  }
}
function selectedAction() {
  if (!selectedCard) return null;
  if (selectedCard.type === "deck") return reserveDeckIdx(selectedCard.t);
  if (selectedCard.type === "reserved") return actionMode === "buy" ? buyReservedIdx(selectedCard.i) : null;
  return actionMode === "reserve" ? reserveDisplayIdx(selectedCard.t,selectedCard.s) : buyDisplayIdx(selectedCard.t,selectedCard.s);
}
function renderAction(state, active) {
  const phase = game.phase(), p = state.players[humanSeat];
  const content = $("action-content"), bar = $("selbar");
  bar.innerHTML = "";
  $("turn-label").textContent = phase === "GameOver" ? "对局结束" : active ? "轮到你了" : gameError ? "已暂停" : "请稍候";
  document.querySelectorAll("[data-mode]").forEach(el=>{
    el.classList.toggle("active",el.dataset.mode === actionMode);
    el.setAttribute("aria-selected",String(el.dataset.mode === actionMode));
    el.disabled = !active || phase !== "Play";
  });
  if (phase === "GameOver") { content.innerHTML = '<p class="action-hint">本局已经结束。点击右上角「新对局」，再来一盘。</p>'; return; }
  if (gameError) { content.innerHTML = '<p class="action-hint">对局已暂停。请打开设置查看对手选项，并开始新对局。</p>'; return; }
  if (phase === "PayCard" && state.current === humanSeat) {
    const pending = state.pending_purchase;
    const next = pending.remaining_cost.findIndex(n=>n>0);
    content.innerHTML = `<p class="action-title">支付购牌费用</p><div class="action-detail">${cardHtml(pending.card_id,{mini:true})}<div><p class="subtle">尚需支付</p><div class="payment-row">${pending.remaining_cost.map((n,i)=>n?gem(COLORS[i],n):"").join("")}</div></div></div><p class="action-hint">本枚支付${NAMES[next]}筹码；高亮黄金可替代。付清后获得卡牌。</p><div class="phase-actions">${p.tokens.map((n,i)=>legalSet.has(77+i)?`<button class="gem ${i===5?"y":COLORS[i]}" data-pay="${i}" title="支付一枚${NAMES[i]}" aria-label="支付一枚${NAMES[i]}" ${!active?"disabled":""}>${n}</button>`:"").join("")}</div>`;
    content.querySelectorAll("[data-pay]").forEach(el=>el.onclick=()=>tokenClick(+el.dataset.pay)); return;
  }
  if (phase === "Discard" && state.current === humanSeat) {
    const excess = p.tokens.reduce((a,b)=>a+b,0)-10;
    content.innerHTML = `<p class="action-title">需归还 ${excess} 枚筹码</p><p class="action-hint">持有上限为 10 枚。可归还刚取得的筹码。</p><div class="phase-actions">${p.tokens.map((n,i)=>legalSet.has(discardIdx(i))?`<button class="gem ${i===5?"y":COLORS[i]}" data-return="${i}" title="归还一枚${NAMES[i]}" aria-label="归还一枚${NAMES[i]}" ${!active?"disabled":""}>${n}</button>`:"").join("")}</div>`;
    content.querySelectorAll("[data-return]").forEach(el=>el.onclick=()=>tokenClick(+el.dataset.return)); return;
  }
  if (phase === "ChooseNoble" && state.current === humanSeat) {
    content.innerHTML = '<p class="action-title">选择一位贵族</p><p class="action-hint">你已达到多位贵族的要求。点击牌桌上高亮的一位，本回合只能获得一位贵族。</p>'; return;
  }
  if (!active) { content.innerHTML = `<p class="action-title">${humanBusy?"行动结算中":"对手正在行动"}<span class="thinking"><span></span><span></span><span></span></span></p><p class="action-hint">可以先看看下一张想购买的牌。</p>`; return; }
  if (actionMode === "take") {
    const count=sel.double?2:sel.colors.length;
    content.innerHTML=`<p class="action-title">${count?"已选 "+count+" 枚":"选择你的筹码"}</p><div class="action-selection">${count?(sel.double?gem(COLORS[sel.colors[0]],2):sel.colors.map(c=>gem(COLORS[c],1)).join("")):'<span class="selection-empty" aria-hidden="true">○ ○ ○</span>'}</div><p class="action-hint">取 3 种不同颜色；同色余量至少 4 枚时，可取 2 枚。再次点击同色可切换。</p>`;
    const valid=count>0&&legalSet.has(takeIndex(sel));
    bar.innerHTML=`<button id="confirm-take" ${valid?"":"disabled"}>确认取币</button><button id="clear-take" class="ghost" ${count?"":"disabled"}>清空</button>`;
    $("confirm-take").onclick=confirmTake;
    $("clear-take").onclick=()=>{sel={colors:[],double:false};render();}; return;
  }
  if (!selectedCard) {
    content.innerHTML=`<p class="action-title">${actionMode==="buy"?"选择一张发展牌":"预留喜欢的卡牌"}</p><p class="action-hint">${actionMode==="buy"?"点击公开牌或自己的预留牌，查看折扣后的费用。":"点击公开牌，或点击牌堆暗预留。最多预留 3 张，银行有黄金时可获得 1 枚。"}</p>`; return;
  }
  const id=selectedCard.id, idx=selectedAction(), allowed=idx!==null&&legalSet.has(idx);
  const art=id===null?backHtml(selectedCard.t+1):cardHtml(id,{mini:true});
  let detail="", label="";
  if(actionMode==="buy"&&id!==null) {
    const c=STATIC.cards[id], due=c.cost.map((n,i)=>Math.max(0,n-p.bonuses[i]));
    detail=`<p class="subtle">永久折扣后</p><div class="payment-row">${due.map((n,i)=>n?gem(COLORS[i],n):"").join("")||'<span class="subtle">无需支付筹码</span>'}</div><p class="action-hint">${allowed?"购买后逐枚支付，可选择黄金。":"还缺 "+missingFor(state,id)+" 枚筹码。"}</p>`; label="购买并支付";
  } else {
    detail=`<p class="subtle">预留 ${p.reserved.length} / 3</p><p class="action-hint">${selectedCard.type==="reserved"?"这张牌已在你的预留区。":p.reserved.length>=3?"预留已满，请先购买预留牌。":state.bank[5]>0?"预留后获得 1 枚黄金。":"黄金已取完，仍可预留。"}</p>`; label="确认预留";
  }
  content.innerHTML=`<p class="action-title">${id===null?(selectedCard.t+1)+" 级牌堆 · 暗预留":cardDesc(id)}</p><div class="action-detail">${art}<div>${detail}</div></div>`;
  bar.innerHTML=`<button id="confirm-card" ${allowed?"":"disabled"}>${label}</button><button id="clear-card" class="ghost">取消</button>`;
  $("confirm-card").onclick=()=>{if(idx!==null)applyHuman(idx);};
  $("clear-card").onclick=()=>{selectedCard=null;render();};
}
function render() {
  if (!game || !STATIC) return;
  const state=currentState(), phase=game.phase(), over=phase==="GameOver";
  const active=!over&&state.current===humanSeat&&!aiThinking&&!humanBusy&&!gameError;
  const hints=[];
  if(gameError) hints.push(gameError);
  else if(state.final_round_triggered&&!over) hints.push("最后一轮：有人达到 15 分，补齐本轮后结算。");
  $("status").textContent=hints.join(" ");
  $("status").classList.toggle("empty",!hints.length);
  $("round").textContent=over?"对局结束":`第 ${state.round+1} 回合`;
  $("nobles").innerHTML=state.nobles.map(id=>{
    const n=STATIC.nobles[id], choosable=active&&phase==="ChooseNoble"&&legalSet.has(nobleIdx(id));
    return `<div class="noble ${choosable?"choosable":""}" data-noble="${id}" aria-label="贵族，${n.points}分，永久折扣要求${n.req.map((v,i)=>v?NAMES[i]+v:"").filter(Boolean).join("、")}"><div class="band"><span class="pts">${n.points}<small>分</small></span><span class="tag">贵族</span></div><div class="reqs">${n.req.map((v,i)=>v?bonus(COLORS[i],v):"").join("")}</div></div>`;
  }).join("");
  $("tiers").innerHTML=[2,1,0].map(t=>{
    const slots=state.display[t].map((id,s)=>{
      let html=cardHtml(pendingRefill.has(`${t},${s}`)?null:id);
      let classes="";
      if(id!==null&&active&&legalSet.has(buyDisplayIdx(t,s)))classes+=" affordable";
      if(selectedCard?.type==="display"&&selectedCard.t===t&&selectedCard.s===s)classes+=" selected";
      return html.replace('class="card',`data-slot="${t},${s}" class="card${classes}`);
    }).join("");
    return `<div class="tier"><div class="deck" data-deck="${t}" aria-label="${t+1}级牌堆，余${state.deck_sizes[t]}张"><span class="face"></span><span class="tier-no">${["I","II","III"][t]}</span><span class="tier-label">${t+1}级牌堆</span><span class="count">余 ${state.deck_sizes[t]} 张</span></div><div class="slots">${slots}</div></div>`;
  }).join("");
  $("bank").innerHTML=state.bank.map((n,i)=>{
    const gold=i===5, selected=!gold&&sel.colors.includes(i), double=selected&&sel.double;
    return `<button type="button" class="pile ${gold?"gold":""} ${selected?"selected":""} ${n===0?"depleted":""}" ${gold?'data-gold="1"':`data-pile="${i}"`} aria-label="${NAMES[i]}筹码，余${n}枚${selected?"，已选":""}" ${!gold&&(!active||phase!=="Play"||n===0)?"disabled":""}><span class="gem ${gold?"y":COLORS[i]}" aria-hidden="true"></span><span class="bank-count">${n}</span><span class="n">${NAMES[i]}${gold?'<span class="note"> · 预留获得</span>':""}</span>${double?'<span class="x2">×2</span>':""}</button>`;
  }).join("");
  if (ownedCardsOpen && $("owned-card-grid")) ownedCardsScroll = $("owned-card-grid").scrollTop;
  const ownedToggleFocused = document.activeElement?.id === "owned-cards-toggle";
  $("players").innerHTML=state.players.map((p,i)=>{
    const you=i===humanSeat, cur=!over&&i===state.current, held=p.tokens.reduce((a,b)=>a+b,0);
    const tokens=p.tokens.map((n,g)=>{
      const enabled=you&&active&&((phase==="Discard"&&legalSet.has(discardIdx(g)))||(phase==="PayCard"&&legalSet.has(77+g)));
      return `<div class="resource-cell ${n?"":"zero"}"><button class="gem token-btn ${g===5?"y":COLORS[g]} ${enabled?"discardable":""}" data-token="${g}" aria-label="${NAMES[g]} ${n} 枚" ${enabled?"":"disabled"}></button><span class="token-count">${n}</span></div>`;
    }).join("");
    const bonuses=p.bonuses.map((n,c)=>`<div class="resource-cell ${n?"":"zero"}" ${you?`data-bonus="${c}"`:""} title="${NAMES[c]}永久折扣 ${n}"><span class="diamond ${COLORS[c]}"></span><span>${n}</span></div>`).join("");
    let reserved=p.reserved.map((id,ri)=>id===null?backHtml(p.reserved_tiers[ri]):cardHtml(id,{mini:true,clickable:you}).replace("data-card",`data-reserved="${you?ri:""}" data-card`)).join("");
    if(you) reserved+=Array.from({length:3-p.reserved.length},()=>'<span class="reserve-placeholder" aria-label="空预留位">+</span>').join("");
    else if(!p.reserved.length)reserved='<span class="subtle">暂无</span>';
    return `<section class="player ${you?"you":"opponent"} ${cur?"current":""}" data-seat="${i}" aria-label="${you?"你":opponentName()}"><div class="player-head"><span class="name">${you?"你":opponentName()}</span><span class="score">${p.points}<small>分</small></span>${cur?`<span class="turn-pill">${you?"你的回合":aiThinking?"思考中":"对手回合"}</span>`:""}<span class="owned-note">${p.owned.length} 张发展牌 · ${p.nobles.length} 位贵族</span></div><div class="resource"><span class="lbl">持有筹码 <strong>${held}/10</strong></span><div class="vals">${tokens}</div></div><div class="resource"><span class="lbl">永久折扣</span><div class="vals">${bonuses}</div></div><div class="resource reserve-resource"><span class="lbl">预留 <strong>${p.reserved.length}/3</strong></span><div class="vals">${reserved}</div></div>${you ? ownedCardsHtml(p) : ""}</section>`;
  }).join("");
  renderOwnedCards(state.players[humanSeat]);
  if (ownedToggleFocused) $("owned-cards-toggle").focus({preventScroll:true});
  renderAction(state,active);
  $("pass-wrap").innerHTML=active&&phase==="Play"&&legalSet.has(PASS_IDX)?'<button id="pass-btn">无可行动作 · 跳过</button>':"";
  $("pass-btn")?.addEventListener("click",()=>applyHuman(PASS_IDX));
  const logEl=$("log");
  logEl.innerHTML=log.slice(-18).map((m,i,arr)=>`<li class="${m.fresh&&i===arr.length-1?"fresh":""}"><span class="actor ${m.seat===humanSeat?"you":"ai"}">${m.seat===humanSeat?"你":"对手"}</span><span class="verb">${m.verb}</span>${m.html}</li>`).join("");
  logEl.scrollTop=logEl.scrollHeight;
  $("log-empty").hidden=log.length>0;
  log.forEach(m=>m.fresh=false);
  if(over) {
    const winners=Array.from(game.winners()), msg=winners.length===1?(winners[0]===humanSeat?"你赢了！":"对手获胜"):"本局平局";
    const scores=state.players.map((p,i)=>`${i===humanSeat?"你":"对手"} ${p.points} 分 / ${p.owned.length} 张牌`).join(" · ");
    $("banner").innerHTML=`<div class="banner">${msg}　${scores}</div>`;
  } else $("banner").innerHTML="";
  document.querySelectorAll("[data-pile]").forEach(el=>el.onclick=()=>pileClick(+el.dataset.pile));
  document.querySelectorAll("[data-gold]").forEach(el=>el.onclick=goldClick);
  document.querySelectorAll("[data-slot]").forEach(el=>{const[t,s]=el.dataset.slot.split(",").map(Number);wireAction(el,ev=>displayCardClick(ev,t,s));});
  document.querySelectorAll("[data-deck]").forEach(el=>wireAction(el,ev=>deckClick(ev,+el.dataset.deck)));
  document.querySelectorAll(".player.you [data-token]").forEach(el=>el.onclick=()=>tokenClick(+el.dataset.token));
  document.querySelectorAll("[data-noble]").forEach(el=>{if(active&&phase==="ChooseNoble"&&legalSet.has(nobleIdx(+el.dataset.noble)))wireAction(el,()=>nobleClick(+el.dataset.noble));});
  document.querySelectorAll("[data-reserved]").forEach(el=>{if(el.dataset.reserved!=="")wireAction(el,ev=>{ev.stopPropagation();reservedCardClick(ev,+el.dataset.reserved);});});
  positionOwnedCardsPanel();
  syncTurnClock();
  refreshCompanionControls();
  const tutTarget=TUTORIAL[tutorialStep]?.target;
  if(tutorialStep>=0&&tutTarget){const selector=typeof tutTarget==="function"?tutTarget():tutTarget;const el=selector&&document.querySelector(selector);if(el)el.classList.add("tut-target");}
}

/*__TUTORIAL_JS__*/
// ---- self-test ------------------------------------------------------------
async function selfTest() {
  const checks = [];
  const ok = (name, cond) => checks.push([name, !!cond]);
  // A move now runs: player's flight → AI's turn → back to the player. Wait
  // for the whole handoff, including the gap before the AI starts moving.
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      if (!aiThinking && !humanBusy && game.current() === humanSeat) break;
    }
    for (let i = 0; i < 60 && (aiThinking || humanBusy); i++) await sleep(100);
  };
  try {
    ok("legal set non-empty", legalSet.size > 0);
    const state0 = JSON.parse(game.observation_json(humanSeat));
    // Build a 3-distinct take via pile clicks.
    const avail = [0, 1, 2, 3, 4].filter((c) => state0.bank[c] > 0).slice(0, 3);
    const logLen = log.length;
    for (const c of avail) pileClick(c);
    ok("triple selection waits for confirmation", log.length === logLen && sel.colors.length === 3);
    confirmTake();
    ok("triple take applies on confirmation", log.length > logLen);
    await settle();
    ok("back on human turn or game over", game.phase() === "GameOver" || game.current() === humanSeat);
    ok("log entries carry icons", log.some((m) => m.verb && typeof m.html === "string"));
    // Popover on first present display card.
    const state1 = JSON.parse(game.observation_json(humanSeat));
    outer: for (let t = 0; t < 3; t++) {
      for (let s = 0; s < 4; s++) {
        if (state1.display[t][s] !== null) {
          displayCardClick({ clientX: 200, clientY: 200, stopPropagation: () => {} }, t, s);
          break outer;
        }
      }
    }
    ok("card selection appears in action panel", !!selectedCard && !!$("confirm-card"));
    hidePopover();
    // Reserve via popover action path.
    const state2 = JSON.parse(game.observation_json(humanSeat));
    let reserveIdx = null;
    for (const idx of legalSet) if (idx >= 30 && idx < 42) { reserveIdx = idx; break; }
    if (reserveIdx !== null) {
      const before = state2.players[humanSeat].reserved.length;
      applyHuman(reserveIdx);
      await settle();
      ok("reserve applied", JSON.parse(game.observation_json(humanSeat)).players[humanSeat].reserved.length === before + 1
        || game.phase() !== "Play");
    }
    // Tutorial renders and highlights without throwing.
    tutorialStep = 1;
    renderTutorial();
    ok("tutorial step renders", $("tutorial").classList.contains("on")
      && document.querySelectorAll(".tut-target").length === 1);

    // Every step renders without throwing, including the ones whose copy is
    // computed from the live board.
    let renderedAll = true;
    for (let i = 0; i < TUTORIAL.length; i++) {
      tutorialStep = i;
      try {
        renderTutorial();
        if (!$("tutorial").querySelector("h3")?.textContent) renderedAll = false;
      } catch (e) {
        renderedAll = false;
      }
    }
    ok("all tutorial steps render", renderedAll);

    // Interactive step: a real take should advance it, and the waiting badge
    // should be shown instead of a Next button while it is pending.
    const takeStep = TUTORIAL.findIndex((s) => s.done);
    tutorialStep = takeStep;
    renderTutorial();
    ok("task step waits for a move",
      !$("tut-next") && $("tutorial").querySelector(".waiting") !== null);
    const st = JSON.parse(game.observation_json(humanSeat));
    const cols = [0, 1, 2, 3, 4].filter((c) => st.bank[c] > 0).slice(0, 3);
    if (game.current() === humanSeat && cols.length === 3) {
      for (const c of cols) pileClick(c);
      confirmTake();
      await settle();
      ok("real move advances the tutorial", tutorialStep > takeStep || tutorialStep === -1);
    }
    tutorialStep = -1;
    renderTutorial();
    ok("render intact", document.querySelectorAll(".card").length > 0);
  } catch (e) {
    checks.push([`exception: ${e}`, false]);
  }
  const failed = checks.filter(([, c]) => !c);
  $("banner").innerHTML = failed.length
    ? `<div class="error">SELFTEST FAIL: ${failed.map(([n]) => n).join("; ")}</div>`
    : `<div class="banner">SELFTEST PASS (${checks.length} checks)</div>`;
}

function updateOpponentNote() {
  const mode = normalizeOpponent($("opponent-select").value);
  $("opponent-note").textContent = mode === "simple"
    ? "使用规则与即时收益选择行动，适合熟悉玩法。"
    : LOCAL_GAME ? localModelNote(mode)
    : `原版 Transformer · seed422 · 累计${mode === 'transformer100m' ? '1亿' : '2亿'}训练样本。模型在本地运行，无需联网。`;
}
function openSettings() {
  $("turn-limit-enabled").checked = turnLimitSeconds > 0;
  $("turn-limit-range").value = turnLimitSeconds || 60;
  updateTurnLimitSetting();
  $("opponent-select").value=opponentMode;
  document.querySelector(`input[name="seat"][value="${humanSeat}"]`).checked=true;
  $("settings-error").textContent="";updateOpponentNote();
  $("settings-dialog").showModal();
}
/*__HINT_FORMAT_JS__*/
/*__COMPANION_JS__*/

(async()=>{
  try {
    await wasm_bindgen({module_or_path:b64ToBytes(WASM_B64).buffer});
    STATIC=JSON.parse(wasm_bindgen.static_data_json());
    if(LOCAL_GAME)await initLocalGame();
    $("settings-btn").onclick=openSettings;$("new-game-btn").onclick=openSettings;
    $("settings-close").onclick=()=>{$("settings-dialog").close();};
    $("settings-cancel").onclick=()=>{$("settings-dialog").close();};
    $("opponent-select").onchange=updateOpponentNote;
    $("turn-limit-enabled").onchange=updateTurnLimitSetting;
    $("turn-limit-range").oninput=updateTurnLimitSetting;
    $("settings-form").onsubmit=ev=>{
      ev.preventDefault();
      try {
        const seat=+document.querySelector('input[name="seat"]:checked').value;
        newGame(seat,$("opponent-select").value,$("turn-limit-enabled").checked ? Number($("turn-limit-range").value) : 0);
        tutorialStep=-1;renderTutorial();$("settings-dialog").close();
      } catch(error) {$("settings-error").textContent=error.message;}
    };
    document.querySelectorAll("[data-mode]").forEach(el=>el.onclick=()=>{
      if(!canSelectCard())return;
      actionMode=el.dataset.mode;
      if(actionMode!=="take")sel={colors:[],double:false};
      if(actionMode==="buy"&&selectedCard?.type==="deck")selectedCard=null;
      render();
    });
    $("tutorial-btn").onclick=()=>{tutorialStep=0;renderTutorial();};
    const params=new URLSearchParams(location.search);
    newGame(params.get("ai")==="first"?1:0);
    initCompanion();
    initOwnedCardsPanel();
    if(params.get("tutorial")==="1"){tutorialStep=0;renderTutorial();}
    if(params.has("selftest")){
      while(aiThinking||humanBusy)await sleep(50);
      selfTest();
    }
  } catch(error) {
    $("banner").innerHTML='<div class="error"></div>';
    $("banner").firstElementChild.textContent="启动失败："+error.message;
    console.error(error);
  }
})();
