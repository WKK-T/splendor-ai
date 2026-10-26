use rand::seq::SliceRandom;
use rand_chacha::ChaCha8Rng;
use splendor_core::{card,CardId,GameState,Observation,Player,CARDS};

pub fn determinize(o: &Observation, rng: &mut ChaCha8Rng) -> Result<GameState, String> {
    if o.ruleset_version != "splendor-pv-attribute-nobles-v1" || o.players.len()!=2 || o.viewer>=2 || o.current>=2 || o.viewer!=o.current {
        return Err("requires v2 current-player two-seat observation".into());
    }
    let ids:Vec<usize> = o.nobles.iter().chain(o.players.iter().flat_map(|p| p.nobles.iter())).map(|id|*id as usize).collect();
    if o.noble_catalog.is_empty() || o.noble_catalog.len()>255 || ids.len()!=3 || ids.iter().any(|i|*i>=o.noble_catalog.len()) || ids.iter().collect::<std::collections::HashSet<_>>().len()!=ids.len() || o.noble_catalog.iter().any(|n| n.points==0 || n.points>15 || n.req.iter().any(|x|*x>20)) {return Err("invalid public noble catalog or board".into())}
    let mut seen=[false;90];
    let mut mark=|id:CardId| -> Result<(),String> {
        if id>=90 || seen[id as usize] {return Err("duplicate or invalid visible card".into())}
        seen[id as usize]=true; Ok(())
    };
    for id in o.display.iter().flatten().flatten() {mark(*id)?;}
    for p in &o.players {
        if p.reserved.len()!=p.reserved_tiers.len() || p.reserved.len()!=p.reserved_public.len() {return Err("reservation metadata mismatch".into())}
        for id in p.owned.iter().chain(p.reserved.iter().flatten()) {mark(*id)?;}
    }
    let mut pools:[Vec<CardId>;3]=std::array::from_fn(|_|Vec::new());
    for (id,c) in CARDS.iter().enumerate() {if !seen[id] {pools[(c.tier-1) as usize].push(id as CardId);}}
    for deck in &mut pools {deck.shuffle(rng);}
    let mut players=Vec::new();
    for (i,p) in o.players.iter().enumerate() {
        let mut reserved=Vec::new();
        for (j,id) in p.reserved.iter().enumerate() {
            let tier=p.reserved_tiers[j]; if !(1..=3).contains(&tier) {return Err("invalid reservation tier".into())}
            let cid=match id {Some(id)=>*id,None=>{
                if i==o.viewer || p.reserved_public[j] {return Err("missing visible card".into())}
                pools[(tier-1) as usize].pop().ok_or("empty hidden pool")?
            }};
            if card(cid).tier!=tier {return Err("reservation tier mismatch".into())}
            reserved.push(cid);
        }
        players.push(Player{tokens:p.tokens,bonuses:p.bonuses,points:p.points,reserved,
            reserved_public:p.reserved_public.clone(),owned:p.owned.clone(),nobles:p.nobles.clone()});
    }
    for t in 0..3 {if pools[t].len()!=o.deck_sizes[t] {return Err("deck size/card conservation mismatch".into())}}
    let state=GameState{noble_catalog:o.noble_catalog.clone(),players,bank:o.bank,decks:pools,display:o.display,nobles:o.nobles.clone(),
        current:o.current,phase:o.phase,round:o.round,pending_purchase:o.pending_purchase.clone()};
    if state.observation(o.viewer)!=*o {return Err("reconstructed observation mismatch".into())}
    Ok(state)
}

