//! Python bindings: a vectorized Splendor environment for RL training and a
//! fast generator of imitation-learning data from the scripted bots.

use ndarray::{Array1, Array2};
use numpy::{IntoPyArray, PyArray1, PyArray2};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

use splendor_core::bots::{Bot, EpsilonBot, GreedyBot, RandomBot};
use splendor_core::encode::{
    action_to_index, encode_len, encode_state, index_to_action, legal_mask, NUM_ACTIONS, ENCODING_VERSION,
};
use splendor_core::{GameState, Phase};

const ROUND_CAP: u32 = 500;

fn make_bot(kind: &str, seed: u64) -> PyResult<Box<dyn Bot + Send + Sync>> {
    Ok(match kind {
        "random" => Box::new(RandomBot::new(seed)),
        "greedy" => Box::new(GreedyBot),
        "noisy" => Box::new(EpsilonBot::new(GreedyBot, 0.1, seed)),
        other => {
            return Err(PyValueError::new_err(format!(
                "unknown bot kind {other:?} (expected random|greedy|noisy)"
            )))
        }
    })
}

/// Terminal reward: +1 sole win, 0 shared win, -1 loss.
/// Nonterminal truncations return a compatibility placeholder, not a draw.
fn seat_reward(state: &GameState, seat: usize) -> f32 {
    if state.phase != Phase::GameOver {
        return 0.0; // ignore this placeholder when last_truncated() is true
    }
    let winners = state.winners();
    if winners.contains(&seat) {
        if winners.len() == 1 {
            1.0
        } else {
            0.0
        }
    } else {
        -1.0
    }
}

/// Vectorized environment over `num_envs` parallel games.
///
/// Two modes:
/// - `opponents=["greedy"]` (scripted): the learner controls one rotating
///   seat per env; other seats auto-play inside `step`. Gym-style semantics.
/// - `opponents=None` (self-play): the caller supplies the action for
///   whichever seat is to move (`seats` output says who). Rewards for all
///   seats of a finished game are exposed via `last_results()`.
///
/// Episodes auto-reset with fresh seeds; `done=True` marks the boundary and
/// the returned observation is the first of the next episode.
/// `last_terminated()` and `last_truncated()` distinguish an actual game result
/// from the training-only round cap; both refer to the last successful step.
#[pyclass]
struct VecEnv {
    games: Vec<GameState>,
    n_players: usize,
    learner_seat: Vec<usize>,
    /// Per env, per seat: scripted bot for non-learner seats (empty boxes
    /// pattern avoided by keeping Option).
    bots: Vec<Vec<Option<Box<dyn Bot + Send + Sync>>>>,
    opponent_kinds: Option<Vec<String>>,
    next_seed: u64,
    last_results: Vec<Vec<f32>>,
    last_terminated: Vec<bool>,
    last_truncated: Vec<bool>,
    round_cap: u32,
}

impl VecEnv {
    fn fresh_game(&mut self, env_idx: usize) {
        let seed = self.next_seed;
        self.next_seed += 1;
        self.games[env_idx] = GameState::new(self.n_players, seed);
        if let Some(kinds) = &self.opponent_kinds {
            let mut bots: Vec<Option<Box<dyn Bot + Send + Sync>>> = Vec::new();
            let mut k = 0;
            for seat in 0..self.n_players {
                if seat == self.learner_seat[env_idx] {
                    bots.push(None);
                } else {
                    bots.push(Some(
                        make_bot(&kinds[k % kinds.len()], seed ^ 0xb07).unwrap(),
                    ));
                    k += 1;
                }
            }
            self.bots[env_idx] = bots;
        }
    }

    /// Scripted mode: advance env until it's the learner's turn or the game
    /// ends. Returns the learner's terminal reward if the game ended.
    fn autoplay_opponents(&mut self, env_idx: usize) -> Option<f32> {
        let learner = self.learner_seat[env_idx];
        loop {
            let state = &mut self.games[env_idx];
            if state.phase == Phase::GameOver || state.round >= self.round_cap {
                return Some(seat_reward(state, learner));
            }
            if state.current == learner {
                return None;
            }
            let legal = state.legal_actions();
            let seat = state.current;
            let action = self.bots[env_idx][seat]
                .as_mut()
                .expect("non-learner seat has a bot")
                .choose(&self.games[env_idx], &legal);
            self.games[env_idx]
                .apply(&action)
                .expect("bot actions are legal");
        }
    }

