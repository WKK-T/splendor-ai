use splendor_core::bots::{Bot, RandomBot};
use splendor_core::{
    card, noble, Action, Color, GameState, Phase, CARDS, GOLD, NOBLES, WINNING_POINTS,
};

#[test]
fn card_data_composition() {
    assert_eq!(CARDS.len(), 90);
    for (tier, expected_total, expected_per_color) in [(1, 40, 8), (2, 30, 6), (3, 20, 4)] {
        let tier_cards: Vec<_> = CARDS.iter().filter(|c| c.tier == tier).collect();
        assert_eq!(tier_cards.len(), expected_total);
        for color in Color::ALL {
            assert_eq!(
                tier_cards.iter().filter(|c| c.bonus == color).count(),
                expected_per_color
            );
        }
    }
    assert_eq!(NOBLES.len(), 10);
    for n in NOBLES {
        assert_eq!(n.points, 3);
        let total: u8 = n.req.iter().sum();
        assert!(total == 8 || total == 9, "nobles require 4+4 or 3+3+3");
    }
}

#[test]
fn setup_composition() {
    for (n_players, gems) in [(2, 4), (3, 5), (4, 7)] {
        let s = GameState::new(n_players, 42);
        assert_eq!(s.players.len(), n_players);
        for c in Color::ALL {
            assert_eq!(s.bank[c.idx()], gems);
        }
        assert_eq!(s.bank[GOLD], 5);
        assert_eq!(s.nobles.len(), n_players + 1);
        for (tier, deck_size) in [(0, 36), (1, 26), (2, 16)] {
            assert_eq!(s.decks[tier].len(), deck_size);
            assert!(s.display[tier].iter().all(|slot| slot.is_some()));
        }
    }
}

/// Total tokens of each kind across bank + all players, for conservation checks.
fn token_totals(s: &GameState) -> [u16; 6] {
    let mut totals = [0u16; 6];
    for g in 0..6 {
        totals[g] = s.bank[g] as u16 + s.players.iter().map(|p| p.tokens[g] as u16).sum::<u16>();
    }
    totals
}

fn play_random_game(n_players: usize, seed: u64) -> GameState {
    let mut s = GameState::new(n_players, seed);
    let mut bot = RandomBot::new(seed.wrapping_mul(31));
    let initial = token_totals(&s);
    while s.phase != Phase::GameOver {
        assert!(
            s.round < 1000,
            "random game failed to terminate (seed {seed})"
        );
        let legal = s.legal_actions();
        assert!(!legal.is_empty(), "no legal actions while game is running");
        let action = bot.choose(&s, &legal);
        s.apply(&action).expect("legal action must apply cleanly");
        assert_eq!(token_totals(&s), initial, "tokens must be conserved");
        let mut cards = Vec::new();
        for deck in &s.decks { cards.extend(deck.iter().copied()); }
        cards.extend(s.display.iter().flatten().filter_map(|&id| id));
        for player in &s.players {
            cards.extend(player.owned.iter().copied());
            cards.extend(player.reserved.iter().copied());
            assert_eq!(player.reserved.len(), player.reserved_public.len());
        }
        cards.sort_unstable();
        assert_eq!(cards, (0..90u8).collect::<Vec<_>>(), "each card exists exactly once, including during payment");
    }
    s
}

#[test]
fn random_playouts_terminate_and_conserve() {
    for n_players in 2..=4 {
        for seed in 0..25 {
            let s = play_random_game(n_players, seed);
            // Someone must have reached the winning threshold.
            assert!(s.players.iter().any(|p| p.points >= WINNING_POINTS));
            // Everyone had an equal number of turns; play ended on a round boundary.
            assert_eq!(s.current, s.players.len() - 1);
            // Derived fields match the cards actually owned.
            for p in &s.players {
                let mut bonuses = [0u8; 5];
                let mut points = 0u8;
                for &id in &p.owned {
                    bonuses[card(id).bonus.idx()] += 1;
                    points += card(id).points;
                }
                for &id in &p.nobles {
                    points += noble(id).points;
                }
                assert_eq!(p.bonuses, bonuses);
                assert_eq!(p.points, points);
                assert!(p.token_count() <= 10);
                assert!(p.reserved.len() <= 3);
            }
        }
    }
}

