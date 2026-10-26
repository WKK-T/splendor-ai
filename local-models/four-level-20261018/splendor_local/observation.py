"""Validate only public observations; never repair or invent missing game data."""
from __future__ import annotations

import copy
import hashlib
import itertools
import json

from .vendor import splendor_pv_noble_search as engine

RULESET = 'splendor-pv-attribute-nobles-v1'
ACTION_VERSION = '83-v2-public-noble-slots-v1'
STATIC = json.loads(engine.static_data_json())
CARDS = STATIC['cards']
COLORS = ['white', 'blue', 'green', 'red', 'black', 'gold']
FIELDS = set('noble_catalog ruleset_version viewer current starting_player phase round '
             'final_round_triggered turns_until_round_end players bank deck_sizes display '
             'nobles pending_purchase'.split())
PLAYER_FIELDS = set('seat tokens bonuses points reserved reserved_tiers reserved_public owned nobles'.split())


class ObservationError(ValueError):
    """Caller data is missing, inconsistent, privileged, or unsupported."""


def require(condition, message):
    if not condition:
        raise ObservationError(message)


def integer(value, low, high, name):
    require(type(value) is int and low <= value <= high, f'{name}: expected integer {low}..{high}')
    return value


def vector(value, length, low, high, name):
    require(type(value) is list and len(value) == length, f'{name}: expected {length} entries')
    for x in value:
        integer(x, low, high, name)


def keys(obj, required, name, optional=()):
    require(type(obj) is dict, f'{name}: expected object')
    require(required <= obj.keys(), f'{name}: missing fields {sorted(required - obj.keys())}')
    require(obj.keys() <= required | set(optional),
            f'{name}: unknown/private fields {sorted(obj.keys() - required - set(optional))}')


