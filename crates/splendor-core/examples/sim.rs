//! Bot-vs-bot matchups as a smoke test of the engine: every game must
//! terminate, and greedy should clearly beat random.
//!
//! Run with: cargo run --release --example sim

use splendor_core::bots::{Bot, EpsilonBot, GreedyBot, RandomBot};
use splendor_core::{GameState, Phase};

const GAMES_PER_MATCHUP: usize = 500;
const ROUND_CAP: u32 = 500;

struct MatchStats {
    wins: [usize; 2],
    draws: usize,
    capped: usize,
    total_rounds: u64,
    total_winner_points: u64,
}

fn make_bot(kind: &str, seed: u64) -> Box<dyn Bot> {
    match kind {
        "random" => Box::new(RandomBot::new(seed)),
        "greedy" => Box::new(GreedyBot),
        "noisy" => Box::new(EpsilonBot::new(GreedyBot, 0.1, seed)),
        _ => unreachable!(),
    }
}

/// Plays one 2-player game; `kinds` maps seat -> bot kind.
fn play(kinds: [&str; 2], seed: u64) -> (GameState, u32, bool) {
    let mut state = GameState::new(2, seed);
    let mut bots: Vec<Box<dyn Bot>> = kinds.iter().map(|k| make_bot(k, seed ^ 0x9e37)).collect();
    while state.phase != Phase::GameOver && state.round < ROUND_CAP {
        let legal = state.legal_actions();
        let action = bots[state.current].choose(&state, &legal);
        state
            .apply(&action)
            .unwrap_or_else(|e| panic!("bot picked illegal action {action:?}: {e:?}"));
    }
    let capped = state.phase != Phase::GameOver;
    let rounds = state.round;
    (state, rounds, capped)
}

fn run_matchup(a: &str, b: &str) -> MatchStats {
    let mut stats = MatchStats {
        wins: [0; 2],
        draws: 0,
        capped: 0,
        total_rounds: 0,
        total_winner_points: 0,
    };
    for g in 0..GAMES_PER_MATCHUP {
        // Alternate seating so first-player advantage cancels out.
        let (kinds, flip) = if g % 2 == 0 {
            ([a, b], false)
        } else {
            ([b, a], true)
        };
        let (state, rounds, capped) = play(kinds, g as u64);
        stats.total_rounds += rounds as u64;
        if capped {
            stats.capped += 1;
            continue;
        }
        let winners = state.winners();
        if winners.len() == 1 {
            let seat = winners[0];
            let bot = if flip { 1 - seat } else { seat };
            stats.wins[bot] += 1;
            stats.total_winner_points += state.players[seat].points as u64;
        } else {
            stats.draws += 1;
        }
    }
    stats
}

fn main() {
    for (a, b) in [
        ("random", "random"),
        ("greedy", "random"),
        ("greedy", "greedy"),
        ("greedy", "noisy"),
        ("noisy", "noisy"),
    ] {
        let s = run_matchup(a, b);
        let n = GAMES_PER_MATCHUP as f64;
        println!(
            "{a:>6} vs {b:<6}  {a} wins {:>5.1}%  {b} wins {:>5.1}%  draws {:>4.1}%  \
             capped {}  avg rounds {:>5.1}  avg winner pts {:>4.1}",
            100.0 * s.wins[0] as f64 / n,
            100.0 * s.wins[1] as f64 / n,
            100.0 * s.draws as f64 / n,
            s.capped,
            s.total_rounds as f64 / n,
            s.total_winner_points as f64 / (s.wins[0] + s.wins[1]) as f64,
        );
    }
}
