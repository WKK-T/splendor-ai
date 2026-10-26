// ---- tutorial -------------------------------------------------------------
// Explain the real board, then advance only after the requested action has
// completed. The ordinary game continues when the walkthrough is dismissed.
const TUTORIAL_COLOURS = ["白色", "蓝色", "绿色", "红色", "黑色", "黄金"];
const TUTORIAL = [
  {
    title: "先取一些筹码",
    body: "通常可以取 <b>3 种不同颜色</b>，或从至少有 4 枚的同色筹码堆取 <b>2 枚同色</b>。点击筹码预选，再点<b>确认取币</b>；确认前可以清空重选。可取颜色不足 3 种时，按现有颜色取币。",
    target: ".bank-panel",
    hint: "预选银行筹码，再点确认取币",
    done: (s) => s.players[humanSeat].tokens.some((n) => n > 0),
  },
  {
    title: "用筹码购买发展牌",
    body: () => {
      const t1 = firstTierOneCard();
      const cost = t1
        ? STATIC.cards[t1.id].cost
            .map((n, i) => (n > 0 ? gem(COLORS[i], n) : ""))
            .join("")
        : "";
      return `卡牌上的彩色圆标是费用，这张需要 ${cost || "相应颜色的筹码"}。
        每回合预选筹码并点<b>确认取币</b>，直到有牌可以购买。`;
    },
    target: () => firstTierOneCard()?.sel || "#tiers",
    hint: "继续收集筹码，直到有牌显示可购买",
    done: () => [...legalSet].some((i) => i >= 45 && i < 60),
  },
  {
    title: "买下你的第一张牌",
    body: "点击这张牌，选择<b>购买</b>，再按提示完成付款。",
    target: () => firstAffordableCard() || "#tiers",
    hint: "购买一张可负担的牌并完成付款",
    done: (s) => s.players[humanSeat].owned.length > 0,
  },
  {
    title: () => {
      const id = lastOwnedCard();
      return id === null ? "每张牌都提供永久折扣" : `你获得了永久${TUTORIAL_COLOURS[STATIC.cards[id].bonus]}折扣`;
    },
    body: () => {
      const id = lastOwnedCard();
      const colour = id === null ? "对应颜色" : `<b>${TUTORIAL_COLOURS[STATIC.cards[id].bonus]}</b>`;
      return `今后每次购牌都可以少付 1 枚${colour}筹码。这份折扣可以反复使用，不会被消耗。`;
    },
    target: () => {
      const id = lastOwnedCard();
      // Only the human player's bonus counters carry data-bonus in the UI.
      if (id !== null) return `[data-bonus="${STATIC.cards[id].bonus}"]`;
      return document.querySelector("#players [data-bonus]") ? "#players [data-bonus]" : "#players";
    },
  },
  {
    title: "把心仪的牌先预留下来",
    body: "点击一张牌并选择<b>预留</b>，留待以后购买。银行还有黄金时，同时获得 <b>1 枚黄金</b>，付款时可代替任意颜色。最多持有 3 张预留牌；即使黄金已领完，仍可合法预留。",
    target: "#tiers",
    hint: "预留任意一张牌",
    // Gold availability never gates this step: reserving remains legal
    // without gold, provided the player's reserve is below the limit.
    done: (s) => s.players[humanSeat].reserved.length > 0,
    skipIf: (s) => s.players[humanSeat].reserved.length >= MAX_RESERVED,
  },
  {
    title: "用永久折扣迎来贵族",
    body: () => {
      const n = STATIC.nobles[gameNobles()[0]];
      const req = n
        ? n.req.map((v, i) => (v > 0 ? bonus(COLORS[i], v) : "")).join("")
        : "";
      return `贵族查看的是<b>永久折扣</b>数量，无需支付筹码。集齐 ${req || "要求的折扣"}
        后，回合结束时这位贵族就能来访，带来 <b>3 分</b>。同时满足多位时，只选择一位。`;
    },
    target: () => (gameNobles().length ? `[data-noble="${gameNobles()[0]}"]` : "#nobles"),
  },
  {
    title: "达到 15 分，触发最后一轮",
    body: () => {
      const p = firstPointCard();
      return `分数来自发展牌和贵族${p ? `，例如这张牌价值 <b>${p.points} 分</b>` : ""}。
        有人达到 <b>15 分</b>就触发最后一轮。补齐轮次，让双方行动次数相同后比较总分；同分时，已购发展牌较少者获胜，仍相同则平局。`;
    },
    target: () => {
      const p = firstPointCard();
      return p ? `${p.sel} .pts` : "#tiers";
    },
  },
];

