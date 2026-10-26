//! Portable transport only. SearchCore and the rules are copied unchanged.
use super::*;
use std::cell::RefCell;
use serde_json::{json, Value};

thread_local! {
    static SEARCH: RefCell<Option<SearchCore>> = const { RefCell::new(None) };
    static RESPONSE: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let buffer = vec![0u8; len].into_boxed_slice();
    Box::into_raw(buffer) as *mut u8
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

fn dispatch(v: Value) -> Result<Value, String> {
    SEARCH.with(|cell| {
        let mut slot = cell.borrow_mut();
        let text = v["command"].as_str().ok_or("missing command")?;
        if text == "new" {
            *slot = Some(SearchCore::new(v["observation"].as_str().ok_or("missing observation")?,
                v["budget"].as_u64().ok_or("missing budget")? as usize,
                v["seed"].as_u64().ok_or("missing seed")?,
                v["cpuct"].as_f64().ok_or("missing cpuct")?,
                v["max_decisions"].as_u64().ok_or("missing max_decisions")? as usize)?);
            return Ok(json!(true));
        }
        let search = slot.as_mut().ok_or("search is not initialized")?;
        match text {
            "requests" => Ok(match search.request() {
                Some(r) => json!([[r.id, r.kind, r.observation, r.legal, r.observation_json]]),
                None => json!([]),
            }),
            "done" => Ok(json!(search.done())),
            "result" => serde_json::to_value(search.result()?).map_err(|e| e.to_string()),
            "submit" => {
                let id = v["id"].as_u64().ok_or("missing request ID")?;
                let p: Vec<f64> = serde_json::from_value(v["priors"].clone()).map_err(|e|e.to_string())?;
                let value = v["value"].as_f64().ok_or("missing value")?;
                search.submit(id, &p, value)?;
                Ok(json!(true))
            },
            _ => Err("unknown command".into()),
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn call(ptr: *const u8, len: usize) {
    let input = std::slice::from_raw_parts(ptr, len);
    let result = serde_json::from_slice(input).map_err(|e|e.to_string()).and_then(dispatch);
    let reply = match result {Ok(value) => json!({"ok":true,"value":value}),Err(error)=>json!({"ok":false,"error":error})};
    RESPONSE.with(|r| *r.borrow_mut()=serde_json::to_vec(&reply).unwrap());
}

#[no_mangle]
pub extern "C" fn response_ptr() -> *const u8 {RESPONSE.with(|r| r.borrow().as_ptr())}
#[no_mangle]
pub extern "C" fn response_len() -> usize {RESPONSE.with(|r| r.borrow().len())}