    fn observe(
        &self,
        py: Python<'_>,
    ) -> (Py<PyArray2<f32>>, Py<PyArray2<bool>>, Py<PyArray1<u32>>) {
        let n = self.games.len();
        let width = encode_len(self.n_players);
        let mut obs = Vec::with_capacity(n * width);
        let mut mask = Vec::with_capacity(n * NUM_ACTIONS);
        let mut seats = Vec::with_capacity(n);
        for g in &self.games {
            obs.extend(encode_state(g));
            mask.extend(legal_mask(g));
            seats.push(g.current as u32);
        }
        (
            Array2::from_shape_vec((n, width), obs)
                .unwrap()
                .into_pyarray(py)
                .into(),
            Array2::from_shape_vec((n, NUM_ACTIONS), mask)
                .unwrap()
                .into_pyarray(py)
                .into(),
            Array1::from_vec(seats).into_pyarray(py).into(),
        )
    }
}

#[pymethods]
impl VecEnv {
    #[new]
    #[pyo3(signature = (num_envs, n_players=2, seed=0, opponents=None, round_cap=500))]
    fn new(
        num_envs: usize,
        n_players: usize,
        seed: u64,
        opponents: Option<Vec<String>>,
        round_cap: u32,
    ) -> PyResult<Self> {
        if !(2..=4).contains(&n_players) {
            return Err(PyValueError::new_err("n_players must be 2-4"));
        }
        if round_cap == 0 {
            return Err(PyValueError::new_err("round_cap must be positive"));
        }
        if let Some(kinds) = &opponents {
            if kinds.is_empty() {
                return Err(PyValueError::new_err("opponents must be non-empty or None"));
            }
            for k in kinds {
                make_bot(k, 0)?; // validate kinds up front
            }
        }
        let mut env = VecEnv {
            games: (0..num_envs)
                .map(|_| GameState::new(n_players, 0))
                .collect(),
            n_players,
            learner_seat: (0..num_envs).map(|i| i % n_players).collect(),
            bots: (0..num_envs).map(|_| Vec::new()).collect(),
            opponent_kinds: opponents,
            next_seed: seed,
            last_results: vec![vec![0.0; n_players]; num_envs],
            last_terminated: vec![false; num_envs],
            last_truncated: vec![false; num_envs],
            round_cap,
        };
        for i in 0..num_envs {
            env.fresh_game(i);
            if env.opponent_kinds.is_some() {
                env.autoplay_opponents(i);
            }
        }
        Ok(env)
    }

    /// Observation width for this configuration.
    #[getter]
    fn obs_len(&self) -> usize {
        encode_len(self.n_players)
    }

    #[getter]
    fn num_actions(&self) -> usize {
        NUM_ACTIONS
    }

    /// `(obs [N, obs_len] f32, mask [N, NUM_ACTIONS] bool, seats [N] u32)` without
    /// advancing any game.
    fn reset(
        &mut self,
        py: Python<'_>,
    ) -> (Py<PyArray2<f32>>, Py<PyArray2<bool>>, Py<PyArray1<u32>>) {
        self.observe(py)
    }