def validate(observation):
    """Return a detached canonical observation, rejecting hidden information.

    Full purchased-card identities are required on every profile. They permit
    both ownership feature encoding and physical card/score consistency checks.
    An optional owned_count is checked then removed; it cannot replace IDs.
    """
    if isinstance(observation, str):
        try:
            observation = json.loads(observation)
        except (ValueError, TypeError) as exc:
            raise ObservationError('observation: invalid JSON') from exc
    o = copy.deepcopy(observation)
    keys(o, FIELDS, 'observation')
    require(o['ruleset_version'] == RULESET, 'unsupported ruleset_version')
    integer(o['viewer'], 0, 1, 'viewer')
    require(type(o['current']) is int and o['current'] == o['viewer'], 'viewer must be the acting player')
    require(type(o['starting_player']) is int and o['starting_player'] == 0, 'normalize starting seat to 0')
    integer(o['round'], 0, 2**32 - 1, 'round')
    require(o['phase'] in ('Play', 'PayCard', 'Discard', 'ChooseNoble', 'GameOver'), 'unsupported phase')
    terminal = o['phase'] == 'GameOver'
    require(type(o['final_round_triggered']) is bool, 'final_round_triggered must be bool')
    integer(o['turns_until_round_end'], 0, 2, 'turns_until_round_end')
    require(o['turns_until_round_end'] == (0 if terminal else 2-o['current']), 'incorrect round-end context')
    require(type(o['players']) is list and len(o['players']) == 2, 'exactly two players required')
    catalog = o['noble_catalog']
    require(type(catalog) is list and 1 <= len(catalog) <= 255, 'invalid noble catalog size')
    for tile in catalog:
        keys(tile, {'points', 'req'}, 'noble tile')
        integer(tile['points'], 1, 15, 'noble points')
        vector(tile['req'], 5, 0, 20, 'noble requirements')
    vector(o['bank'], 6, 0, 5, 'bank')
    vector(o['deck_sizes'], 3, 0, 40, 'deck_sizes')
    seen_cards = set()
    seen_nobles = set()
    tier_counts = [0, 0, 0]

    def mark_card(cid, tier=None):
        integer(cid, 0, 89, 'card ID')
        require(cid not in seen_cards, 'duplicate public card ID')
        seen_cards.add(cid)
        ct = CARDS[cid]['tier']
        require(tier is None or ct == tier, 'card tier mismatch')
        tier_counts[ct-1] += 1

    def mark_nobles(ids):
        require(type(ids) is list, 'nobles must be an ID list')
        for nid in ids:
            integer(nid, 0, len(catalog)-1, 'noble catalog index')
            require(nid not in seen_nobles, 'duplicate public/claimed noble')
            seen_nobles.add(nid)

    require(type(o['display']) is list and len(o['display']) == 3, 'display must contain three tiers')
    for t, row in enumerate(o['display']):
        require(type(row) is list and len(row) == 4, 'display tier must contain four slots')
        for cid in row:
            if cid is not None:
                mark_card(cid, t+1)
            else:
                require(o['deck_sizes'][t] == 0, 'empty display slot with nonempty deck')
    mark_nobles(o['nobles'])
    require(len(o['nobles']) <= 3, 'two-player board has at most three nobles')
    for seat, p in enumerate(o['players']):
        keys(p, PLAYER_FIELDS, f'player {seat}', optional={'owned_count'})
        require(type(p['seat']) is int and p['seat'] == seat, 'players must be in absolute seat order')
        vector(p['tokens'], 6, 0, 5, 'tokens')
        vector(p['bonuses'], 5, 0, 90, 'bonuses')
        integer(p['points'], 0, 255, 'points')
        require(type(p['owned']) is list, 'full public owned card IDs are required')
        if 'owned_count' in p:
            integer(p['owned_count'], 0, 90, 'owned_count')
            require(p.pop('owned_count') == len(p['owned']), 'incomplete public owned card IDs')
        bonuses = [0]*5
        points = 0
        for cid in p['owned']:
            mark_card(cid)
            bonuses[CARDS[cid]['bonus']] += 1
            points += CARDS[cid]['points']
        require(bonuses == p['bonuses'], 'owned card IDs do not match public discounts (incomplete/stale history)')
        mark_nobles(p['nobles'])
        for nid in p['nobles']:
            tile = catalog[nid]
            require(all(b >= r for b, r in zip(bonuses, tile['req'])), 'claimed noble requirements not met')
            points += tile['points']
        require(points == p['points'], 'public points do not match owned cards and claimed nobles')
        require(type(p['reserved']) is list and len(p['reserved']) <= 3, 'invalid reserve slots')
        vector(p['reserved_tiers'], len(p['reserved']), 1, 3, 'reserved_tiers')
        require(type(p['reserved_public']) is list and len(p['reserved_public']) == len(p['reserved'])
                and all(type(x) is bool for x in p['reserved_public']), 'invalid reserved_public')
        for cid, tier, public in zip(p['reserved'], p['reserved_tiers'], p['reserved_public']):
            visible = seat == o['viewer'] or public
            if visible:
                require(cid is not None, 'missing visible reserved card ID')
                mark_card(cid, tier)
            else:
                require(cid is None, 'opponent blind reserved card identity must be null')
                tier_counts[tier-1] += 1
        total = sum(p['tokens'])
        if seat == o['current'] and o['phase'] == 'Discard':
            require(10 < total <= 13, 'Discard requires 11..13 held tokens')
        else:
            require(total <= 10, 'excess tokens outside Discard phase')
    require(len(seen_nobles) == 3, 'available plus claimed nobles must total three')
    require([tier_counts[t]+o['deck_sizes'][t] for t in range(3)] == [40, 30, 20], 'card conservation mismatch')
    for color in range(6):
        require(o['bank'][color]+sum(p['tokens'][color] for p in o['players']) == (5 if color == 5 else 4),
                'token conservation mismatch')
    triggered = any(p['points'] >= 15 for p in o['players'])
    require(triggered == o['final_round_triggered'], 'incorrect final round flag')
    if terminal:
        require(triggered and o['current'] == 1, 'GameOver requires completed final round')
    pending = o['pending_purchase']
    if o['phase'] != 'PayCard':
        require(pending is None, 'pending purchase outside PayCard')
    else:
        keys(pending, {'card_id', 'source', 'remaining_cost'}, 'pending_purchase')
        cid = integer(pending['card_id'], 0, 89, 'pending card ID')
        vector(pending['remaining_cost'], 5, 0, 7, 'remaining_cost')
        rem = pending['remaining_cost']
        player = o['players'][o['current']]
        full = [max(0, c-b) for c, b in zip(CARDS[cid]['cost'], player['bonuses'])]
        require(0 < sum(rem) and all(r <= c for r, c in zip(rem, full)), 'invalid remaining payment')
        first = next(i for i, x in enumerate(rem) if x)
        require(rem[first+1:] == full[first+1:], 'payment costs must be consumed in color order')
        require(sum(max(0, r-t) for r, t in zip(rem, player['tokens'][:5])) <= player['tokens'][5], 'unaffordable pending payment')
        source = pending['source']
        require(type(source) is dict and len(source) == 1, 'invalid purchase source')
        if 'Display' in source:
            keys(source['Display'], {'tier', 'slot'}, 'display purchase source')
            t = integer(source['Display']['tier'], 0, 2, 'purchase tier')
            s = integer(source['Display']['slot'], 0, 3, 'purchase slot')
            require(o['display'][t][s] == cid, 'pending card differs from display source')
        elif 'Reserved' in source:
            keys(source['Reserved'], {'idx'}, 'reserved purchase source')
            idx = integer(source['Reserved']['idx'], 0, len(player['reserved'])-1, 'reserve index')
            require(player['reserved'][idx] == cid, 'pending card differs from reserve source')
        else:
            raise ObservationError('unknown purchase source')
    return o


