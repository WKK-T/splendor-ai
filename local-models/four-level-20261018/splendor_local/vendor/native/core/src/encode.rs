//! Fixed action indexing and state featurization for ML training.
//!
//! Every possible action has a permanent index in `0..NUM_ACTIONS` so a
//! policy network can use one categorical output head with legality masking.
//! States encode to a fixed-length `f32` vector, egocentrically ordered
//! (current player first), so a single network can play any seat.

use crate::game::{card, Action, Color, GameState, Phase, PurchaseSource, DISPLAY_SLOTS, GOLD};

/// 25 take-distinct + 5 take-same + 12 reserve-display + 3 reserve-deck
/// + 12 buy-display + 3 buy-reserved + 6 discard + 10 choose-noble + 1 pass
/// + 6 payment tokens. Schema v2 is incompatible with upstream weights.
pub const NUM_ACTIONS: usize = 83;
pub const ENCODING_VERSION: u32 = 2;

/// Color-index pairs/triples in lexicographic order; the fixed enumeration
/// behind take-distinct action indices.
const PAIRS: [(usize, usize); 10] = [
    (0, 1),
    (0, 2),
    (0, 3),
    (0, 4),
    (1, 2),
    (1, 3),
    (1, 4),
    (2, 3),
    (2, 4),
    (3, 4),
];
const TRIPLES: [(usize, usize, usize); 10] = [
    (0, 1, 2),
    (0, 1, 3),
    (0, 1, 4),
    (0, 2, 3),
    (0, 2, 4),
    (0, 3, 4),
    (1, 2, 3),
    (1, 2, 4),
    (1, 3, 4),
    (2, 3, 4),
];

const TAKE2_BASE: usize = 25;
const RESERVE_DISPLAY_BASE: usize = 30;
const RESERVE_DECK_BASE: usize = 42;
const BUY_DISPLAY_BASE: usize = 45;
const BUY_RESERVED_BASE: usize = 57;
const DISCARD_BASE: usize = 60;
const NOBLE_BASE: usize = 66;
const PASS_INDEX: usize = 76;

/// Index of an action. Take-distinct colors must be in ascending color-index
/// order, which is how [`GameState::legal_actions`] emits them.
pub fn action_to_index(a: &Action) -> usize {
    match a {
        Action::TakeDistinct(colors) => {
            let idx: Vec<usize> = colors.iter().map(|c| c.idx()).collect();
            match idx.as_slice() {
                [a] => *a,
                [a, b] => {
                    5 + PAIRS
                        .iter()
                        .position(|p| *p == (*a, *b))
                        .expect("colors sorted")
                }
                [a, b, c] => {
                    15 + TRIPLES
                        .iter()
                        .position(|t| *t == (*a, *b, *c))
                        .expect("colors sorted")
                }
                _ => panic!("take-distinct of {} colors", idx.len()),
            }
        }
        Action::TakeSame(c) => TAKE2_BASE + c.idx(),
        Action::ReserveDisplay { tier, slot } => {
            RESERVE_DISPLAY_BASE + *tier as usize * DISPLAY_SLOTS + *slot as usize
        }
        Action::ReserveDeck { tier } => RESERVE_DECK_BASE + *tier as usize,
        Action::BuyDisplay { tier, slot } => {
            BUY_DISPLAY_BASE + *tier as usize * DISPLAY_SLOTS + *slot as usize
        }
        Action::BuyReserved { idx } => BUY_RESERVED_BASE + *idx as usize,
        Action::Discard(g) => DISCARD_BASE + *g as usize,
        Action::ChooseNoble(n) => NOBLE_BASE + *n as usize,
        Action::Pass => PASS_INDEX,
        Action::PayToken(g) => 77 + *g as usize,
    }
}

/// The canonical action at an index (inverse of [`action_to_index`]).
pub fn index_to_action(i: usize) -> Action {
    let c = |x: usize| Color::ALL[x];
    match i {
        0..=4 => Action::TakeDistinct(vec![c(i)]),
        5..=14 => {
            let (a, b) = PAIRS[i - 5];
            Action::TakeDistinct(vec![c(a), c(b)])
        }
        15..=24 => {
            let (a, b, x) = TRIPLES[i - 15];
            Action::TakeDistinct(vec![c(a), c(b), c(x)])
        }
        25..=29 => Action::TakeSame(c(i - TAKE2_BASE)),
        30..=41 => Action::ReserveDisplay {
            tier: ((i - RESERVE_DISPLAY_BASE) / DISPLAY_SLOTS) as u8,
            slot: ((i - RESERVE_DISPLAY_BASE) % DISPLAY_SLOTS) as u8,
        },
        42..=44 => Action::ReserveDeck {
            tier: (i - RESERVE_DECK_BASE) as u8,
        },
        45..=56 => Action::BuyDisplay {
            tier: ((i - BUY_DISPLAY_BASE) / DISPLAY_SLOTS) as u8,
            slot: ((i - BUY_DISPLAY_BASE) % DISPLAY_SLOTS) as u8,
        },
        57..=59 => Action::BuyReserved {
            idx: (i - BUY_RESERVED_BASE) as u8,
        },
        60..=65 => Action::Discard((i - DISCARD_BASE) as u8),
        66..=75 => Action::ChooseNoble((i - NOBLE_BASE) as u8),
        76 => Action::Pass,
        77..=82 => Action::PayToken((i - 77) as u8),
        _ => panic!("action index {i} out of range"),
    }
}

