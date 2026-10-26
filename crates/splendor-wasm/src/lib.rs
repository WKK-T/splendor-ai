//! WASM bindings: the full rules engine plus the ML state encoding, so a
//! browser can host games and drive a policy network with no backend at all.

use splendor_core::encode::{encode_state, index_to_action, legal_mask, NUM_ACTIONS};
use splendor_core::GameState;
use splendor_core::bots::{Bot, GreedyBot};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmGame {
    state: GameState,
}

#[wasm_bindgen]
impl WasmGame {
    #[wasm_bindgen(constructor)]
    pub fn new(n_players: usize, seed: u64) -> Result<WasmGame, JsError> {
        if !(2..=4).contains(&n_players) {
            return Err(JsError::new("n_players must be 2-4"));
        }
        Ok(WasmGame { state: GameState::new(n_players, seed) })
    }

    /// Only legally visible information; never export the actual deck order.
    pub fn observation_json(&self, viewer: usize) -> Result<String, JsError> {
        if viewer >= self.state.players.len() {
            return Err(JsError::new("viewer out of range"));
        }
        Ok(serde_json::to_string(&self.state.observation(viewer)).unwrap())
    }

    /// Temporary baseline until a policy is retrained on the patched rules.
    pub fn greedy_index(&self) -> Result<u32, JsError> {
        let legal = self.state.legal_actions();
        if legal.is_empty() {
            return Err(JsError::new("game is over"));
        }
        Ok(splendor_core::encode::action_to_index(&GreedyBot.choose(&self.state, &legal)) as u32)
    }

    pub fn legal_indices(&self) -> Vec<u32> {
        self.state
            .legal_actions()
            .iter()
            .map(|a| splendor_core::encode::action_to_index(a) as u32)
            .collect()
    }

    pub fn apply_index(&mut self, idx: u32) -> Result<(), JsError> {
        if idx as usize >= NUM_ACTIONS {
            return Err(JsError::new("action index out of range"));
        }
        self.state
            .apply(&index_to_action(idx as usize))
            .map_err(|e| JsError::new(&format!("illegal action: {e:?}")))
    }

    /// End only the current turn under the optional browser time limit.
    pub fn finish_timed_out_turn(&mut self) -> Result<(), JsError> {
        self.state.finish_timed_out_turn()
            .map_err(|e| JsError::new(&format!("cannot end timed-out turn: {e:?}")))
    }

    /// ML observation vector for the current player.
    pub fn encode(&self) -> Vec<f32> {
        encode_state(&self.state)
    }

    /// Legality mask (1 = legal) over the versioned action space.
    pub fn mask(&self) -> Vec<u8> {
        legal_mask(&self.state).iter().map(|&b| b as u8).collect()
    }

    pub fn current(&self) -> usize {
        self.state.current
    }

    pub fn phase(&self) -> String {
        format!("{:?}", self.state.phase)
    }

    pub fn round(&self) -> u32 {
        self.state.round
    }

    pub fn winners(&self) -> Vec<u32> {
        self.state.winners().iter().map(|&w| w as u32).collect()
    }
}

/// Static card and noble definitions as JSON, for rendering.
#[wasm_bindgen]
pub fn static_data_json() -> String {
    let cards: Vec<_> = splendor_core::CARDS
        .iter()
        .map(|c| {
            serde_json::json!({
                "tier": c.tier, "points": c.points,
                "bonus": c.bonus.idx(), "cost": c.cost,
            })
        })
        .collect();
    let nobles: Vec<_> = splendor_core::NOBLES
        .iter()
        .map(|n| serde_json::json!({ "points": n.points, "req": n.req }))
        .collect();
    serde_json::json!({ "cards": cards, "nobles": nobles }).to_string()
}

/// A hint sandbox built ONLY from a filtered observation. Unknown identities
/// are placeholders, never copied from the live game's hidden state. The
/// sandbox seals itself at the first draw/reveal and cannot encode it.
#[wasm_bindgen]
pub struct WasmAnalysis {
    state: GameState,
    viewer: usize,
    sealed: bool,
}
#[wasm_bindgen]
impl WasmAnalysis {
    #[wasm_bindgen(constructor)]
    pub fn new(json: &str) -> Result<WasmAnalysis, JsError> {
        let o: splendor_core::Observation = serde_json::from_str(json)
            .map_err(|_| JsError::new("invalid visible observation"))?;
        if o.players.len() != 2 || o.viewer != o.current || o.current >= 2 {
            return Err(JsError::new("analysis requires the acting player's observation"));
        }
        let placeholder = |tier: u8| -> u8 {
            splendor_core::CARDS.iter().position(|c| c.tier == tier).unwrap_or(0) as u8
        };
        let players = o.players.iter().map(|p| splendor_core::Player {
            tokens: p.tokens, bonuses: p.bonuses, points: p.points,
            reserved: p.reserved.iter().enumerate().map(|(i,id)|
                id.unwrap_or_else(|| placeholder(p.reserved_tiers[i]))).collect(),
            reserved_public: p.reserved_public.clone(), owned: p.owned.clone(), nobles: p.nobles.clone(),
        }).collect();
        let state = GameState { players, bank: o.bank,
            decks: std::array::from_fn(|t| vec![placeholder(t as u8 + 1); o.deck_sizes[t]]),
            display: o.display, nobles: o.nobles, current: o.current,
            phase: o.phase, round: o.round, pending_purchase: o.pending_purchase };
        Ok(Self { state, viewer: o.viewer, sealed: false })
    }
    pub fn observation_json(&self) -> Result<String, JsError> {
        if self.sealed { return Err(JsError::new("analysis stopped at hidden-information boundary")); }
        Ok(serde_json::to_string(&self.state.observation(self.viewer)).unwrap())
    }
    pub fn encode(&self) -> Result<Vec<f32>, JsError> {
        if self.sealed { return Err(JsError::new("analysis is sealed")); }
        Ok(encode_state(&self.state))
    }
    pub fn mask(&self) -> Result<Vec<u8>, JsError> {
        if self.sealed { return Err(JsError::new("analysis is sealed")); }
        Ok(legal_mask(&self.state).iter().map(|&b| b as u8).collect())
    }
    pub fn step(&mut self, idx: u32) -> Result<String, JsError> {
        if self.sealed || idx as usize >= NUM_ACTIONS { return Err(JsError::new("analysis unavailable")); }
        let sizes = self.state.decks.each_ref().map(|d| d.len());
        let nobles = self.state.players[self.viewer].nobles.clone();
        let points = self.state.players[self.viewer].points;
        self.state.apply(&index_to_action(idx as usize))
            .map_err(|e| JsError::new(&format!("illegal analysis action: {e:?}")))?;
        let revealed = self.state.decks.iter().enumerate().any(|(i,d)| d.len() != sizes[i]);
        let ended = self.state.current != self.viewer || self.state.phase == splendor_core::Phase::GameOver;
        let gained: Vec<_> = self.state.players[self.viewer].nobles.iter().filter(|n| !nobles.contains(n)).copied().collect();
        self.sealed = revealed || ended;
        Ok(serde_json::json!({"ended": ended, "unknown_boundary": revealed,
            "nobles": gained, "points_gain": self.state.players[self.viewer].points - points,
            "next_phase": format!("{:?}",self.state.phase)}).to_string())
    }
}
