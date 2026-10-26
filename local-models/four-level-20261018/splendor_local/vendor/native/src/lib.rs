//! Neural, observation-keyed root-player PUCT against a sampled visible-policy
//! opponent. This is a limited information-set planning approximation, NOT
//! omniscient minimax and NOT a claim of equilibrium information-set MCTS.
mod belief;
use belief::determinize;
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::Serialize;
use splendor_core::encode::NUM_ACTIONS;
use splendor_core::Action;
use splendor_core::{GameState, Observation, Phase};
use std::collections::HashMap;
#[cfg(not(test))]
use pyo3::prelude::*;

fn action_to_index(s:&GameState,a:&Action)->usize {
    if let Action::ChooseNoble(id)=a {66+s.nobles.iter().position(|n|n==id).expect("noble available")} else {splendor_core::encode::action_to_index(a)}
}
fn index_to_action(s:&GameState,i:usize)->Action {
    if (66..76).contains(&i) {Action::ChooseNoble(s.nobles[i-66])} else {splendor_core::encode::index_to_action(i)}
}
fn legal_mask(s:&GameState)->[bool;NUM_ACTIONS] {let mut mask=[false;NUM_ACTIONS]; for a in s.legal_actions(){mask[action_to_index(s,&a)]=true;}mask}
fn encode_state(s:&GameState)->Vec<f32> {
    let mut x=splendor_core::encode::encode_state(s);x[153..163].fill(0.);
    for slot in 0..5 {if let Some(id)=s.nobles.get(slot){let n=s.noble_tile(*id);x.push(1.);x.push(n.points as f32/3.);for r in n.req{x.push(r as f32/4.);}}else{x.extend([0.;7]);}}x
}

