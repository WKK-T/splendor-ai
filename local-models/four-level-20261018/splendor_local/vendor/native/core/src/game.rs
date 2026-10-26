//! Game state and rules engine.
//!
//! All randomness happens at setup (deck shuffling from a seed); every
//! transition afterwards is deterministic, so a `(seed, action list)` pair
//! fully determines a game and states serialize without carrying an RNG.

use rand::seq::SliceRandom;
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};

use crate::data::{Card, Noble, CARDS, NOBLES};

pub type CardId = u8;
pub type NobleId = u8;

/// Gem/bonus colors, in the fixed index order used by every `[u8; 5]` array.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Color {
    White = 0,
    Blue = 1,
    Green = 2,
    Red = 3,
    Black = 4,
}

impl Color {
    pub const ALL: [Color; 5] = [
        Color::White,
        Color::Blue,
        Color::Green,
        Color::Red,
        Color::Black,
    ];

    pub fn idx(self) -> usize {
        self as usize
    }
}

/// Index of gold (joker) tokens in `[u8; 6]` token arrays; 0..5 are `Color` indices.
pub const GOLD: usize = 5;

pub const WINNING_POINTS: u8 = 15;
pub const MAX_TOKENS_HELD: u8 = 10;
pub const MAX_RESERVED: usize = 3;
pub const DISPLAY_SLOTS: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Player {
    /// Held tokens by color, `tokens[GOLD]` for gold.
    pub tokens: [u8; 6],
    /// Discounts from owned cards, by color. Redundant with `owned` but kept
    /// in sync because it is read on every affordability check.
    pub bonuses: [u8; 5],
    /// Prestige points from owned cards and noble visits.
    pub points: u8,
    pub reserved: Vec<CardId>,
    /// Aligned with `reserved`: true for cards taken from the face-up market.
    /// Public cards remain remembered even while held face down.
    pub reserved_public: Vec<bool>,
    pub owned: Vec<CardId>,
    pub nobles: Vec<NobleId>,
}

impl Player {
    fn new() -> Self {
        Player {
            tokens: [0; 6],
            bonuses: [0; 5],
            points: 0,
            reserved: Vec::new(),
            reserved_public: Vec::new(),
            owned: Vec::new(),
            nobles: Vec::new(),
        }
    }

