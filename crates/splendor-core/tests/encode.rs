use splendor_core::bots::{Bot, RandomBot};
use splendor_core::encode::{
    action_to_index, encode_len, encode_state, index_to_action, legal_mask, NUM_ACTIONS,
};
use splendor_core::{GameState, Phase};

#[test]
fn index_roundtrip_covers_whole_space() {
    for i in 0..NUM_ACTIONS {
        assert_eq!(action_to_index(&index_to_action(i)), i);
    }
}

#[test]
fn legal_actions_map_to_distinct_indices_throughout_games() {
    for n_players in 2..=4 {
        for seed in 0..10 {
            let mut s = GameState::new(n_players, seed);
            let mut bot = RandomBot::new(seed);
            while s.phase != Phase::GameOver {
                assert!(s.round < 1000);
                let legal = s.legal_actions();
                let mask = legal_mask(&s);
                assert_eq!(
                    mask.iter().filter(|&&m| m).count(),
                    legal.len(),
                    "each legal action gets a unique index"
                );
                for a in &legal {
                    let i = action_to_index(a);
                    assert!(mask[i]);
                    assert_eq!(&index_to_action(i), a, "roundtrip through the index");
                }

                let obs = encode_state(&s);
                assert_eq!(obs.len(), encode_len(n_players));
                assert!(obs.iter().all(|v| v.is_finite() && (0.0..=1.5).contains(v)));

                let action = bot.choose(&s, &legal);
                s.apply(&action).unwrap();
            }
        }
    }
}

#[test]
fn encoding_is_egocentric() {
    let mut s = GameState::new(2, 5);
    s.players[0].points = 7;
    let obs_p0 = encode_state(&s);
    s.current = 1;
    let obs_p1 = encode_state(&s);
    // Market/bank/nobles identical; absolute turn context intentionally differs.
    let board = splendor_core::encode::encode_len(0);
    assert_eq!(obs_p0[..163], obs_p1[..163]);
    let pf = (obs_p0.len() - board) / 2;
    assert_eq!(obs_p0[board..board + pf], obs_p1[board + pf..]);
    assert_eq!(obs_p0[board + pf..], obs_p1[board..board + pf]);
    assert_ne!(obs_p0[..], obs_p1[..]);
}