#[derive(Clone, Debug, Serialize)]
pub struct Request {
    pub id: u64,
    pub kind: String,
    pub observation: Vec<f32>,
    pub legal: Vec<bool>,
    pub observation_json: String,
}
impl Request {
    fn from_state(id: u64, kind: &str, s: &GameState) -> Self {
        Self { id, kind: kind.into(), observation: encode_state(s),
            legal: legal_mask(s).to_vec(),
            observation_json: serde_json::to_string(&s.observation(s.current)).unwrap() }
    }
}
#[derive(Clone, Debug)]
struct Edge { action: usize, prior: f64, visits: u32, value_sum: f64 }
#[derive(Clone, Debug)]
struct Node { edges: Vec<Edge>, initial_value: f64 }
impl Node {
    fn new(s: &GameState, priors: &[f64], value: f64) -> Result<Self,String> {
        let probabilities=normalize(priors,&legal_mask(s))?;
        Ok(Self { edges:s.legal_actions().iter().map(|a| {let idx=action_to_index(s,a);
            Edge { action:idx, prior:probabilities[idx], visits:0,value_sum:0. } }).collect(),initial_value:value })
    }
    fn select(&self, cpuct:f64, root:bool) -> usize {
        if root {
            if let Some((idx,_))=self.edges.iter().enumerate().filter(|(_,e)|e.visits==0)
                .max_by(|(_,a),(_,b)|a.prior.total_cmp(&b.prior).then_with(||b.action.cmp(&a.action))) {return idx;}
        }
        let total=self.edges.iter().map(|e|e.visits as f64).sum::<f64>();
        self.edges.iter().enumerate().max_by(|(_,a),(_,b)| {
            let score=|e:&Edge| {let q=if e.visits==0 {self.initial_value}else{e.value_sum/e.visits as f64};
                q+cpuct*e.prior*(total+1.).sqrt()/(1.+e.visits as f64)};
            score(a).total_cmp(&score(b)).then_with(||b.action.cmp(&a.action))
        }).unwrap().0
    }
}
fn normalize(priors:&[f64], legal:&[bool;NUM_ACTIONS])->Result<Vec<f64>,String> {
    if priors.len()!=NUM_ACTIONS || priors.iter().any(|p|!p.is_finite() || *p<0.) {
        return Err("priors must contain 83 finite nonnegative probabilities".into());
    }
    let sum: f64=priors.iter().zip(legal).filter(|(_,l)|**l).map(|(p,_)|*p).sum();
    let count=legal.iter().filter(|x|**x).count();
    if count==0 {return Err("cannot normalize terminal policy".into());}
    Ok(priors.iter().zip(legal).map(|(p,l)|if !l {0.}else if sum>0. {*p/sum}else{1./count as f64}).collect())
}
fn sample(policy:&[f64], rng:&mut ChaCha8Rng)->usize {
    let mut u=rng.random::<f64>(); let mut last=0;
    for (i,p) in policy.iter().enumerate() {if *p>0. {last=i;u-=p;if u<=0. {return i;}}}
    last
}
fn terminal_value(s:&GameState, root:usize)->f64 {
    assert_eq!(s.phase,Phase::GameOver);
    let winners=s.winners(); if !winners.contains(&root) {-1.}else if winners.len()>1 {0.}else{1.}
}
struct Simulation { state:GameState, path:Vec<(String,usize)>, atomic_steps:usize }
struct Pending { request:Request, key:String }
#[derive(Serialize)]
pub struct ResultData {
    pub policy:Vec<f64>, pub visits:Vec<u32>, pub q:Vec<f64>, pub root_value:f64,
    pub initial_value:f64, pub simulations:usize, pub requested_budget:usize,
    pub nodes:usize, pub max_depth:usize, pub forced_steps:usize, pub opponent_requests:usize,
    pub cached_opponent_steps:usize, pub network_requests:usize, pub exact_terminal_evaluations:usize,
    pub horizon_evaluations:usize, pub value_clips:usize, pub root_player:usize, pub forced_root:bool,
    pub method:&'static str,
}
pub struct SearchCore {
    root_observation:Observation, root_key:String, root_player:usize, root_state:GameState,
    budget:usize, cpuct:f64, max_decisions:usize, rng:ChaCha8Rng,
    nodes:HashMap<String,Node>, opponent_cache:HashMap<String,Vec<f64>>,
    active:Option<Simulation>, pending:Option<Pending>, next_request:u64,
    simulations:usize, max_depth:usize, forced_steps:usize, opponent_requests:usize,
    cached_opponent_steps:usize, network_requests:usize, exact_terminal_evaluations:usize,
    horizon_evaluations:usize, value_clips:usize, forced_root:bool,
}
impl SearchCore {
    pub fn new(observation_json:&str,budget:usize,seed:u64,cpuct:f64,max_decisions:usize)->Result<Self,String> {
        if !cpuct.is_finite() || cpuct<=0. || max_decisions==0 {return Err("positive cpuct and max_decisions required".into());}
        let o:Observation=serde_json::from_str(observation_json).map_err(|e|e.to_string())?;
        let mut rng=ChaCha8Rng::seed_from_u64(seed);let state=determinize(&o,&mut rng)?;
        let legal=state.legal_actions();if legal.is_empty(){return Err("terminal root has no decision".into());}
        let forced=legal.len()==1;
        if !forced && budget<legal.len(){return Err(format!("budget {} smaller than {} legal root actions",budget,legal.len()));}
        let key=serde_json::to_string(&o).unwrap();
        let mut result=Self{root_player:o.viewer,root_observation:o,root_key:key.clone(),root_state:state.clone(),budget,cpuct,max_decisions,rng,
            nodes:HashMap::new(),opponent_cache:HashMap::new(),active:None,pending:None,next_request:0,
            simulations:0,max_depth:0,forced_steps:0,opponent_requests:0,cached_opponent_steps:0,
            network_requests:0,exact_terminal_evaluations:0,horizon_evaluations:0,value_clips:0,forced_root:forced};
        if forced {result.nodes.insert(key,Node::new(&state,&vec![1.;NUM_ACTIONS],0.)?);}else{result.set_request("root",key,&state);}
        Ok(result)
    }
    fn set_request(&mut self,kind:&str,key:String,s:&GameState) {
        assert!(self.pending.is_none()); self.next_request+=1;self.network_requests+=1;
        if kind=="opponent" {self.opponent_requests+=1;}
        self.pending=Some(Pending{request:Request::from_state(self.next_request,kind,s),key});
    }
    pub fn request(&self)->Option<&Request> {self.pending.as_ref().map(|p|&p.request)}
    pub fn done(&self)->bool {self.forced_root || (self.simulations==self.budget && self.pending.is_none() && self.active.is_none())}
    pub fn submit(&mut self,id:u64,priors:&[f64],value:f64)->Result<(),String> {
        let p=self.pending.as_ref().ok_or("no pending request")?;
        if id!=p.request.id {return Err("request id does not match current pending request".into());}
        if !value.is_finite(){return Err("network value must be finite".into());}
        // Validate before taking the request, so a malformed submission can be retried.
        let legal:[bool;NUM_ACTIONS]=p.request.legal.clone().try_into().unwrap();
        let probabilities=normalize(priors,&legal)?;
        let p=self.pending.take().unwrap();
        let clipped=value.clamp(-1.,1.);if value!=clipped {self.value_clips+=1;}
        match p.request.kind.as_str() {
            "root"=> {self.nodes.insert(p.key,Node::new(&self.root_state,&probabilities,clipped)?);}
            "opponent"=> {
                let action=sample(&probabilities,&mut self.rng);
                let sim=self.active.as_mut().ok_or("missing simulation")?;
                assert_ne!(sim.state.current,self.root_player);
                sim.state.apply(&index_to_action(&sim.state,action)).map_err(|e|format!("opponent action {e:?}"))?;
                sim.atomic_steps+=1;
                self.opponent_cache.insert(p.key,probabilities);
            }
            "leaf"=> {
                let state=&self.active.as_ref().ok_or("missing simulation")?.state;
                assert_eq!(state.current,self.root_player);
                self.nodes.insert(p.key,Node::new(state,&probabilities,clipped)?);
                self.backup(clipped)?;
            }
            "cutoff"=> {assert_eq!(self.active.as_ref().unwrap().state.current,self.root_player);self.backup(clipped)?;}
            _=>return Err("invalid request kind".into()),
        }
        self.advance()
    }
    fn backup(&mut self,value:f64)->Result<(),String> {
        let sim=self.active.take().ok_or("backup without simulation")?;
        self.max_depth=self.max_depth.max(sim.path.len());
        // Every node belongs to ROOT, including same-player payment/noble phases.
        // There is no alternating sign per atomic step.
        for (key,edge_idx) in sim.path {let e=&mut self.nodes.get_mut(&key).ok_or("missing node")?.edges[edge_idx];e.visits+=1;e.value_sum+=value;}
        self.simulations+=1;Ok(())
    }
    fn advance(&mut self)->Result<(),String> {
        while self.pending.is_none() && self.simulations<self.budget {
            if self.active.is_none(){self.active=Some(Simulation{state:determinize(&self.root_observation,&mut self.rng)?,path:Vec::new(),atomic_steps:0});}
            let sim=self.active.as_mut().unwrap();
            if sim.state.phase==Phase::GameOver {let v=terminal_value(&sim.state,self.root_player);self.exact_terminal_evaluations+=1;self.backup(v)?;continue;}
            // The root-decision bound below does not count forced actions. A
            // legal forced-pass cycle can therefore advance forever without
            // growing the path. Bound complete rounds as well, and request the
            // ROOT player's actual neural value even at a forced state. This is
            // a planning horizon, never a draw or a terminal training label.
            // Terminal scoring above takes precedence over this cutoff.
            if sim.state.current==self.root_player
                && sim.state.round.saturating_sub(self.root_observation.round) as usize>=self.max_decisions {
                let state=sim.state.clone();
                let key=serde_json::to_string(&state.observation(self.root_player)).unwrap();
                self.horizon_evaluations+=1;
                self.set_request("cutoff",key,&state);return Ok(());
            }
            if sim.atomic_steps>4096 {return Err("search atomic transition guard exceeded".into());}
            let legal=sim.state.legal_actions();if legal.is_empty(){return Err("nonterminal without legal action".into());}
            if legal.len()==1 {
                sim.state.apply(&legal[0]).map_err(|e|format!("forced action {e:?}"))?;
                sim.atomic_steps+=1;self.forced_steps+=1;continue;
            }
            let key=serde_json::to_string(&sim.state.observation(sim.state.current)).unwrap();
            if sim.state.current!=self.root_player {
                if let Some(policy)=self.opponent_cache.get(&key) {
                    let action=sample(policy,&mut self.rng);sim.state.apply(&index_to_action(&sim.state,action)).map_err(|e|format!("cached opponent action {e:?}"))?;
                    sim.atomic_steps+=1;self.cached_opponent_steps+=1;continue;
                }
                let state=sim.state.clone();self.set_request("opponent",key,&state);return Ok(());
            }
            if sim.path.len()>=self.max_decisions {
                let state=sim.state.clone();self.set_request("cutoff",key,&state);return Ok(());
            }
            match self.nodes.get(&key) {
                None=>{let state=sim.state.clone();self.set_request("leaf",key,&state);return Ok(());}
                Some(node)=>{
                    let is_root=sim.path.is_empty();let edge_idx=node.select(self.cpuct,is_root);let action=node.edges[edge_idx].action;
                    sim.path.push((key,edge_idx));sim.state.apply(&index_to_action(&sim.state,action)).map_err(|e|format!("tree action {e:?}"))?;sim.atomic_steps+=1;
                }
            }
        }
        Ok(())
    }
    pub fn result(&self)->Result<ResultData,String> {
        if !self.done(){return Err("search is not complete".into());}
        let root=self.nodes.get(&self.root_key).ok_or("missing root")?;
        let mut visits=vec![0;NUM_ACTIONS];let mut q=vec![0.;NUM_ACTIONS];let mut policy=vec![0.;NUM_ACTIONS];
        let total:u32=root.edges.iter().map(|e|e.visits).sum();let mut value_sum=0.;
        for e in &root.edges {visits[e.action]=e.visits;q[e.action]=if e.visits>0 {e.value_sum/e.visits as f64}else{0.};
            policy[e.action]=if self.forced_root {1.}else{e.visits as f64/total as f64};value_sum+=e.value_sum;}
        if !self.forced_root && total as usize!=self.budget {return Err("root visit/budget accounting mismatch".into());}
        Ok(ResultData{policy,visits,q,root_value:if total>0 {value_sum/total as f64}else{0.},initial_value:root.initial_value,
            simulations:self.simulations,requested_budget:self.budget,nodes:self.nodes.len(),max_depth:self.max_depth,forced_steps:self.forced_steps,
            opponent_requests:self.opponent_requests,cached_opponent_steps:self.cached_opponent_steps,network_requests:self.network_requests,
            exact_terminal_evaluations:self.exact_terminal_evaluations,horizon_evaluations:self.horizon_evaluations,value_clips:self.value_clips,root_player:self.root_player,forced_root:self.forced_root,
            method:"root_player_infoset_puct_vs_visible_neural_policy"})
    }
}

