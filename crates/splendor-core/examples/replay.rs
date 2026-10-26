//! Play a bot-vs-bot game and render it as a self-contained HTML replay
//! viewer (state snapshots baked into a template; step through with
//! arrow keys or the slider).
//!
//! Usage: cargo run --release --example replay -- [--seed N] [--bots greedy,noisy] [--out replay.html]

use splendor_core::bots::{Bot, EpsilonBot, GreedyBot, RandomBot};
use splendor_core::{card, Action, Color, GameState, Phase, CARDS, GOLD, NOBLES};

const TEMPLATE: &str = include_str!("replay_template.html");
const ROUND_CAP: u32 = 500;

fn color_letter(c: Color) -> &'static str {
    match c {
        Color::White => "W",
        Color::Blue => "U",
        Color::Green => "G",
        Color::Red => "R",
        Color::Black => "K",
    }
}

fn card_desc(id: u8) -> String {
    let c = card(id);
    format!("{}pt {}", c.points, color_letter(c.bonus))
}

/// One-line notation for a move, given the state it was played in.
fn label(s: &GameState, a: &Action) -> String {
    let p = format!("P{}", s.current);
    match a {
        Action::TakeDistinct(colors) => {
            let cs: Vec<_> = colors.iter().map(|c| color_letter(*c)).collect();
            format!("{p} take {}", cs.join("+"))
        }
        Action::TakeSame(c) => format!("{p} take {}+{}", color_letter(*c), color_letter(*c)),
        Action::ReserveDisplay { tier, slot } => {
            let id = s.display[*tier as usize][*slot as usize].unwrap();
            format!("{p} reserve T{} ({})", tier + 1, card_desc(id))
        }
        Action::ReserveDeck { tier } => format!("{p} reserve T{} deck", tier + 1),
        Action::BuyDisplay { tier, slot } => {
            let id = s.display[*tier as usize][*slot as usize].unwrap();
            format!("{p} buy T{} {}", tier + 1, card_desc(id))
        }
        Action::BuyReserved { idx } => {
            let id = s.players[s.current].reserved[*idx as usize];
            let c = card(id);
            format!("{p} buy reserved T{} {}", c.tier, card_desc(id))
        }
        Action::Discard(g) => {
            let name = if *g as usize == GOLD {
                "gold"
            } else {
                color_letter(Color::ALL[*g as usize])
            };
            format!("{p} discard {name}")
        }
        Action::ChooseNoble(_) => format!("{p} noble visit (+3)"),
        Action::Pass => format!("{p} pass"),
        Action::PayToken(g) => format!("{p} pay token {g}"),
    }
}

fn make_bot(kind: &str, seed: u64) -> Box<dyn Bot> {
    match kind {
        "random" => Box::new(RandomBot::new(seed)),
        "greedy" => Box::new(GreedyBot),
        "noisy" => Box::new(EpsilonBot::new(GreedyBot, 0.1, seed)),
        other => panic!("unknown bot kind {other:?} (expected random|greedy|noisy)"),
    }
}

fn arg(args: &[String], flag: &str, default: &str) -> String {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_else(|| default.to_string())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let seed: u64 = arg(&args, "--seed", "42")
        .parse()
        .expect("--seed must be a number");
    let bots_arg = arg(&args, "--bots", "greedy,noisy");
    let out = arg(&args, "--out", "replay.html");

    let kinds: Vec<&str> = bots_arg.split(',').collect();
    let mut bots: Vec<Box<dyn Bot>> = kinds
        .iter()
        .enumerate()
        .map(|(i, k)| make_bot(k, seed.wrapping_add(i as u64)))
        .collect();

    let mut state = GameState::new(kinds.len(), seed);
    let mut states = vec![serde_json::to_value(&state).unwrap()];
    let mut moves: Vec<serde_json::Value> = Vec::new();

    // A turn is one Play-phase action plus any forced continuations (discards,
    // noble choice) by the same player; continuations are numbered 7b, 7c, ...
    let mut turn_no = 0u32;
    let mut sub = 0u8;
    while state.phase != Phase::GameOver && state.round < ROUND_CAP {
        let legal = state.legal_actions();
        let action = bots[state.current].choose(&state, &legal);
        let cont = state.phase != Phase::Play;
        if cont {
            sub += 1;
        } else {
            turn_no += 1;
            sub = 0;
        }
        let n = if cont {
            format!("{turn_no}{}", (b'a' + sub) as char)
        } else {
            turn_no.to_string()
        };
        moves.push(serde_json::json!({ "n": n, "cont": cont, "label": label(&state, &action) }));
        state.apply(&action).expect("bot picked an illegal action");
        states.push(serde_json::to_value(&state).unwrap());
    }

    let result = if state.phase == Phase::GameOver {
        let winners = state.winners();
        let scores: Vec<_> = state.players.iter().map(|p| p.points.to_string()).collect();
        if winners.len() == 1 {
            let w = winners[0];
            format!("P{w} ({}) wins {}", kinds[w], scores.join("\u{2013}"))
        } else {
            format!("draw {}", scores.join("\u{2013}"))
        }
    } else {
        "round cap reached".to_string()
    };

    let data = serde_json::json!({
        "seed": seed,
        "players": kinds.iter().enumerate()
            .map(|(i, k)| format!("P{i} \u{b7} {k}")).collect::<Vec<_>>(),
        "result": result,
        "cards": CARDS.iter().map(|c| serde_json::json!({
            "tier": c.tier, "points": c.points, "bonus": c.bonus.idx(), "cost": c.cost,
        })).collect::<Vec<_>>(),
        "nobles": NOBLES.iter().map(|n| serde_json::json!({
            "points": n.points, "req": n.req,
        })).collect::<Vec<_>>(),
        "states": states,
        "moves": moves,
    });

    let html = TEMPLATE.replace("/*__REPLAY_DATA__*/", &data.to_string());
    std::fs::write(&out, html).expect("failed to write output file");
    println!("{result}");
    println!("wrote {out} ({} moves)", moves.len());
}
