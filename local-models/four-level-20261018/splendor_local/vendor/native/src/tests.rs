use super::*;
use splendor_core::{Action,CARDS};
use splendor_core::bots::{Bot,GreedyBot};

fn finish(search:&mut SearchCore, leaf_value:f64)->ResultData {
    let mut guard=0;
    while !search.done() {
        guard+=1;assert!(guard<100000);
        let r=search.request().unwrap().clone();
        let mut p=vec![1.;NUM_ACTIONS];
        if r.kind=="opponent" {p.fill(0.);p[r.legal.iter().position(|x|*x).unwrap()]=1.;}
        search.submit(r.id,&p,leaf_value).unwrap();
    }
    search.result().unwrap()
}
fn hidden_pair()->(GameState,GameState) {
    let mut s=GameState::new(2,42);
    s.apply(&Action::ReserveDisplay{tier:0,slot:0}).unwrap();
    s.apply(&Action::ReserveDeck{tier:0}).unwrap();
    let mut changed=s.clone();let n=changed.decks[0].len()-1;
    std::mem::swap(&mut changed.players[1].reserved[0],&mut changed.decks[0][n]);
    for d in &mut changed.decks {d.reverse();}
    assert_ne!(s,changed);assert_eq!(s.observation(0),changed.observation(0));
    (s,changed)
}
#[test]
fn card_conservation_and_hidden_world_invariance() {
    let (s,t)=hidden_pair();
    for seed in 0..30 {
        let mut rng=ChaCha8Rng::seed_from_u64(seed);
        let d=determinize(&s.observation(0),&mut rng).unwrap();
        assert_eq!(d.observation(0),s.observation(0));
        let mut cards:Vec<u8>=d.decks.iter().flatten().copied().chain(d.display.iter().flatten().flatten().copied())
            .chain(d.players.iter().flat_map(|p|p.owned.iter().chain(p.reserved.iter())).copied()).collect();
        cards.sort_unstable();assert_eq!(cards,(0..90).collect::<Vec<_>>());
        let mut a=SearchCore::new(&serde_json::to_string(&s.observation(0)).unwrap(),64,seed,1.5,64).unwrap();
        let mut b=SearchCore::new(&serde_json::to_string(&t.observation(0)).unwrap(),64,seed,1.5,64).unwrap();
        assert_eq!(serde_json::to_string(&finish(&mut a,0.2)).unwrap(),serde_json::to_string(&finish(&mut b,0.2)).unwrap());
    }
}
#[test]
fn root_minimum_visits_exact_budget_and_multidepth_tree() {
    let s=GameState::new(2,77);let o=serde_json::to_string(&s.observation(0)).unwrap();
    assert!(SearchCore::new(&o,1,5,1.5,32).is_err());
    let mut search=SearchCore::new(&o,256,5,1.5,32).unwrap();
    let result=finish(&mut search,0.25);
    assert_eq!(result.simulations,256);assert_eq!(result.visits.iter().sum::<u32>(),256);
    assert!(result.max_depth>1);assert!(result.nodes>1);assert!(result.opponent_requests>0);
    for a in s.legal_actions(){assert!(result.visits[action_to_index(&s,&a)]>=1);}
    for (i,legal) in legal_mask(&s).iter().enumerate(){assert_eq!(result.policy[i]>0.,*legal);}
    assert!((result.policy.iter().sum::<f64>()-1.).abs()<1e-9);
}
#[test]
fn opponent_request_hides_root_private_cards_and_ignores_value() {
    let mut s=GameState::new(2,19);
    s.apply(&Action::ReserveDeck{tier:0}).unwrap();
    assert_eq!(s.current,1);
    let mut t=s.clone();let n=t.decks[0].len()-1;
    std::mem::swap(&mut t.players[0].reserved[0],&mut t.decks[0][n]);
    assert_ne!(s.players[0].reserved,t.players[0].reserved);
    let a=Request::from_state(1,"opponent",&s);let b=Request::from_state(1,"opponent",&t);
    assert_eq!(a.observation_json,b.observation_json);assert_eq!(a.observation,b.observation);assert_eq!(a.legal,b.legal);
    let obs:Observation=serde_json::from_str(&a.observation_json).unwrap();assert_eq!(obs.players[0].reserved,vec![None]);
    let p=normalize(&vec![1.;83],&legal_mask(&s)).unwrap();
    assert_eq!(sample(&p,&mut ChaCha8Rng::seed_from_u64(1)),sample(&p,&mut ChaCha8Rng::seed_from_u64(1)));
    // Actual search: change only values returned on opponent requests. They
    // must never enter action selection or root backups.
    let root=GameState::new(2,12);let json=serde_json::to_string(&root.observation(0)).unwrap();
    let run=|opp_value:f64| {let mut search=SearchCore::new(&json,128,90,1.5,32).unwrap();
        while !search.done(){let r=search.request().unwrap().clone();search.submit(r.id,&vec![1.;83],if r.kind=="opponent" {opp_value}else{0.3}).unwrap();}
        search.result().unwrap()};
    assert_eq!(serde_json::to_string(&run(-1.)).unwrap(),serde_json::to_string(&run(1.)).unwrap());
}
#[test]
fn exact_terminal_backup_and_last_round_not_early_win() {
    let mut s=GameState::new(2,11);s.current=1;s.players[1].points=14;s.players[1].bonuses=[7;5];s.players[0].nobles=std::mem::take(&mut s.nobles);
    let o=serde_json::to_string(&s.observation(1)).unwrap();let mut search=SearchCore::new(&o,128,5,1.5,64).unwrap();
    let result=finish(&mut search,-0.9);
    assert!(result.exact_terminal_evaluations>0);
    for a in s.legal_actions(){if let Action::BuyDisplay{tier,slot}=a {let id=s.display[tier as usize][slot as usize].unwrap();
        if CARDS[id as usize].points>0 {assert_eq!(result.q[action_to_index(&s,&Action::BuyDisplay{tier,slot})],1.);}}}
    s.current=0;s.players[0].points=14;s.players[0].bonuses=[7;5];s.players[1].points=0;s.players[1].bonuses=[0;5];
    let a=s.legal_actions().into_iter().find(|a|match a {Action::BuyDisplay{tier,slot}=>CARDS[s.display[*tier as usize][*slot as usize].unwrap() as usize].points>0,_=>false}).unwrap();
    s.apply(&a).unwrap();assert_ne!(s.phase,Phase::GameOver);assert_eq!(s.current,1);assert!(s.observation(1).final_round_triggered);
}
#[test]
fn same_player_payment_does_not_flip_value_and_forced_advancement() {
    let mut s=GameState::new(2,24);s.players[0].tokens=[3;6];
    let a=s.legal_actions().into_iter().find(|a|matches!(a,Action::BuyDisplay{tier:0,..})).unwrap();s.apply(&a).unwrap();
    assert_eq!(s.phase,Phase::PayCard);assert_eq!(s.current,0);assert!(s.legal_actions().len()>1);
    let mut search=SearchCore::new(&serde_json::to_string(&s.observation(0)).unwrap(),64,1,1.5,16).unwrap();
    let result=finish(&mut search,-0.7);
    for a in s.legal_actions(){assert!((result.q[action_to_index(&s,&a)]+0.7).abs()<1e-10);}
    // Remove gold: all payments become forced but must keep their legal color.
    s.players[0].tokens[5]=0;assert_eq!(s.legal_actions().len(),1);
    let search=SearchCore::new(&serde_json::to_string(&s.observation(0)).unwrap(),64,1,1.5,16).unwrap();
    assert!(search.done());let result=search.result().unwrap();assert!(result.forced_root);assert_eq!(result.simulations,0);
    assert_eq!(result.policy[action_to_index(&s,&s.legal_actions()[0])],1.);
}
#[test]
fn invalid_submission_does_not_consume_request() {
    let s=GameState::new(2,11);let mut search=SearchCore::new(&serde_json::to_string(&s.observation(0)).unwrap(),64,1,1.5,16).unwrap();
    let id=search.request().unwrap().id;
    assert!(search.submit(id+1,&vec![1.;83],0.).is_err());assert!(search.submit(id,&vec![-1.;83],0.).is_err());
    assert!(search.submit(id,&vec![1.;83],f64::NAN).is_err());assert_eq!(search.request().unwrap().id,id);
    search.submit(id,&vec![0.;83],1.1).unwrap();let result=finish(&mut search,0.);assert_eq!(result.value_clips,1);
}
#[test]
fn all_reachable_phases_legal_and_conserved() {
    let mut phases=std::collections::BTreeSet::new();let mut bot=GreedyBot;
    for seed in 0..5 {let mut s=GameState::new(2,seed);
        for step in 0..600 {if s.phase==Phase::GameOver{break;}
            let obs=s.observation(s.current);let d=determinize(&obs,&mut ChaCha8Rng::seed_from_u64(step)).unwrap();assert_eq!(obs,d.observation(s.current));
            if step%13==0 || s.phase!=Phase::Play {let mut search=SearchCore::new(&serde_json::to_string(&obs).unwrap(),64,step,1.5,32).unwrap();
                let result=finish(&mut search,0.);for (i,p) in result.policy.iter().enumerate(){if *p>0. {assert!(legal_mask(&s)[i]);}}
                phases.insert(format!("{:?}",s.phase));}
            let a=bot.choose(&s,&s.legal_actions());s.apply(&a).unwrap();
        }
    }
    assert!(phases.contains("Play"));assert!(phases.contains("PayCard"));
}
#[test]
fn privileged_full_state_is_rejected() {assert!(SearchCore::new(&serde_json::to_string(&GameState::new(2,1)).unwrap(),64,1,1.5,32).is_err());}