#[test]
fn same_seed_same_game() {
    let a = serde_json::to_string(&play_random_game(3, 7)).unwrap();
    let b = serde_json::to_string(&play_random_game(3, 7)).unwrap();
    assert_eq!(a, b);
}

#[test]
fn serde_roundtrip() {
    let s = GameState::new(4, 123);
    let json = serde_json::to_string(&s).unwrap();
    let back: GameState = serde_json::from_str(&json).unwrap();
    assert_eq!(s, back);
}

#[test]
fn illegal_actions_rejected() {
    let mut s = GameState::new(2, 0);

    // Can't take two of a color the bank has fewer than four of.
    s.bank[Color::Red.idx()] = 3;
    assert!(s.apply(&Action::TakeSame(Color::Red)).is_err());

    // Can't take duplicate colors as "distinct".
    assert!(s
        .apply(&Action::TakeDistinct(vec![Color::Blue, Color::Blue]))
        .is_err());

    // Can't take from an empty pile.
    s.bank[Color::Green.idx()] = 0;
    assert!(s.apply(&Action::TakeDistinct(vec![Color::Green])).is_err());

    // Can't buy what you can't afford (tier 3 card with no tokens).
    assert!(s.apply(&Action::BuyDisplay { tier: 2, slot: 0 }).is_err());

    // Can't discard or choose a noble outside those phases.
    assert!(s.apply(&Action::Discard(0)).is_err());
    assert!(s.apply(&Action::ChooseNoble(0)).is_err());

    // Can't pass while other actions are available.
    assert!(s.apply(&Action::Pass).is_err());

    // A fourth reserve is rejected.
    let mut s = GameState::new(2, 0);
    for _ in 0..3 {
        s.apply(&Action::ReserveDeck { tier: 0 }).unwrap();
        s.apply(&Action::ReserveDeck { tier: 0 }).unwrap(); // player 2's turn
    }
    assert!(matches!(s.apply(&Action::ReserveDeck { tier: 0 }), Err(_)));
}

#[test]
fn take_grants_tokens_and_advances_turn() {
    let mut s = GameState::new(2, 0);
    s.apply(&Action::TakeDistinct(vec![
        Color::White,
        Color::Blue,
        Color::Green,
    ]))
    .unwrap();
    assert_eq!(s.players[0].tokens[Color::White.idx()], 1);
    assert_eq!(s.bank[Color::White.idx()], 3);
    assert_eq!(s.current, 1);
    assert_eq!(s.phase, Phase::Play);
}

#[test]
fn reserve_grants_gold_until_exhausted() {
    let mut s = GameState::new(2, 0);
    s.bank[GOLD] = 1;
    s.apply(&Action::ReserveDeck { tier: 0 }).unwrap();
    assert_eq!(s.players[0].tokens[GOLD], 1);
    assert_eq!(s.players[0].reserved.len(), 1);
    assert_eq!(s.bank[GOLD], 0);
    // Second reserve (other player): no gold left to grant, still legal.
    s.apply(&Action::ReserveDeck { tier: 0 }).unwrap();
    assert_eq!(s.players[1].tokens[GOLD], 0);
    assert_eq!(s.players[1].reserved.len(), 1);
}

#[test]
fn over_limit_forces_discard_phase() {
    let mut s = GameState::new(2, 0);
    s.players[0].tokens = [2, 2, 2, 2, 0, 0]; // 8 held
    s.apply(&Action::TakeDistinct(vec![
        Color::White,
        Color::Blue,
        Color::Green,
    ]))
    .unwrap();
    assert_eq!(s.phase, Phase::Discard);
    assert_eq!(s.current, 0, "still the same player's turn");
    // Only discards are legal now.
    assert!(s
        .legal_actions()
        .iter()
        .all(|a| matches!(a, Action::Discard(_))));
    s.apply(&Action::Discard(Color::White.idx() as u8)).unwrap();
    assert_eq!(s.phase, Phase::Play);
    assert_eq!(s.current, 1, "turn passes once back at the limit");
    assert_eq!(s.players[0].token_count(), 10);
}

