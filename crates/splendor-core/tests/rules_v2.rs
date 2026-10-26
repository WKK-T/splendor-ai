use splendor_core::encode::{encode_state, legal_mask};
use splendor_core::{card, Action, Color, GameState, Phase, GOLD};

fn pay_all(s: &mut GameState) {
    while s.phase == Phase::PayCard {
        s.apply(&s.legal_actions()[0]).unwrap();
    }
}

#[test]
fn distinct_take_requires_three_except_under_supply_shortage() {
    let mut s = GameState::new(2, 4);
    for colors in [vec![Color::White], vec![Color::White, Color::Blue]] {
        let before = s.clone();
        assert!(s.apply(&Action::TakeDistinct(colors)).is_err());
        assert_eq!(s, before, "rejected actions must be atomic");
    }
    s.bank = [1, 2, 0, 0, 0, 5];
    assert!(s.legal_actions().contains(&Action::TakeDistinct(vec![Color::White, Color::Blue])));
    assert!(s.legal_actions().contains(&Action::TakeDistinct(vec![Color::White])));
    let mut taking_one = s.clone();
    taking_one.apply(&Action::TakeDistinct(vec![Color::White])).unwrap();
    assert_eq!(taking_one.players[0].tokens[0], 1);
    assert_eq!(taking_one.players[0].tokens[1], 0);
    assert_eq!(taking_one.current, 1);
    s.bank[1] = 0;
    assert!(s.legal_actions().contains(&Action::TakeDistinct(vec![Color::White])));
}

#[test]
fn gold_may_replace_owned_color_and_payment_precedes_refill() {
    let mut s = GameState::new(2, 7);
    let id = s.display[0][0].unwrap();
    let cost = card(id).cost;
    s.players[0].tokens[..5].copy_from_slice(&cost);
    s.players[0].tokens[GOLD] = 1;
    let display = s.display;
    let decks = s.decks.clone();
    let bank = s.bank;
    s.apply(&Action::BuyDisplay { tier: 0, slot: 0 }).unwrap();
    assert_eq!(s.phase, Phase::PayCard);
    assert_eq!(s.display, display);
    assert_eq!(s.decks, decks);
    assert_eq!(s.bank, bank);
    assert!(s.players[0].owned.is_empty());
    let color = cost.iter().position(|&x| x > 0).unwrap();
    assert!(s.legal_actions().contains(&Action::PayToken(color as u8)));
    assert!(s.legal_actions().contains(&Action::PayToken(GOLD as u8)));
    s.apply(&Action::PayToken(GOLD as u8)).unwrap();
    if s.phase == Phase::PayCard {
        assert_eq!(s.display, display);
        assert_eq!(s.decks, decks);
    }
    pay_all(&mut s);
    assert_eq!(s.players[0].tokens[color], 1, "gold preserves a colored token");
    assert_eq!(s.players[0].tokens[GOLD], 0);
    assert_eq!(s.players[0].owned, vec![id]);
    assert_eq!(s.display[0][0], decks[0].last().copied());
    assert!(s.pending_purchase.is_none());
}

#[test]
fn payment_cannot_spend_gold_required_for_later_color() {
    let mut s = GameState::new(2, 0);
    let (slot, id) = s.display[0].iter().enumerate().find_map(|(slot, id)| {
        let id = id.unwrap();
        (card(id).cost.iter().filter(|&&x| x > 0).count() >= 2).then_some((slot, id))
    }).unwrap();
    let cost = card(id).cost;
    s.players[0].tokens[..5].copy_from_slice(&cost);
    let last = cost.iter().rposition(|&x| x > 0).unwrap();
    s.players[0].tokens[last] -= 1;
    s.players[0].tokens[GOLD] = 1;
    s.apply(&Action::BuyDisplay { tier: 0, slot: slot as u8 }).unwrap();
    let before = s.clone();
    assert!(!s.legal_actions().contains(&Action::PayToken(GOLD as u8)));
    assert!(s.apply(&Action::PayToken(GOLD as u8)).is_err());
    assert_eq!(s, before);
    pay_all(&mut s);
    assert_eq!(s.players[0].owned, vec![id]);
}

#[test]
fn hidden_assignments_and_deck_order_do_not_change_observation_or_policy() {
    for n in 2..=4 {
        let mut s = GameState::new(n, 42);
        s.apply(&Action::ReserveDisplay { tier: 0, slot: 0 }).unwrap();
        s.apply(&Action::ReserveDeck { tier: 0 }).unwrap();
        s.current = 0; // compare player zero's next decision, independent of hidden assignment
        let known_id = s.players[0].reserved[0];
        let hidden_id = s.players[1].reserved[0];
        let mut changed = s.clone();
        let last = changed.decks[0].len() - 1;
        std::mem::swap(&mut changed.players[1].reserved[0], &mut changed.decks[0][last]);
        for deck in &mut changed.decks { deck.reverse(); }
        assert_ne!(s, changed);
        assert_eq!(s.observation(0), changed.observation(0));
        assert_eq!(encode_state(&s), encode_state(&changed));
        assert_eq!(legal_mask(&s), legal_mask(&changed));
        assert_ne!(s.observation(1), changed.observation(1), "owner sees their card");
        assert_eq!(s.observation(0).players[1].reserved, vec![None]);
        assert_eq!(s.observation(1).players[1].reserved, vec![Some(hidden_id)]);
        assert_eq!(s.observation(1).players[0].reserved, vec![Some(known_id)], "public reserve is remembered");
        let json = serde_json::to_value(s.observation(0)).unwrap();
        assert!(json.get("decks").is_none());
        assert_eq!(json["deck_sizes"][0], s.decks[0].len());
    }
}