/// Legality mask over the full action space for the current state.
pub fn legal_mask(s: &GameState) -> [bool; NUM_ACTIONS] {
    let mut mask = [false; NUM_ACTIONS];
    for a in s.legal_actions() {
        mask[action_to_index(&a)] = true;
    }
    mask
}

/// Feature width of one card slot: presence, points, bonus one-hot, cost.
const CARD_FEATS: usize = 12;
/// Public board, all phases, absolute turn/round context, and pending purchase.
const BOARD_FEATS: usize = 12 * CARD_FEATS + 3 + 6 + 10 + 5 + 1 + 4 + 3 + CARD_FEATS + 5 + 2;
/// Hidden reservations retain presence, tier and public/private provenance.
const PLAYER_FEATS: usize = 6 + 5 + 1 + 3 * (CARD_FEATS + 3) + 2 + 1;

/// Length of the encoded state vector for a given player count.
pub fn encode_len(n_players: usize) -> usize {
    BOARD_FEATS + n_players * PLAYER_FEATS
}

fn push_card(out: &mut Vec<f32>, id: Option<u8>) {
    match id {
        None => out.extend([0.0; CARD_FEATS]),
        Some(id) => {
            let c = card(id);
            out.push(1.0);
            out.push(c.points as f32 / 5.0);
            for color in Color::ALL {
                out.push(if c.bonus == color { 1.0 } else { 0.0 });
            }
            for i in 0..5 {
                out.push(c.cost[i] as f32 / 7.0);
            }
        }
    }
}

/// Encode a state from the current player's perspective. All features are
/// roughly in `[0, 1]`. Built exclusively from the filtered observation;
/// deck order and opponents' blind reservations cannot enter model features.
pub fn encode_state(s: &GameState) -> Vec<f32> {
    let n = s.players.len();
    let view = s.observation(s.current);
    let mut out = Vec::with_capacity(encode_len(n));

    for tier in 0..3 {
        for slot in 0..DISPLAY_SLOTS {
            push_card(&mut out, s.display[tier][slot]);
        }
    }
    for tier in 0..3 {
        out.push(s.decks[tier].len() as f32 / 40.0);
    }
    for g in 0..6 {
        out.push(s.bank[g] as f32 / 7.0);
    }
    for id in 0..10u8 {
        out.push(if s.nobles.contains(&id) { 1.0 } else { 0.0 });
    }
    for phase in [Phase::Play, Phase::Discard, Phase::ChooseNoble, Phase::PayCard, Phase::GameOver] {
        out.push(if s.phase == phase { 1.0 } else { 0.0 });
    }
    out.push((s.round as f32 / 60.0).min(1.5));
    for seat in 0..4 { out.push(if s.current == seat { 1.0 } else { 0.0 }); }
    out.push(n as f32 / 4.0);
    out.push(if view.final_round_triggered { 1.0 } else { 0.0 });
    out.push(view.turns_until_round_end as f32 / 4.0);
    push_card(&mut out, view.pending_purchase.as_ref().map(|b| b.card_id));
    let remaining = view.pending_purchase.as_ref().map(|b| b.remaining_cost).unwrap_or([0; 5]);
    for cost in remaining { out.push(cost as f32 / 7.0); }
    out.push(if view.pending_purchase.as_ref().is_some_and(|b| matches!(b.source, PurchaseSource::Display { .. })) { 1.0 } else { 0.0 });
    out.push(if view.pending_purchase.as_ref().is_some_and(|b| matches!(b.source, PurchaseSource::Reserved { .. })) { 1.0 } else { 0.0 });

    for offset in 0..n {
        let p = &view.players[(s.current + offset) % n];
        for g in 0..6 {
            out.push(p.tokens[g] as f32 / 10.0);
        }
        for i in 0..5 {
            out.push(p.bonuses[i] as f32 / 7.0);
        }
        out.push(p.points as f32 / 15.0);
        for slot in 0..3 {
            push_card(&mut out, p.reserved.get(slot).copied().flatten());
            out.push(if slot < p.reserved.len() { 1.0 } else { 0.0 });
            out.push(p.reserved_tiers.get(slot).copied().unwrap_or(0) as f32 / 3.0);
            out.push(if p.reserved_public.get(slot).copied().unwrap_or(false) { 1.0 } else { 0.0 });
        }
        out.push(p.owned.len() as f32 / 20.0);
        out.push(p.nobles.len() as f32 / 5.0);
        out.push(p.seat as f32 / 3.0);
    }

    debug_assert_eq!(out.len(), encode_len(n));
    out
}

/// Index of the discard-gold action (the six discard indices are the five
/// colors followed by gold).
pub const DISCARD_GOLD_INDEX: usize = DISCARD_BASE + GOLD;
