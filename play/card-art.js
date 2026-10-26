/* C5 artwork is cosmetic. This module never reads decks, samples game seeds,
 * calls the rules engine or changes card identities, costs or bonuses.
 * syncVisible receives only the human player's filtered observation.
 */
(function (root) {
  'use strict';
  const COLOURS = ['white', 'blue', 'green', 'red', 'black'];
  const VARIANTS_PER_TIER = [5, 5, 4];

  function defaultRandom() {
    if (root.crypto?.getRandomValues) {
      return root.crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
    }
    return Math.random();
  }

  function create(cards, manifest, { random = defaultRandom } = {}) {
    if (!Array.isArray(cards) || !cards.length || typeof random !== 'function') {
      throw new Error('卡面配置无效。');
    }
    if (manifest?.format !== 'splendor-c5-art/1' || !Array.isArray(manifest.entries)) {
      throw new Error('卡面清单格式不兼容。');
    }
    const groups = new Map(), keys = new Set();
    for (const entry of manifest.entries) {
      const { key, colour, tier, variant } = entry;
      if (!Number.isInteger(colour) || colour < 0 || colour > 4
          || !Number.isInteger(tier) || tier < 1 || tier > 3
          || !Number.isInteger(variant) || variant < 0 || variant >= VARIANTS_PER_TIER[tier - 1]
          || key !== `${COLOURS[colour]}-t${tier}-v${variant}` || keys.has(key)) {
        throw new Error('卡面清单包含重复或不兼容的条目。');
      }
      keys.add(key);
      const groupKey = `${colour}:${tier}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(Object.freeze({ key, colour, tier, variant }));
    }
    for (let colour = 0; colour < 5; colour++) {
      for (let tier = 1; tier <= 3; tier++) {
        const group = groups.get(`${colour}:${tier}`);
        if (!group?.length) throw new Error('部分颜色或等级缺少卡面。');
        group.sort((a, b) => a.variant - b.variant);
      }
    }
    const assignments = new Map();

    function cardDefinition(id) {
      if (!Number.isInteger(id) || id < 0 || !cards[id]
          || !groups.has(`${cards[id].bonus}:${cards[id].tier}`)) {
        throw new Error('无法为未知卡牌分配卡面。');
      }
      return cards[id];
    }

    function assign(id, excluded = new Set()) {
      const existing = assignments.get(id);
      if (existing) return existing;
      const card = cardDefinition(id);
      const all = groups.get(`${card.bonus}:${card.tier}`);
      const unused = all.filter(art => !excluded.has(art.key));
      // A complete package has 5/5/4 variants and only four public slots, so
      // a fresh public card can always avoid its three same-tier neighbours.
      // Limited development previews still work if every variant is in use.
      const choices = unused.length ? unused : all;
      let index = 0;
      if (choices.length > 1) {
        const value = random();
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
          throw new Error('卡面随机源必须返回 0 到 1 之间的数值。');
        }
        index = Math.floor(value * choices.length);
      }
      const art = choices[index];
      assignments.set(id, art);
      return art;
    }

    function syncVisible(observation) {
      if (!Array.isArray(observation?.display) || observation.display.length !== 3
          || !Array.isArray(observation.players)) throw new Error('可见牌桌结构无效。');
      const seen = new Set();
      for (let tier = 1; tier <= 3; tier++) {
        const row = observation.display[tier - 1];
        if (!Array.isArray(row) || row.length !== 4) throw new Error('公开牌槽位数量无效。');
        const publicIds = row.filter(id => id !== null);
        for (const id of publicIds) {
          if (cardDefinition(id).tier !== tier || seen.has(id)) throw new Error('公开牌身份或等级无效。');
          seen.add(id);
        }
        // Collect existing assignments first, regardless of slot order. This
        // is essential when a refill enters the leftmost slot of a row.
        const used = new Set(publicIds.map(id => assignments.get(id)?.key).filter(Boolean));
        for (const id of publicIds) used.add(assign(id, used).key);
      }
      // Allocate only identities already exposed by the filtered observation.
      // Hidden opponent reserves are null and never receive an allocation.
      for (const player of observation.players) {
        for (const id of player.reserved || []) if (id !== null) assign(id);
        for (const id of player.owned || []) assign(id);
      }
      if (observation.pending_purchase?.card_id !== undefined) assign(observation.pending_purchase.card_id);
    }

    function get(id) {
      cardDefinition(id);
      const art = assignments.get(id);
      if (!art) throw new Error('卡面尚未分配；请先同步当前可见牌桌。');
      return art;
    }

    return Object.freeze({
      syncVisible,
      get,
      has: id => assignments.has(id),
      reset: () => assignments.clear(),
      // A copy for regression checks; callers cannot mutate internal state.
      snapshot: () => Array.from(assignments, ([id, art]) => ({ id, key: art.key })),
    });
  }

  root.SplendorCardArt = Object.freeze({ create });
})(globalThis);