// Card- and token-conserving regression. The root can reserve its third
// card, discard the granted gold, then both players can be forced to pass.
fn forced_pass_fixture() -> GameState {
    let mut s=GameState::new(2,123);
    let qualified:Vec<u8>=CARDS.iter().enumerate().filter(|(_,c)|
        (c.cost[0]>0 || c.cost[4]>0) && (c.cost[1]>0 || c.cost[2]>0))
        .map(|(i,_)|i as u8).collect();
    let mut used=std::collections::HashSet::new();
    for tier in 0..3 {
        let ids:Vec<u8>=qualified.iter().copied().filter(|id|CARDS[*id as usize].tier==tier as u8+1).take(4).collect();
        assert_eq!(ids.len(),4);
        for (slot,id) in ids.into_iter().enumerate(){s.display[tier][slot]=Some(id);used.insert(id);}
    }
    let reserved:Vec<u8>=qualified.into_iter().filter(|id|!used.contains(id)).take(5).collect();
    s.players[0].reserved=reserved[..2].to_vec();s.players[0].reserved_public=vec![true;2];
    s.players[1].reserved=reserved[2..].to_vec();s.players[1].reserved_public=vec![true;3];
    used.extend(reserved);
    s.players[0].tokens=[0,4,4,2,0,0];s.players[1].tokens=[4,0,0,2,4,0];s.bank=[0,0,0,0,0,5];
    for tier in 0..3 {s.decks[tier]=CARDS.iter().enumerate().filter(|(id,c)|c.tier==tier as u8+1 && !used.contains(&(*id as u8))).map(|(id,_)|id as u8).collect();}
    s
}
#[test]
fn forced_pass_loop_uses_nonterminal_root_value_and_exact_budget() {
    let s=forced_pass_fixture();
    let mut all:Vec<u8>=s.decks.iter().flatten().copied().chain(s.display.iter().flatten().flatten().copied())
        .chain(s.players.iter().flat_map(|p|p.reserved.iter()).copied()).collect();
    all.sort_unstable();assert_eq!(all,(0..90).collect::<Vec<_>>());
    for color in 0..6 {assert_eq!(s.bank[color]+s.players.iter().map(|p|p.tokens[color]).sum::<u8>(),if color==5{5}else{4});}
    let mut search=SearchCore::new(&serde_json::to_string(&s.observation(0)).unwrap(),128,0,1.5,128).unwrap();
    let mut forced_cutoffs=0;
    while !search.done() {
        let r=search.request().unwrap().clone();
        let obs:Observation=serde_json::from_str(&r.observation_json).unwrap();
        if r.kind=="cutoff" && r.legal.iter().filter(|v|**v).count()==1 {
            assert_eq!(obs.current,0);assert_eq!(obs.viewer,0);assert_ne!(obs.phase,Phase::GameOver);
            assert!(obs.round>=128);forced_cutoffs+=1;
        }
        let mut p:Vec<f64>=r.legal.iter().map(|v|if *v{1.}else{0.}).collect();
        if r.legal[30] {p.fill(0.);p[30]=1.;}else if r.legal[65] {p.fill(0.);p[65]=1.;}
        search.submit(r.id,&p,0.375).unwrap();
    }
    let result=search.result().unwrap();
    assert!(forced_cutoffs>0);assert!(result.horizon_evaluations>=forced_cutoffs);
    assert_eq!(result.simulations,128);assert_eq!(result.visits.iter().sum::<u32>(),128);
    assert_eq!(result.exact_terminal_evaluations,0);assert_eq!(result.root_value,0.375);
    for (visits,q) in result.visits.iter().zip(&result.q) {if *visits>0 {assert_eq!(*q,0.375);}}
}
#[test]
fn round_horizon_is_root_perspective_and_terminal_takes_precedence() {
    let mut s=GameState::new(2,44);s.current=1;
    let json=serde_json::to_string(&s.observation(1)).unwrap();
    let mut search=SearchCore::new(&json,64,8,1.5,128).unwrap();
    // Install a root node and a traversed edge exactly as a live simulation.
    search.pending=None;
    search.nodes.insert(search.root_key.clone(),Node::new(&s,&vec![1.;83],0.).unwrap());
    s.round=128;s.current=0;
    let mut sim=Simulation{state:s.clone(),path:vec![(search.root_key.clone(),0)],atomic_steps:0};
    // Opponent is not a value leaf, even after the finite horizon. The request
    // stays policy-only until actual play reaches the root seat.
    search.active=Some(sim.clone_for_test());
    search.advance().unwrap();
    assert_eq!(search.request().unwrap().kind,"opponent");
    assert_eq!(search.horizon_evaluations,0);
    search.pending=None;sim.state.current=1;search.active=Some(sim.clone_for_test());
    search.advance().unwrap();
    let r=search.request().unwrap().clone();assert_eq!(r.kind,"cutoff");
    let o:Observation=serde_json::from_str(&r.observation_json).unwrap();assert_eq!(o.current,1);assert_eq!(o.viewer,1);
    // Avoid starting a second simulation after this controlled single backup.
    search.budget=1;search.submit(r.id,&vec![1.;83],-0.625).unwrap();
    assert_eq!(search.result().unwrap().root_value,-0.625);
    // A true terminal at the same horizon gets exact WDL, with no network call.
    search.budget=2;sim.state.phase=Phase::GameOver;sim.state.players[1].points=15;search.active=Some(sim);
    search.advance().unwrap();assert!(search.request().is_none());
    assert_eq!(search.horizon_evaluations,1);assert_eq!(search.exact_terminal_evaluations,1);
    assert_eq!(search.result().unwrap().root_value,(-0.625+1.)/2.);
}
impl Simulation {
    fn clone_for_test(&self)->Self {Self{state:self.state.clone(),path:self.path.clone(),atomic_steps:self.atomic_steps}}
}
