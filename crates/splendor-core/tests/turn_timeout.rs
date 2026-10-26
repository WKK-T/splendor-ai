use splendor_core::{card, noble, Action, Color, GameState, Phase, RuleError};

#[test]
fn timeout_forfeits_without_relaxing_normal_pass_rules() {
    let mut s = GameState::new(2, 1);
    let bank = s.bank;
    let display = s.display;
    assert_eq!(s.apply(&Action::Pass), Err(RuleError::OtherActionsAvailable));
    s.finish_timed_out_turn().unwrap();
    assert_eq!(s.current, 1);
    assert_eq!(s.phase, Phase::Play);
    assert_eq!(s.bank, bank);
    assert_eq!(s.display, display);
    assert!(s.players[0].owned.is_empty());
    assert!(s.players[0].tokens.iter().all(|&n| n == 0));
}

#[test]
fn timeout_finishes_an_already_committed_purchase() {
    let mut s = GameState::new(2, 1);
    let id = s.display[0][0].unwrap();
    for (i, &cost) in card(id).cost.iter().enumerate() {
        s.players[0].tokens[i] = cost;
        s.bank[i] -= cost;
    }
    s.apply(&Action::BuyDisplay {tier:0, slot:0}).unwrap();
    assert_eq!(s.phase, Phase::PayCard);
    let payment = s.legal_actions()[0].clone();
    s.apply(&payment).unwrap();
    s.finish_timed_out_turn().unwrap();
    assert_eq!(s.current, 1);
    assert_eq!(s.players[0].owned, vec![id]);
    assert_eq!(s.players[0].points, card(id).points);
    assert!(s.pending_purchase.is_none());
    assert_eq!(s.players[0].token_count(), 0);
}

#[test]
fn timeout_returns_excess_tokens_and_resolves_noble_choice() {
    let mut s = GameState::new(2, 3);
    for (i, amount) in [(0,4), (1,4), (2,2)] {
        s.players[0].tokens[i] = amount;
        s.bank[i] -= amount;
    }
    let (n1, n2) = (s.nobles[0], s.nobles[1]);
    s.nobles = vec![n1, n2];
    for i in 0..5 { s.players[0].bonuses[i] = noble(n1).req[i].max(noble(n2).req[i]); }
    s.apply(&Action::ReserveDeck {tier:0}).unwrap();
    assert_eq!(s.phase, Phase::Discard);
    s.finish_timed_out_turn().unwrap();
    assert_eq!(s.players[0].token_count(), 10);
    assert_eq!(s.players[0].reserved.len(), 1);
    assert_eq!(s.players[0].nobles.len(), 1);
    assert_eq!(s.players[0].points, 3);
    assert_eq!(s.current, 1);
    assert_eq!(s.phase, Phase::Play);
}

#[test]
fn timeout_respects_round_end_and_cannot_restart_a_finished_game() {
    let mut s = GameState::new(2, 0);
    s.players[0].points = 15;
    s.apply(&Action::TakeSame(Color::White)).unwrap();
    assert_eq!(s.current, 1);
    s.finish_timed_out_turn().unwrap();
    assert_eq!(s.phase, Phase::GameOver);
    assert_eq!(s.finish_timed_out_turn(), Err(RuleError::GameIsOver));
}
