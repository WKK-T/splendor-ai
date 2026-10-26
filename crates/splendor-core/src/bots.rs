//! Baseline scripted players: a uniform-random bot and a greedy heuristic
//! bot. These are the sparring partners and imitation teachers for the RL
//! work; neither searches ahead.

use rand::seq::IndexedRandom;
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;

use crate::game::{card, Action, CardId, Color, GameState, Phase, DISPLAY_SLOTS, GOLD};

pub trait Bot {
    /// Pick one of `legal`, which is never empty while the game is running.
    fn choose(&mut self, state: &GameState, legal: &[Action]) -> Action;
}

pub struct RandomBot {
    rng: ChaCha8Rng,
}

impl RandomBot {
    pub fn new(seed: u64) -> Self {
        RandomBot {
            rng: ChaCha8Rng::seed_from_u64(seed),
        }
    }
}

impl Bot for RandomBot {
    fn choose(&mut self, _state: &GameState, legal: &[Action]) -> Action {
        legal.choose(&mut self.rng).unwrap().clone()
    }
}

/// Wraps any bot with ε-greedy noise: with probability `epsilon` play a
/// uniformly random legal move instead of the inner bot's choice. Used to
/// diversify visited states during data generation (labels should still come
/// from the clean inner policy) and to break deterministic-mirror cycles.
pub struct EpsilonBot<B: Bot> {
    pub inner: B,
    pub epsilon: f64,
    rng: ChaCha8Rng,
}

impl<B: Bot> EpsilonBot<B> {
    pub fn new(inner: B, epsilon: f64, seed: u64) -> Self {
        EpsilonBot {
            inner,
            epsilon,
            rng: ChaCha8Rng::seed_from_u64(seed),
        }
    }
}

impl<B: Bot> Bot for EpsilonBot<B> {
    fn choose(&mut self, state: &GameState, legal: &[Action]) -> Action {
        if self.rng.random_bool(self.epsilon) {
            legal.choose(&mut self.rng).unwrap().clone()
        } else {
            self.inner.choose(state, legal)
        }
    }
}

/// Deterministic one-ply heuristic: buy the best affordable card, otherwise
/// take the gems that most progress toward a single target card.
pub struct GreedyBot;

impl GreedyBot {
    /// Cards the current player could plausibly work toward: the face-up
    /// display plus their own reserved cards.
    fn reachable_cards(state: &GameState) -> Vec<CardId> {
        let mut ids: Vec<CardId> = state
            .display
            .iter()
            .flatten()
            .filter_map(|slot| *slot)
            .collect();
        ids.extend(state.players[state.current].reserved.iter().copied());
        ids
    }

    /// Gems still missing for `id` (after bonuses, held tokens, and gold).
    fn deficit(state: &GameState, id: CardId) -> ([u8; 5], u8) {
        let p = &state.players[state.current];
        let (cost, _) = state.payment_shortfall(state.current, id);
        let mut per_color = [0u8; 5];
        let mut total = 0u8;
        for i in 0..5 {
            per_color[i] = cost[i].saturating_sub(p.tokens[i]);
            total += per_color[i];
        }
        (per_color, total.saturating_sub(p.tokens[GOLD]))
    }

    /// The card to work toward: most points per missing gem.
    fn target(state: &GameState) -> Option<(CardId, [u8; 5])> {
        Self::reachable_cards(state)
            .into_iter()
            .map(|id| {
                let (per_color, total) = Self::deficit(state, id);
                let score = (card(id).points as f32 + 0.5) / (total as f32 + 1.0);
                (id, per_color, score)
            })
            .max_by(|a, b| a.2.total_cmp(&b.2))
            .map(|(id, per_color, _)| (id, per_color))
    }

    fn best_buy(state: &GameState, legal: &[Action]) -> Option<Action> {
        legal
            .iter()
            .filter_map(|a| {
                let id = match a {
                    Action::BuyDisplay { tier, slot } => {
                        state.display[*tier as usize][*slot as usize]?
                    }
                    Action::BuyReserved { idx } => {
                        state.players[state.current].reserved[*idx as usize]
                    }
                    _ => return None,
                };
                let (cost, _) = state.payment_shortfall(state.current, id);
                let paid: u8 = cost.iter().sum();
                // Highest points first, then the cheapest to pay for.
                Some((a, (card(id).points as i32, -(paid as i32))))
            })
            .max_by_key(|&(_, score)| score)
            .map(|(a, _)| a.clone())
    }

    fn take_toward(state: &GameState, legal: &[Action], deficit: [u8; 5]) -> Option<Action> {
        // Concentrated need: grab two of the most-needed color if we can.
        if let Some(c) = Color::ALL
            .into_iter()
            .filter(|c| deficit[c.idx()] >= 2)
            .max_by_key(|c| deficit[c.idx()])
        {
            let take2 = Action::TakeSame(c);
            if legal.contains(&take2) {
                return Some(take2);
            }
        }

        // Otherwise take up to three distinct: needed colors first (most
        // needed first), padded with whatever the bank is richest in.
        let mut picks: Vec<Color> = Color::ALL
            .into_iter()
            .filter(|c| deficit[c.idx()] > 0 && state.bank[c.idx()] > 0)
            .collect();
        picks.sort_by_key(|c| std::cmp::Reverse(deficit[c.idx()]));
        picks.truncate(3);
        let mut pad: Vec<Color> = Color::ALL
            .into_iter()
            .filter(|c| state.bank[c.idx()] > 0 && !picks.contains(c))
            .collect();
        pad.sort_by_key(|c| std::cmp::Reverse(state.bank[c.idx()]));
        picks.extend(pad);
        picks.truncate(3);
        if picks.is_empty() {
            return None;
        }
        // legal_actions() enumerates combinations in color-index order.
        picks.sort_by_key(|c| c.idx());
        let action = Action::TakeDistinct(picks);
        legal.contains(&action).then_some(action)
    }
}

impl Bot for GreedyBot {
    fn choose(&mut self, state: &GameState, legal: &[Action]) -> Action {
        match state.phase {
            Phase::Discard => {
                let p = &state.players[state.current];
                let deficit = Self::target(state).map(|(_, d)| d).unwrap_or([0; 5]);
                // Shed the most-held color we don't need; gold only as a last
                // resort.
                let g = (0..5)
                    .filter(|&i| p.tokens[i] > 0)
                    .min_by_key(|&i| (deficit[i], std::cmp::Reverse(p.tokens[i])))
                    .unwrap_or(GOLD);
                Action::Discard(g as u8)
            }
            Phase::ChooseNoble | Phase::PayCard => legal[0].clone(),
            _ => {
                if let Some(buy) = Self::best_buy(state, legal) {
                    return buy;
                }
                if let Some((target_id, deficit)) = Self::target(state) {
                    if let Some(take) = Self::take_toward(state, legal, deficit) {
                        return take;
                    }
                    // Bank can't help; hold the target by reserving it.
                    for tier in 0..3u8 {
                        for slot in 0..DISPLAY_SLOTS as u8 {
                            if state.display[tier as usize][slot as usize] == Some(target_id) {
                                let reserve = Action::ReserveDisplay { tier, slot };
                                if legal.contains(&reserve) {
                                    return reserve;
                                }
                            }
                        }
                    }
                }
                legal[0].clone()
            }
        }
    }
}