#[test]
fn payment_options_are_independent_of_future_replacement() {
    let mut a = GameState::new(2, 42);
    let id = a.display[0][0].unwrap();
    a.players[0].tokens[..5].copy_from_slice(&card(id).cost);
    a.players[0].tokens[GOLD] = 1;
    let mut b = a.clone();
    b.decks[0].reverse();
    a.apply(&Action::BuyDisplay { tier: 0, slot: 0 }).unwrap();
    b.apply(&Action::BuyDisplay { tier: 0, slot: 0 }).unwrap();
    while a.phase == Phase::PayCard {
        assert_eq!(a.observation(0), b.observation(0));
        assert_eq!(encode_state(&a), encode_state(&b));
        assert_eq!(a.legal_actions(), b.legal_actions());
        let action = a.legal_actions()[0].clone();
        a.apply(&action).unwrap();
        b.apply(&action).unwrap();
    }
    assert_ne!(a.display[0][0], b.display[0][0]);
}

#[test]
fn reserved_purchase_reveals_only_the_announced_card() {
    let mut s = GameState::new(2, 7);
    s.apply(&Action::ReserveDeck { tier: 0 }).unwrap();
    s.apply(&Action::ReserveDeck { tier: 0 }).unwrap();
    let id = s.players[0].reserved[0];
    s.players[0].tokens[..5].copy_from_slice(&card(id).cost);
    assert_eq!(s.observation(1).players[0].reserved, vec![None]);
    s.apply(&Action::BuyReserved { idx: 0 }).unwrap();
    assert_eq!(s.observation(1).players[0].reserved, vec![Some(id)]);
    pay_all(&mut s);
    assert!(s.players[0].reserved.is_empty());
    assert!(s.players[0].reserved_public.is_empty());
}

#[test]
fn gold_and_newly_taken_tokens_may_be_returned() {
    let mut s = GameState::new(2, 3);
    s.players[0].tokens = [2, 2, 2, 2, 2, 0];
    let gold = s.bank[GOLD];
    s.apply(&Action::ReserveDeck { tier: 0 }).unwrap();
    assert_eq!(s.phase, Phase::Discard);
    s.apply(&Action::Discard(GOLD as u8)).unwrap();
    assert_eq!(s.players[0].token_count(), 10);
    assert_eq!(s.bank[GOLD], gold);
    assert_eq!(s.players[0].reserved.len(), 1);
    s.current = 0;
    s.apply(&Action::TakeDistinct(vec![Color::White, Color::Blue, Color::Green])).unwrap();
    for c in [Color::White, Color::Blue, Color::Green] {
        s.apply(&Action::Discard(c.idx() as u8)).unwrap();
    }
    assert_eq!(s.players[0].tokens, [2, 2, 2, 2, 2, 0]);
}

#[test]
fn round_completion_and_ties_work_for_two_to_four_players() {
    for n in 2..=4 {
        let mut s = GameState::new(n, 3);
        s.players[0].points = 15;
        for seat in 0..n {
            assert_eq!(s.current, seat);
            let view = s.observation(seat);
            assert!(view.final_round_triggered);
            assert_eq!(view.turns_until_round_end, n - seat);
            assert_eq!(view.players[seat].seat, seat);
            s.apply(&Action::ReserveDeck { tier: 0 }).unwrap();
            assert_eq!(s.phase == Phase::GameOver, seat == n - 1);
        }
        assert_eq!(s.round, 1);
        assert_eq!(s.winners(), vec![0]);
        s.players[1].points = 15;
        s.players[0].owned = vec![0, 1];
        s.players[1].owned = vec![2];
        assert_eq!(s.winners(), vec![1]);
        s.players[0].owned = vec![0];
        assert_eq!(s.winners(), vec![0, 1]);
    }
}

#[test]
fn out_of_range_actions_return_errors_without_mutation() {
    let mut s = GameState::new(2, 7);
    for action in [Action::BuyDisplay { tier: 9, slot: 9 }, Action::ReserveDeck { tier: 9 },
        Action::ReserveDisplay { tier: 9, slot: 9 }, Action::BuyReserved { idx: 9 }] {
        let before = s.clone();
        assert!(s.apply(&action).is_err());
        assert_eq!(s, before);
    }
}
