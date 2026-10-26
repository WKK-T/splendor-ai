//! Pure rules engine for the board game Splendor.
//!
//! No I/O and no global state: [`GameState::new`] seeds all randomness up
//! front, [`GameState::legal_actions`] enumerates exactly the legal moves,
//! and [`GameState::apply`] is a deterministic transition. Everything
//! serializes with serde, so games replay from `(seed, actions)`.

pub mod bots;
pub mod data;
pub mod encode;
pub mod game;

pub use data::{Card, Noble, CARDS, NOBLES};
pub use game::{
    card, noble, Action, CardId, Color, GameState, NobleId, Phase, Player, RuleError, GOLD,
    Observation, ObservedPlayer, PendingPurchase, PurchaseSource,
    MAX_RESERVED, MAX_TOKENS_HELD, WINNING_POINTS,
};