    /// Apply one action per env. Returns
    /// `(obs, mask, rewards [N] f32, dones [N] bool, seats [N] u32)`.
    /// `seats` identifies whose turn the returned observation belongs to.
    fn step(
        &mut self,
        py: Python<'_>,
        actions: Vec<usize>,
    ) -> PyResult<(
        Py<PyArray2<f32>>,
        Py<PyArray2<bool>>,
        Py<PyArray1<f32>>,
        Py<PyArray1<bool>>,
        Py<PyArray1<u32>>,
    )> {
        if actions.len() != self.games.len() {
            return Err(PyValueError::new_err(format!(
                "expected {} actions, got {}",
                self.games.len(),
                actions.len()
            )));
        }
        // Validate the entire batch before any transition, RNG/bot advance,
        // auto-reset or metadata mutation. A bad later action cannot leave
        // earlier environments partially advanced.
        for (i, &a_idx) in actions.iter().enumerate() {
            if a_idx >= NUM_ACTIONS {
                return Err(PyValueError::new_err(format!(
                    "action index {a_idx} out of range"
                )));
            }
            if !legal_mask(&self.games[i])[a_idx] {
                return Err(PyValueError::new_err(format!(
                    "illegal action {a_idx} in env {i}"
                )));
            }
        }
        let mut rewards = vec![0.0f32; actions.len()];
        let mut dones = vec![false; actions.len()];
        self.last_terminated.fill(false);
        self.last_truncated.fill(false);

        for (i, &a_idx) in actions.iter().enumerate() {
            let action = index_to_action(a_idx);
            let acting_seat = self.games[i].current;
            self.games[i].apply(&action).expect("prevalidated legal action");

            let terminal_reward = if self.opponent_kinds.is_some() {
                self.autoplay_opponents(i)
            } else {
                let s = &self.games[i];
                (s.phase == Phase::GameOver || s.round >= self.round_cap)
                    .then(|| seat_reward(s, acting_seat))
            };

            if let Some(r) = terminal_reward {
                rewards[i] = r;
                dones[i] = true;
                self.last_terminated[i] = self.games[i].phase == Phase::GameOver;
                self.last_truncated[i] = !self.last_terminated[i];
                self.last_results[i] = (0..self.n_players)
                    .map(|s| seat_reward(&self.games[i], s))
                    .collect();
                self.fresh_game(i);
                if self.opponent_kinds.is_some() {
                    self.autoplay_opponents(i);
                }
            }
        }

        let (obs, mask, seats) = self.observe(py);
        Ok((
            obs,
            mask,
            Array1::from_vec(rewards).into_pyarray(py).into(),
            Array1::from_vec(dones).into_pyarray(py).into(),
            seats,
        ))
    }

    /// Per-seat terminal rewards `[N, n_players]` of each env's most recently
    /// completed episode (zeros before the first completion). Only a true
    /// last_terminated() flag grants these values outcome/credit semantics;
    /// truncated episodes contain zero placeholders, not draw results.
    fn last_results(&self, py: Python<'_>) -> Py<PyArray2<f32>> {
        let n = self.games.len();
        let flat: Vec<f32> = self.last_results.iter().flatten().copied().collect();
        Array2::from_shape_vec((n, self.n_players), flat)
            .unwrap()
            .into_pyarray(py)
            .into()
    }

    /// Per-env true only for actual game termination on the last successful step.
    fn last_terminated(&self, py: Python<'_>) -> Py<PyArray1<bool>> {
        Array1::from_vec(self.last_terminated.clone()).into_pyarray(py).into()
    }

    /// Per-env true only for a training round-cap cutoff on the last successful step.
    fn last_truncated(&self, py: Python<'_>) -> Py<PyArray1<bool>> {
        Array1::from_vec(self.last_truncated.clone()).into_pyarray(py).into()
    }
}

/// A single interactive game, for UIs and scripted drivers: exposes the full
/// state as JSON, legal action indices, and the ML encoding of the position.
#[pyclass]
struct Game {
    state: GameState,
}

#[pymethods]
impl Game {
    #[new]
    #[pyo3(signature = (n_players=2, seed=0))]
    fn new(n_players: usize, seed: u64) -> PyResult<Self> {
        if !(2..=4).contains(&n_players) {
            return Err(PyValueError::new_err("n_players must be 2-4"));
        }
        Ok(Game {
            state: GameState::new(n_players, seed),
        })
    }

    /// DEPRECATED trusted-engine alias. Never send to an agent/teacher: contains hidden cards and deck order.
    fn state_json(&self) -> String {
        serde_json::to_string(&self.state).unwrap()
    }

    /// Privileged full state for archival/debugging only; never a model input.
    fn trusted_state_json(&self) -> String {
        serde_json::to_string(&self.state).unwrap()
    }

    /// Safe observation for a seat (defaults to current player).
    #[pyo3(signature = (viewer=None))]
    fn observation_json(&self, viewer: Option<usize>) -> PyResult<String> {
        let viewer = viewer.unwrap_or(self.state.current);
        if viewer >= self.state.players.len() { return Err(PyValueError::new_err("invalid observer seat")); }
        Ok(serde_json::to_string(&self.state.observation(viewer)).unwrap())
    }

    /// Legal actions for the acting player only. Contains action schemas, not hidden card IDs.
    fn legal_actions_json(&self) -> String {
        let actions: Vec<_> = self.state.legal_actions().iter().map(|a|
            serde_json::json!({ "index": action_to_index(a), "action": a })).collect();
        serde_json::to_string(&actions).unwrap()
    }

