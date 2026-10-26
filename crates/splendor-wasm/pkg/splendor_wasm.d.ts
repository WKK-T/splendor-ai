declare namespace wasm_bindgen {
	/* tslint:disable */
	/* eslint-disable */
	/**
	 * Static card and noble definitions as JSON, for rendering.
	 */
	export function static_data_json(): string;
	/**
	 * A hint sandbox built ONLY from a filtered observation. Unknown identities
	 * are placeholders, never copied from the live game's hidden state. The
	 * sandbox seals itself at the first draw/reveal and cannot encode it.
	 */
	export class WasmAnalysis {
	  free(): void;
	  constructor(json: string);
	  observation_json(): string;
	  encode(): Float32Array;
	  mask(): Uint8Array;
	  step(idx: number): string;
	}
	export class WasmGame {
	  free(): void;
	  constructor(n_players: number, seed: bigint);
	  /**
	   * Only legally visible information; never export the actual deck order.
	   */
	  observation_json(viewer: number): string;
	  /**
	   * Temporary baseline until a policy is retrained on the patched rules.
	   */
	  greedy_index(): number;
	  legal_indices(): Uint32Array;
	  apply_index(idx: number): void;
	  /**
	   * End only the current turn under the optional browser time limit.
	   */
	  finish_timed_out_turn(): void;
	  /**
	   * ML observation vector for the current player.
	   */
	  encode(): Float32Array;
	  /**
	   * Legality mask (1 = legal) over the versioned action space.
	   */
	  mask(): Uint8Array;
	  current(): number;
	  phase(): string;
	  round(): number;
	  winners(): Uint32Array;
	}
	
}

declare type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

declare interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_wasmgame_free: (a: number, b: number) => void;
  readonly wasmgame_new: (a: number, b: bigint) => [number, number, number];
  readonly wasmgame_observation_json: (a: number, b: number) => [number, number, number, number];
  readonly wasmgame_greedy_index: (a: number) => [number, number, number];
  readonly wasmgame_legal_indices: (a: number) => [number, number];
  readonly wasmgame_apply_index: (a: number, b: number) => [number, number];
  readonly wasmgame_finish_timed_out_turn: (a: number) => [number, number];
  readonly wasmgame_encode: (a: number) => [number, number];
  readonly wasmgame_mask: (a: number) => [number, number];
  readonly wasmgame_current: (a: number) => number;
  readonly wasmgame_phase: (a: number) => [number, number];
  readonly wasmgame_round: (a: number) => number;
  readonly wasmgame_winners: (a: number) => [number, number];
  readonly static_data_json: () => [number, number];
  readonly __wbg_wasmanalysis_free: (a: number, b: number) => void;
  readonly wasmanalysis_new: (a: number, b: number) => [number, number, number];
  readonly wasmanalysis_observation_json: (a: number) => [number, number, number, number];
  readonly wasmanalysis_encode: (a: number) => [number, number, number, number];
  readonly wasmanalysis_mask: (a: number) => [number, number, number, number];
  readonly wasmanalysis_step: (a: number, b: number) => [number, number, number, number];
  readonly __wbindgen_export_0: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_start: () => void;
}

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
declare function wasm_bindgen (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