    pub fn token_count(&self) -> u8 {
        self.tokens.iter().sum()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Phase {
    /// Current player must pick one of the four main actions (or pass if none).
    Play,
    /// Purchase committed, but payment must finish before any refill is revealed.
    PayCard,
    /// Current player exceeded the 10-token limit and must discard one token
    /// at a time until back at the limit.
    Discard,
    /// Current player qualifies for more than one noble and must pick one.
    ChooseNoble,
    GameOver,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Action {
    /// Take three distinct colors; when fewer than three colors remain,
    /// take one or two available colors (official supply-shortage exception).
    TakeDistinct(Vec<Color>),
    /// Take 2 of one color; only legal while the bank holds at least 4 of it.
    TakeSame(Color),
    ReserveDisplay {
        tier: u8,
        slot: u8,
    },
    ReserveDeck {
        tier: u8,
    },
    BuyDisplay {
        tier: u8,
        slot: u8,
    },
    BuyReserved {
        idx: u8,
    },
    /// Discard one token (color index, or `GOLD`) during the Discard phase.
    Discard(u8),
    ChooseNoble(NobleId),
    /// Pay one token against the first outstanding cost color. Gold may
    /// substitute even when a matching colored token is held.
    PayToken(u8),
    /// Only legal when no other action is: forfeit the turn.
    Pass,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleError {
    WrongPhase,
    GameIsOver,
    EmptyBankPile,
    NotDistinctColors,
    TooManyColors,
    MustTakeAvailableColors,
    NeedFourInBankToTakeTwo,
    NoSuchCard,
    ReserveLimitReached,
    CannotAfford,
    NothingToDiscard,
    NobleNotEarned,
    OtherActionsAvailable,
    InvalidPayment,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PurchaseSource {
    Display { tier: u8, slot: u8 },
    Reserved { idx: u8 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingPurchase {
    pub card_id: CardId,
    pub source: PurchaseSource,
    pub remaining_cost: [u8; 5],
}

/// The only state representation that may be sent to a player or teacher.
/// The full `GameState` is privileged replay/engine data, never an observation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Observation {
    pub noble_catalog: Vec<Noble>,
    pub ruleset_version: String,
    pub viewer: usize,
    pub current: usize,
    pub starting_player: usize,
    pub phase: Phase,
    pub round: u32,
    pub final_round_triggered: bool,
    /// Includes the current unfinished turn, zero after game over.
    pub turns_until_round_end: usize,
    pub players: Vec<ObservedPlayer>,
    pub bank: [u8; 6],
    pub deck_sizes: [usize; 3],
    pub display: [[Option<CardId>; DISPLAY_SLOTS]; 3],
    pub nobles: Vec<NobleId>,
    pub pending_purchase: Option<PendingPurchase>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObservedPlayer {
    pub seat: usize,
    pub tokens: [u8; 6],
    pub bonuses: [u8; 5],
    pub points: u8,
    /// None means an existing hidden card, not an empty slot.
    pub reserved: Vec<Option<CardId>>,
    pub reserved_tiers: Vec<u8>,
    pub reserved_public: Vec<bool>,
    pub owned: Vec<CardId>,
    pub nobles: Vec<NobleId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameState {
    #[serde(default="default_noble_catalog")]
    pub noble_catalog: Vec<Noble>,
    pub players: Vec<Player>,
    /// Bank tokens by color, `bank[GOLD]` for gold.
    pub bank: [u8; 6],
    /// Face-down draw piles per tier (index 0 = tier 1); top card is `last()`.
    pub decks: [Vec<CardId>; 3],
    /// Face-up card display, `display[tier][slot]`; `None` once a tier's deck
    /// and slot are both exhausted.
    pub display: [[Option<CardId>; DISPLAY_SLOTS]; 3],
    /// Noble tiles still available.
    pub nobles: Vec<NobleId>,
    pub current: usize,
    pub phase: Phase,
    /// Completed rounds (increments when play wraps back to player 0).
    pub round: u32,
    pub pending_purchase: Option<PendingPurchase>,
}

pub fn card(id: CardId) -> &'static Card {
    &CARDS[id as usize]
}

pub fn noble(id: NobleId) -> &'static Noble {
    &NOBLES[id as usize]
}

pub fn default_noble_catalog() -> Vec<Noble> { NOBLES.to_vec() }

impl GameState {
    pub fn noble_tile(&self,id:NobleId)->&Noble { &self.noble_catalog[id as usize] }
    /// Set up a game for 2-4 players. All shuffling derives from `seed`.
    pub fn new(n_players: usize, seed: u64) -> Self {
        assert!((2..=4).contains(&n_players), "Splendor is for 2-4 players");
        let mut rng = ChaCha8Rng::seed_from_u64(seed);

        let gems_per_color: u8 = match n_players {
            2 => 4,
            3 => 5,
            _ => 7,
        };
        let mut bank = [gems_per_color; 6];
        bank[GOLD] = 5;

        let mut decks: [Vec<CardId>; 3] = [Vec::new(), Vec::new(), Vec::new()];
        for id in 0..CARDS.len() {
            decks[(CARDS[id].tier - 1) as usize].push(id as CardId);
        }
        for deck in decks.iter_mut() {
            deck.shuffle(&mut rng);
        }

        let mut display = [[None; DISPLAY_SLOTS]; 3];
        for (tier, deck) in decks.iter_mut().enumerate() {
            for slot in 0..DISPLAY_SLOTS {
                display[tier][slot] = deck.pop();
            }
        }

        let mut noble_ids: Vec<NobleId> = (0..NOBLES.len() as NobleId).collect();
        noble_ids.shuffle(&mut rng);
        noble_ids.truncate(n_players + 1);

        GameState {
            noble_catalog: default_noble_catalog(),
            players: vec![Player::new(); n_players],
            bank,
            decks,
            display,
            nobles: noble_ids,
            current: 0,
            phase: Phase::Play,
            round: 0,
            pending_purchase: None,
        }
    }

    pub fn current_player(&self) -> &Player {
        &self.players[self.current]
    }

    pub fn observation(&self, viewer: usize) -> Observation {
        assert!(viewer < self.players.len(), "invalid observer seat");
        Observation {
            ruleset_version: "splendor-pv-attribute-nobles-v1".into(),
            noble_catalog: self.noble_catalog.clone(),
            viewer, current: self.current, starting_player: 0,
            phase: self.phase, round: self.round,
            final_round_triggered: self.players.iter().any(|p| p.points >= WINNING_POINTS),
            turns_until_round_end: if self.phase == Phase::GameOver { 0 } else { self.players.len() - self.current },
            players: self.players.iter().enumerate().map(|(seat, p)| ObservedPlayer {
                seat, tokens: p.tokens, bonuses: p.bonuses, points: p.points,
                reserved: p.reserved.iter().enumerate().map(|(i, &id)| {
                    let buying = self.pending_purchase.as_ref().is_some_and(|b|
                        seat == self.current && b.source == PurchaseSource::Reserved { idx: i as u8 });
                    (seat == viewer || p.reserved_public[i] || buying).then_some(id)
                }).collect(),
                reserved_tiers: p.reserved.iter().map(|&id| card(id).tier).collect(),
                reserved_public: p.reserved_public.clone(), owned: p.owned.clone(), nobles: p.nobles.clone(),
            }).collect(),
            bank: self.bank, deck_sizes: self.decks.each_ref().map(|d| d.len()),
            display: self.display, nobles: self.nobles.clone(), pending_purchase: self.pending_purchase.clone(),
        }
    }

    /// Per-color gem cost of `card_id` for `player` after bonuses, and the
    /// gold needed on top of the player's colored gems to cover it.
    pub fn payment_shortfall(&self, player: usize, card_id: CardId) -> ([u8; 5], u8) {
        let p = &self.players[player];
        let c = card(card_id);
        let mut cost = [0u8; 5];
        let mut gold_needed = 0u8;
        for i in 0..5 {
            cost[i] = c.cost[i].saturating_sub(p.bonuses[i]);
            gold_needed += cost[i].saturating_sub(p.tokens[i]);
        }
        (cost, gold_needed)
    }

    pub fn can_afford(&self, player: usize, card_id: CardId) -> bool {
        let (_, gold_needed) = self.payment_shortfall(player, card_id);
        gold_needed <= self.players[player].tokens[GOLD]
    }

    pub fn legal_actions(&self) -> Vec<Action> {
        let mut actions = Vec::new();
        match self.phase {
            Phase::GameOver => {}
            Phase::PayCard => {
                for g in 0..6u8 {
                    if self.payment_token_is_legal(g) { actions.push(Action::PayToken(g)); }
                }
            }
            Phase::Discard => {
                let p = self.current_player();
                for g in 0..6 {
                    if p.tokens[g] > 0 {
                        actions.push(Action::Discard(g as u8));
                    }
                }
            }
            Phase::ChooseNoble => {
                for &n in &self.noble_candidates(self.current) {
                    actions.push(Action::ChooseNoble(n));
                }
            }
            Phase::Play => {
                let p = self.current_player();

                // Token takes.
                let available: Vec<Color> = Color::ALL
                    .into_iter()
                    .filter(|c| self.bank[c.idx()] > 0)
                    .collect();
                let required = available.len().min(3);
                for i in 0..available.len() {
                    if required < 3 { actions.push(Action::TakeDistinct(vec![available[i]])); }
                    for j in (i + 1)..available.len() {
                        if required == 2 { actions.push(Action::TakeDistinct(vec![available[i], available[j]])); }
                        for k in (j + 1)..available.len() {
                            actions.push(Action::TakeDistinct(vec![
                                available[i],
                                available[j],
                                available[k],
                            ]));
                        }
                    }
                }
                for c in Color::ALL {
                    if self.bank[c.idx()] >= 4 {
                        actions.push(Action::TakeSame(c));
                    }
                }

                // Reserves.
                if p.reserved.len() < MAX_RESERVED {
                    for tier in 0..3u8 {
                        for slot in 0..DISPLAY_SLOTS as u8 {
                            if self.display[tier as usize][slot as usize].is_some() {
                                actions.push(Action::ReserveDisplay { tier, slot });
                            }
                        }
                        if !self.decks[tier as usize].is_empty() {
                            actions.push(Action::ReserveDeck { tier });
                        }
                    }
                }

                // Buys.
                for tier in 0..3u8 {
                    for slot in 0..DISPLAY_SLOTS as u8 {
                        if let Some(id) = self.display[tier as usize][slot as usize] {
                            if self.can_afford(self.current, id) {
                                actions.push(Action::BuyDisplay { tier, slot });
                            }
                        }
                    }
                }
                for (idx, &id) in p.reserved.iter().enumerate() {
                    if self.can_afford(self.current, id) {
                        actions.push(Action::BuyReserved { idx: idx as u8 });
                    }
                }

                if actions.is_empty() {
                    actions.push(Action::Pass);
                }
            }
        }
        actions
    }

    pub fn apply(&mut self, action: &Action) -> Result<(), RuleError> {
        match self.phase {
            Phase::GameOver => Err(RuleError::GameIsOver),
            Phase::PayCard => match action {
                Action::PayToken(g) => {
                    if !self.payment_token_is_legal(*g) { return Err(RuleError::InvalidPayment); }
                    let b = self.pending_purchase.as_mut().expect("payment phase has purchase");
                    let color = b.remaining_cost.iter().position(|&x| x > 0).unwrap();
                    b.remaining_cost[color] -= 1;
                    self.players[self.current].tokens[*g as usize] -= 1;
                    self.bank[*g as usize] += 1;
                    if b.remaining_cost.iter().all(|&x| x == 0) { self.complete_purchase(); }
                    Ok(())
                },
                _ => Err(RuleError::WrongPhase),
            },
            Phase::Discard => match action {
                Action::Discard(g) => {
                    let g = *g as usize;
                    if g > GOLD || self.players[self.current].tokens[g] == 0 {
                        return Err(RuleError::NothingToDiscard);
                    }
                    self.players[self.current].tokens[g] -= 1;
                    self.bank[g] += 1;
                    if self.players[self.current].token_count() <= MAX_TOKENS_HELD {
                        self.finish_main_action();
                    }
                    Ok(())
                }
                _ => Err(RuleError::WrongPhase),
            },
            Phase::ChooseNoble => match action {
                Action::ChooseNoble(n) => {
                    if !self.noble_candidates(self.current).contains(n) {
                        return Err(RuleError::NobleNotEarned);
                    }
                    self.award_noble(*n);
                    self.advance_turn();
                    Ok(())
                }
                _ => Err(RuleError::WrongPhase),
            },
            Phase::Play => {
                match action {
                    Action::TakeDistinct(colors) => {
                        if colors.is_empty() || colors.len() > 3 {
                            return Err(RuleError::TooManyColors);
                        }
                        let mut seen = [false; 5];
                        for c in colors {
                            if seen[c.idx()] {
                                return Err(RuleError::NotDistinctColors);
                            }
                            seen[c.idx()] = true;
                            if self.bank[c.idx()] == 0 {
                                return Err(RuleError::EmptyBankPile);
                            }
                        }
                        let required = self.bank[..5].iter().filter(|&&x| x > 0).count().min(3);
                        if required == 3 && colors.len() != 3 { return Err(RuleError::MustTakeAvailableColors); }
                        for c in colors {
                            self.bank[c.idx()] -= 1;
                            self.players[self.current].tokens[c.idx()] += 1;
                        }
                    }
                    Action::TakeSame(c) => {
                        if self.bank[c.idx()] < 4 {
                            return Err(RuleError::NeedFourInBankToTakeTwo);
                        }
                        self.bank[c.idx()] -= 2;
                        self.players[self.current].tokens[c.idx()] += 2;
                    }
                    Action::ReserveDisplay { tier, slot } => {
                        if self.players[self.current].reserved.len() >= MAX_RESERVED {
                            return Err(RuleError::ReserveLimitReached);
                        }
                        let id = self.take_from_display(*tier, *slot)?;
                        self.players[self.current].reserved.push(id);
                        self.players[self.current].reserved_public.push(true);
                        self.grant_gold();
                    }
                    Action::ReserveDeck { tier } => {
                        if self.players[self.current].reserved.len() >= MAX_RESERVED {
                            return Err(RuleError::ReserveLimitReached);
                        }
                        let id = self.decks.get_mut(*tier as usize).ok_or(RuleError::NoSuchCard)?
                            .pop()
                            .ok_or(RuleError::NoSuchCard)?;
                        self.players[self.current].reserved.push(id);
                        self.players[self.current].reserved_public.push(false);
                        self.grant_gold();
                    }
                    Action::BuyDisplay { tier, slot } => {
                        let id = self.display.get(*tier as usize).ok_or(RuleError::NoSuchCard)?
                            .get(*slot as usize)
                            .copied()
                            .flatten()
                            .ok_or(RuleError::NoSuchCard)?;
                        return self.begin_purchase(id, PurchaseSource::Display { tier: *tier, slot: *slot });
                    }
                    Action::BuyReserved { idx } => {
                        let idx = *idx as usize;
                        let id = *self.players[self.current]
                            .reserved
                            .get(idx)
                            .ok_or(RuleError::NoSuchCard)?;
                        return self.begin_purchase(id, PurchaseSource::Reserved { idx: idx as u8 });
                    }
                    Action::Pass => {
                        // Legal only as a last resort, so the "no legal moves"
                        // deadlock can't stall the game loop.
                        if self.legal_actions() != vec![Action::Pass] {
                            return Err(RuleError::OtherActionsAvailable);
                        }
                    }
                    Action::Discard(_) | Action::ChooseNoble(_) | Action::PayToken(_) => {
                        return Err(RuleError::WrongPhase);
                    }
                }

                if self.current_player().token_count() > MAX_TOKENS_HELD {
                    self.phase = Phase::Discard;
                } else {
                    self.finish_main_action();
                }
                Ok(())
            }
        }
    }

    /// Optional host clock rule, separate from the normal legal action space.
    /// A timed-out player forfeits any unstarted action. Committed purchases,
    /// excess tokens and earned noble choices must finish before passing play.
    pub fn finish_timed_out_turn(&mut self) -> Result<(), RuleError> {
        if self.phase == Phase::GameOver { return Err(RuleError::GameIsOver); }
        let seat = self.current;
        while self.current == seat && self.phase != Phase::GameOver {
            if self.phase == Phase::Play {
                self.finish_main_action();
            } else {
                // Legal actions put coloured payments before gold, and choose
                // a stable discard / noble when the player no longer decides.
                let action = self.legal_actions().into_iter().next().ok_or(RuleError::WrongPhase)?;
                self.apply(&action)?;
            }
        }
        Ok(())
    }

    /// Winner indices (only meaningful once `phase == GameOver`): most points,
    /// ties broken by fewest development cards, remaining ties shared.
    pub fn winners(&self) -> Vec<usize> {
        let best = self
            .players
            .iter()
            .map(|p| (p.points as i32, -(p.owned.len() as i32)))
            .max()
            .unwrap();
        (0..self.players.len())
            .filter(|&i| {
                let p = &self.players[i];
                (p.points as i32, -(p.owned.len() as i32)) == best
            })
            .collect()
    }

    fn take_from_display(&mut self, tier: u8, slot: u8) -> Result<CardId, RuleError> {
        let (t, s) = (tier as usize, slot as usize);
        if t >= 3 || s >= DISPLAY_SLOTS {
            return Err(RuleError::NoSuchCard);
        }
        let id = self.display[t][s].take().ok_or(RuleError::NoSuchCard)?;
        self.display[t][s] = self.decks[t].pop();
        Ok(id)
    }

    fn grant_gold(&mut self) {
        if self.bank[GOLD] > 0 {
            self.bank[GOLD] -= 1;
            self.players[self.current].tokens[GOLD] += 1;
        }
    }

    fn begin_purchase(&mut self, card_id: CardId, source: PurchaseSource) -> Result<(), RuleError> {
        let (cost, gold_needed) = self.payment_shortfall(self.current, card_id);
        if gold_needed > self.players[self.current].tokens[GOLD] {
            return Err(RuleError::CannotAfford);
        }
        self.pending_purchase = Some(PendingPurchase { card_id, source, remaining_cost: cost });
        self.phase = Phase::PayCard;
        if cost.iter().all(|&x| x == 0) { self.complete_purchase(); }
        Ok(())
    }

    fn payment_token_is_legal(&self, token: u8) -> bool {
        let Some(b) = &self.pending_purchase else { return false; };
        let Some(color) = b.remaining_cost.iter().position(|&x| x > 0) else { return false; };
        let g = token as usize;
        let p = self.current_player();
        if g > GOLD || (g != color && g != GOLD) || p.tokens[g] == 0 { return false; }
        let mut tokens = p.tokens;
        tokens[g] -= 1;
        let mut cost = b.remaining_cost;
        cost[color] -= 1;
        let required_gold: u8 = (0..5).map(|i| cost[i].saturating_sub(tokens[i])).sum();
        required_gold <= tokens[GOLD]
    }

    fn complete_purchase(&mut self) {
        let b = self.pending_purchase.take().expect("purchase exists");
        match b.source {
            PurchaseSource::Display { tier, slot } => { self.take_from_display(tier, slot).expect("committed card stays in display"); }
            PurchaseSource::Reserved { idx } => {
                self.players[self.current].reserved.remove(idx as usize);
                self.players[self.current].reserved_public.remove(idx as usize);
            }
        }
        self.gain_card(b.card_id);
        self.finish_main_action();
    }

    fn gain_card(&mut self, card_id: CardId) {
        let p = &mut self.players[self.current];
        let c = card(card_id);
        p.owned.push(card_id);
        p.bonuses[c.bonus.idx()] += 1;
        p.points += c.points;
    }

    fn noble_candidates(&self, player: usize) -> Vec<NobleId> {
        let p = &self.players[player];
        self.nobles
            .iter()
            .copied()
            .filter(|&n| {
                self.noble_tile(n)
                    .req
                    .iter()
                    .zip(p.bonuses.iter())
                    .all(|(r, b)| b >= r)
            })
            .collect()
    }

    fn award_noble(&mut self, n: NobleId) {
        self.nobles.retain(|&x| x != n);
        let points=self.noble_tile(n).points;
        let p = &mut self.players[self.current];
        p.nobles.push(n);
        p.points += points;
    }

    /// Runs after the main action (and any forced discards): noble visit,
    /// then turn advance. At most one noble visits per turn; with several
    /// candidates the player chooses via a `ChooseNoble` action.
    fn finish_main_action(&mut self) {
        let candidates = self.noble_candidates(self.current);
        match candidates.len() {
            0 => self.advance_turn(),
            1 => {
                self.award_noble(candidates[0]);
                self.advance_turn();
            }
            _ => self.phase = Phase::ChooseNoble,
        }
    }

    fn advance_turn(&mut self) {
        if self.current + 1 == self.players.len() {
            // End of a full round: everyone has had equal turns, so the
            // 15-point end condition is checked only here.
            self.round += 1;
            if self.players.iter().any(|p| p.points >= WINNING_POINTS) {
                self.phase = Phase::GameOver;
                return;
            }
        }
        self.current = (self.current + 1) % self.players.len();
        self.phase = Phase::Play;
    }
}