#[cfg(not(test))]
#[pyclass(name="Search")]
struct PySearch { inner:SearchCore }
#[cfg(not(test))]
#[pymethods]
impl PySearch {
    #[new]
    #[pyo3(signature=(observation_json,budget,seed,cpuct=1.5,max_decisions=128))]
    fn new(observation_json:&str,budget:usize,seed:u64,cpuct:f64,max_decisions:usize)->PyResult<Self>{Ok(Self{inner:SearchCore::new(observation_json,budget,seed,cpuct,max_decisions).map_err(|e|pyo3::exceptions::PyValueError::new_err(e.to_string()))?})}
    fn requests(&self)->Vec<(u64,String,Vec<f32>,Vec<bool>,String)>{self.inner.request().map(|r|vec![(r.id,r.kind.clone(),r.observation.clone(),r.legal.clone(),r.observation_json.clone())]).unwrap_or_default()}
    fn submit(&mut self,py:Python<'_>,request_id:u64,priors:Vec<f64>,value:f64)->PyResult<()>{py.allow_threads(||self.inner.submit(request_id,&priors,value)).map_err(|e|pyo3::exceptions::PyValueError::new_err(e.to_string()))}
    fn done(&self)->bool {self.inner.done()}
    fn result_json(&self)->PyResult<String>{serde_json::to_string(&self.inner.result().map_err(|e|pyo3::exceptions::PyValueError::new_err(e.to_string()))?).map_err(|e|pyo3::exceptions::PyValueError::new_err(e.to_string()))}
}
#[cfg(not(test))]
#[pyclass(name="Game")]
struct PyGame { state:GameState, steps:usize }
#[cfg(not(test))]
#[pymethods]
impl PyGame {
    #[new]
    #[pyo3(signature=(seed,extra=false))]
    fn new(seed:u64,extra:bool)->Self{let mut state=GameState::new(2,seed);if extra {
        state.noble_catalog.push(splendor_core::Noble{points:3,req:[0,3,3,0,3]});
        state.noble_catalog.push(splendor_core::Noble{points:3,req:[4,0,0,4,0]});
        let pos=(seed%3) as usize;state.nobles[pos]=10+(seed%2) as u8;
        if seed%4==0 {state.nobles[(pos+1)%3]=11-(seed%2) as u8;}
    }Self{state,steps:0}}
    #[staticmethod]
    fn with_tiles(seed:u64,tiles_json:&str)->PyResult<Self> {
        let tiles:Vec<splendor_core::Noble>=serde_json::from_str(tiles_json).map_err(|e|pyo3::exceptions::PyValueError::new_err(e.to_string()))?;
        if tiles.len()!=3 || tiles.iter().any(|n|n.points==0||n.points>15||n.req.iter().any(|x|*x>20)) {return Err(pyo3::exceptions::PyValueError::new_err("requires three valid noble attribute records"));}
        let mut state=GameState::new(2,seed);state.noble_catalog=tiles;state.nobles=vec![0,1,2];Ok(Self{state,steps:0})
    }
    fn clone(&self)->Self{Self{state:self.state.clone(),steps:self.steps}}
    fn current(&self)->usize {self.state.current}
    fn observation(&self)->Vec<f32>{encode_state(&self.state)}
    fn mask(&self)->Vec<bool>{legal_mask(&self.state).to_vec()}
    fn observation_json(&self)->String{serde_json::to_string(&self.state.observation(self.state.current)).unwrap()}
    fn state_json(&self)->String{serde_json::to_string(&self.state).unwrap()}
    #[staticmethod]
    fn from_state_json(state_json:&str,steps:usize)->PyResult<Self>{Ok(Self{state:serde_json::from_str(state_json).map_err(|e|pyo3::exceptions::PyValueError::new_err(e.to_string()))?,steps})}
    fn greedy_index(&self)->PyResult<usize> {
        use splendor_core::bots::{Bot,GreedyBot};
        let legal=self.state.legal_actions();
        if legal.is_empty(){return Err(pyo3::exceptions::PyValueError::new_err("terminal game has no greedy action"));}
        let mut bot=GreedyBot;
        Ok(action_to_index(&self.state,&bot.choose(&self.state,&legal)))
    }
    fn step(&mut self,action:usize)->PyResult<()> {
        if action>=NUM_ACTIONS || !legal_mask(&self.state)[action]{return Err(pyo3::exceptions::PyValueError::new_err("action outside 0..83"));}
        self.state.apply(&index_to_action(&self.state,action)).map_err(|e|pyo3::exceptions::PyValueError::new_err(format!("{e:?}")))?;self.steps+=1;Ok(())
    }
    fn done(&self)->bool{self.state.phase==Phase::GameOver}
    fn result_json(&self)->String {
        let done=self.state.phase==Phase::GameOver;
        serde_json::json!({"done":done,"winners":if done {self.state.winners()}else{vec![]},
            "rewards":if done {(0..2).map(|i|terminal_value(&self.state,i)).collect::<Vec<_>>()}else{vec![]},
            "points":self.state.players.iter().map(|p|p.points).collect::<Vec<_>>(),"round":self.state.round,"steps":self.steps}).to_string()
    }
}
#[cfg(not(test))]
#[pyfunction]
fn static_data_json()->String {
    serde_json::json!({
        "cards":splendor_core::CARDS.iter().enumerate().map(|(id,c)|serde_json::json!({"id":id,"tier":c.tier,"points":c.points,"bonus":c.bonus.idx(),"cost":c.cost})).collect::<Vec<_>>(),
        "nobles":splendor_core::NOBLES.iter().enumerate().map(|(id,n)|serde_json::json!({"id":id,"points":n.points,"req":n.req})).collect::<Vec<_>>()
    }).to_string()
}
#[cfg(not(test))]
#[pymodule]
fn splendor_pv_noble_search(m:&Bound<'_,PyModule>)->PyResult<()> {m.add_class::<PySearch>()?;m.add_class::<PyGame>()?;m.add_function(wrap_pyfunction!(static_data_json,m)?)?;Ok(())}



#[cfg(test)]
mod tests;