    fn clone(&self) -> Self { Self { state: self.state.clone() } }

    /// Current-player heuristic, restricted by design to public cards and own reserves.
    fn greedy_index(&self) -> PyResult<usize> {
        let legal = self.state.legal_actions();
        if legal.is_empty() { return Err(PyValueError::new_err("game is over")); }
        Ok(action_to_index(&GreedyBot.choose(&self.state, &legal)))
    }

    fn legal_indices(&self) -> Vec<usize> {
        self.state
            .legal_actions()
            .iter()
            .map(action_to_index)
            .collect()
    }

    fn apply_index(&mut self, idx: usize) -> PyResult<()> {
        if idx >= NUM_ACTIONS {
            return Err(PyValueError::new_err("action index out of range"));
        }
        self.state
            .apply(&index_to_action(idx))
            .map_err(|e| PyValueError::new_err(format!("illegal action: {e:?}")))
    }

    /// `(obs [obs_len] f32, mask [NUM_ACTIONS] bool)` for the current player.
    fn encode(&self, py: Python<'_>) -> (Py<PyArray1<f32>>, Py<PyArray1<bool>>) {
        (
            Array1::from_vec(encode_state(&self.state))
                .into_pyarray(py)
                .into(),
            Array1::from_vec(legal_mask(&self.state).to_vec())
                .into_pyarray(py)
                .into(),
        )
    }

    #[getter]
    fn current(&self) -> usize {
        self.state.current
    }

    #[getter]
    fn phase(&self) -> String {
        format!("{:?}", self.state.phase)
    }

    #[getter]
    fn round(&self) -> u32 {
        self.state.round
    }

    fn winners(&self) -> Vec<usize> {
        self.state.winners()
    }
}

/// Static card and noble definitions as JSON, for rendering states in a UI.
#[pyfunction]
fn static_data_json() -> String {
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

/// Generate behavior-cloning data: ε-noisy greedy self-play for state
/// diversity, with every visited state labeled by the clean greedy policy.
///
/// Returns `(obs [M, obs_len] f32, labels [M] u32, masks [M, NUM_ACTIONS] bool)`.
#[pyfunction]
#[pyo3(signature = (num_games, n_players=2, epsilon=0.1, seed=0))]
fn gen_bc_data(
    py: Python<'_>,
    num_games: usize,
    n_players: usize,
    epsilon: f64,
    seed: u64,
) -> PyResult<(Py<PyArray2<f32>>, Py<PyArray1<u32>>, Py<PyArray2<bool>>)> {
    if !(2..=4).contains(&n_players) {
        return Err(PyValueError::new_err("n_players must be 2-4"));
    }
    let width = encode_len(n_players);
    let mut obs = Vec::new();
    let mut labels = Vec::new();
    let mut masks = Vec::new();
    let mut teacher = GreedyBot;

    for game_idx in 0..num_games {
        let game_seed = seed.wrapping_add(game_idx as u64);
        let mut state = GameState::new(n_players, game_seed);
        let mut actors: Vec<EpsilonBot<GreedyBot>> = (0..n_players)
            .map(|s| EpsilonBot::new(GreedyBot, epsilon, game_seed ^ (s as u64) << 32))
            .collect();

        while state.phase != Phase::GameOver && state.round < ROUND_CAP {
            let legal = state.legal_actions();
            obs.extend(encode_state(&state));
            masks.extend(legal_mask(&state));
            labels.push(action_to_index(&teacher.choose(&state, &legal)) as u32);

            let action = actors[state.current].choose(&state, &legal);
            state.apply(&action).expect("legal");
        }
    }

    let m = labels.len();
    Ok((
        Array2::from_shape_vec((m, width), obs)
            .unwrap()
            .into_pyarray(py)
            .into(),
        Array1::from_vec(labels).into_pyarray(py).into(),
        Array2::from_shape_vec((m, NUM_ACTIONS), masks)
            .unwrap()
            .into_pyarray(py)
            .into(),
    ))
}

#[pymodule]
fn splendor_py(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<VecEnv>()?;
    m.add_class::<Game>()?;
    m.add_function(wrap_pyfunction!(gen_bc_data, m)?)?;
    m.add_function(wrap_pyfunction!(static_data_json, m)?)?;
    m.add("NUM_ACTIONS", NUM_ACTIONS)?;
    m.add("ENCODING_VERSION", ENCODING_VERSION)?;
    Ok(())
}