function currentState() {
  return JSON.parse(game.observation_json(humanSeat));
}

function firstTierOneCard() {
  const s = currentState();
  for (let slot = 0; slot < DISPLAY_SLOTS; slot++) {
    const id = s.display[0][slot];
    if (id !== null) return { id, sel: `[data-slot="0,${slot}"]` };
  }
  return null;
}

function firstAffordableCard() {
  for (const i of legalSet) {
    if (i >= 45 && i < 57) {
      const t = ((i - 45) / 4) | 0, slot = (i - 45) % 4;
      return `[data-slot="${t},${slot}"]`;
    }
  }
  return null;
}

function firstPointCard() {
  const s = currentState();
  let best = null;
  for (let t = 2; t >= 0; t--) {
    for (let slot = 0; slot < DISPLAY_SLOTS; slot++) {
      const id = s.display[t][slot];
      if (id === null) continue;
      const pts = STATIC.cards[id].points;
      if (pts > 0 && (!best || pts > best.points)) {
        best = { sel: `[data-slot="${t},${slot}"]`, points: pts };
      }
    }
  }
  return best;
}

function lastOwnedCard() {
  const owned = currentState().players[humanSeat].owned;
  return owned.length ? owned[owned.length - 1] : null;
}

function gameNobles() {
  return currentState().nobles;
}

function clearTutorialTarget() {
  for (const el of document.querySelectorAll(".tut-target")) el.classList.remove("tut-target");
}

function renderTutorial() {
  const bar = $("tutorial");
  clearTutorialTarget();
  if (tutorialStep < 0 || tutorialStep >= TUTORIAL.length) {
    bar.className = "";
    bar.innerHTML = "";
    return;
  }
  const step = TUTORIAL[tutorialStep];
  const resolve = (v) => (typeof v === "function" ? v() : v);
  bar.className = "on";
  const waiting = !!step.done;
  bar.innerHTML = `
    <div class="body">
      <div class="step">第 ${tutorialStep + 1} 步，共 ${TUTORIAL.length} 步</div>
      <h3>${resolve(step.title)}</h3>
      <p>${resolve(step.body)}</p>
    </div>
    <div class="btns">
      <button class="ghost" id="tut-skip">关闭引导</button>
      ${waiting
        ? `<span class="waiting">${step.hint || "请完成这一步"}</span>`
        : `<button id="tut-next">${tutorialStep === TUTORIAL.length - 1 ? "开始对弈" : "下一步"}</button>`}
    </div>`;
  $("tut-next")?.addEventListener("click", () => { advanceTutorial(); });
  $("tut-skip").addEventListener("click", () => { tutorialStep = -1; renderTutorial(); });
  const target = resolve(step.target);
  if (target) {
    const el = document.querySelector(target);
    if (el) el.classList.add("tut-target");
  }
}

function advanceTutorial() {
  const state = currentState();
  tutorialStep++;
  while (tutorialStep < TUTORIAL.length && TUTORIAL[tutorialStep].skipIf?.(state)) {
    tutorialStep++;
  }
  if (tutorialStep >= TUTORIAL.length) tutorialStep = -1;
  renderTutorial();
}