def external_ids(ids, catalog):
    if ids is None:
        return None
    require(type(ids) is list and len(ids) == len(catalog), 'noble_external_ids must cover the entire catalog')
    require(all(type(x) in (int, str) and (type(x) is int or x) for x in ids), 'external noble IDs must be integers or nonempty strings')
    require(len({(type(x), x) for x in ids}) == len(ids), 'duplicate external noble IDs')
    return list(ids)


def fingerprint(o):
    return hashlib.sha256(json.dumps(o, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def describe_action(index, o, ids=None):
    """Map a legal model index using this exact observation, after slot shrink."""
    if index < 25:
        combos = [(x,) for x in range(5)] + list(itertools.combinations(range(5), 2)) + list(itertools.combinations(range(5), 3))
        return {'type': 'take_distinct', 'colors': [COLORS[c] for c in combos[index]]}
    if index < 30:
        return {'type': 'take_same', 'color': COLORS[index-25], 'count': 2}
    if 30 <= index < 42 or 45 <= index < 57:
        reserve = index < 42
        t, s = divmod(index-(30 if reserve else 45), 4)
        return {'type': 'reserve_display' if reserve else 'buy_display', 'tier': t+1, 'slot': s, 'card_id': o['display'][t][s]}
    if index < 45:
        return {'type': 'reserve_deck', 'tier': index-41}
    if index < 60:
        return {'type': 'buy_reserved', 'slot': index-57, 'card_id': o['players'][o['viewer']]['reserved'][index-57]}
    if index < 66:
        return {'type': 'discard', 'color': COLORS[index-60]}
    if index < 76:
        slot = index-66
        require(slot < len(o['nobles']), 'noble action refers to an absent public slot')
        nid = o['nobles'][slot]
        return {'type': 'choose_noble', 'slot': slot, 'catalog_index': nid,
                'external_id': ids[nid] if ids is not None else None, **o['noble_catalog'][nid]}
    if index == 76:
        return {'type': 'pass'}
    return {'type': 'pay_token', 'color': COLORS[index-77]}