#[test]
fn buying_pays_gems_plus_gold_and_awards_card() {
    let mut s = GameState::new(2, 0);
    let id = s.display[0][0].unwrap();
    let c = card(id);
    // Give the player exactly enough: gems for all but one unit, gold for the rest.
    let mut tokens = [0u8; 6];
    let mut deficit_color = None;
    for i in 0..5 {
        tokens[i] = c.cost[i];
        if c.cost[i] > 0 && deficit_color.is_none() {
            tokens[i] -= 1;
            deficit_color = Some(i);
            tokens[GOLD] = 1;
        }
    }
    s.players[0].tokens = tokens;
    s.apply(&Action::BuyDisplay { tier: 0, slot: 0 }).unwrap();
    while s.phase == Phase::PayCard {
        s.apply(&s.legal_actions()[0]).unwrap();
    }
    let p = &s.players[0];
    assert_eq!(p.owned, vec![id]);
    assert_eq!(p.bonuses[c.bonus.idx()], 1);
    assert_eq!(p.points, c.points);
    assert_eq!(p.tokens, [0; 6], "exact payment consumed everything");
    assert!(s.display[0][0].is_some(), "display refilled from the deck");
}

#[test]
fn single_noble_awarded_automatically() {
    let mut s = GameState::new(2, 0);
    let n = s.nobles[0];
    s.nobles = vec![n];
    s.players[0].bonuses = noble(n).req;
    // Any completed turn triggers the visit.
    s.apply(&Action::TakeDistinct(vec![Color::White, Color::Blue, Color::Green])).unwrap();
    assert_eq!(s.players[0].nobles, vec![n]);
    assert_eq!(s.players[0].points, 3);
    assert!(s.nobles.is_empty());
    assert_eq!(s.current, 1);
}

#[test]
fn multiple_nobles_require_choice() {
    let mut s = GameState::new(2, 0);
    let (n1, n2) = (s.nobles[0], s.nobles[1]);
    s.nobles = vec![n1, n2];
    let mut bonuses = [0u8; 5];
    for i in 0..5 {
        bonuses[i] = noble(n1).req[i].max(noble(n2).req[i]);
    }
    s.players[0].bonuses = bonuses;
    s.apply(&Action::TakeDistinct(vec![Color::White, Color::Blue, Color::Green])).unwrap();
    assert_eq!(s.phase, Phase::ChooseNoble);
    assert_eq!(
        s.legal_actions(),
        vec![Action::ChooseNoble(n1), Action::ChooseNoble(n2)]
    );
    s.apply(&Action::ChooseNoble(n2)).unwrap();
    assert_eq!(s.players[0].nobles, vec![n2]);
    assert_eq!(s.players[0].points, 3);
    assert_eq!(s.nobles, vec![n1], "unchosen noble stays on the board");
    assert_eq!(s.current, 1);
}

#[test]
fn game_ends_on_round_boundary_with_equal_turns() {
    let mut s = GameState::new(2, 0);
    // Player 0 crosses the threshold; player 1 must still get their turn.
    s.players[0].points = WINNING_POINTS;
    s.apply(&Action::TakeDistinct(vec![Color::White, Color::Blue, Color::Green])).unwrap();
    assert_eq!(
        s.phase,
        Phase::Play,
        "game continues until the round completes"
    );
    s.apply(&Action::TakeDistinct(vec![Color::White, Color::Blue, Color::Green])).unwrap();
    assert_eq!(s.phase, Phase::GameOver);
    assert_eq!(s.winners(), vec![0]);
}

#[test]
fn winner_tiebreak_fewest_cards() {
    let mut s = GameState::new(2, 0);
    s.players[0].points = 15;
    s.players[1].points = 15;
    s.players[0].owned = vec![0, 1, 2];
    s.players[1].owned = vec![3, 4];
    assert_eq!(s.winners(), vec![1]);
    s.players[0].owned = vec![0, 1];
    assert_eq!(s.winners(), vec![0, 1], "full tie is shared");
}
