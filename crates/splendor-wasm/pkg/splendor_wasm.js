let wasm_bindgen;
(function() {
    const __exports = {};
    let script_src;
    if (typeof document !== 'undefined' && document.currentScript !== null) {
        script_src = new URL(document.currentScript.src, location.href).toString();
    }
    let wasm = undefined;

    const cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : { decode: () => { throw Error('TextDecoder not available') } } );

    if (typeof TextDecoder !== 'undefined') { cachedTextDecoder.decode(); };

    let cachedUint8ArrayMemory0 = null;

    function getUint8ArrayMemory0() {
        if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
            cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
        }
        return cachedUint8ArrayMemory0;
    }

    function getStringFromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
    }

    function takeFromExternrefTable0(idx) {
        const value = wasm.__wbindgen_export_0.get(idx);
        wasm.__externref_table_dealloc(idx);
        return value;
    }

    let cachedUint32ArrayMemory0 = null;

    function getUint32ArrayMemory0() {
        if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
            cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
        }
        return cachedUint32ArrayMemory0;
    }

    function getArrayU32FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
    }

    let cachedFloat32ArrayMemory0 = null;

    function getFloat32ArrayMemory0() {
        if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
            cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
        }
        return cachedFloat32ArrayMemory0;
    }

    function getArrayF32FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
    }

    function getArrayU8FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
    }
    /**
     * Static card and noble definitions as JSON, for rendering.
     * @returns {string}
     */
    __exports.static_data_json = function() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.static_data_json();
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    };

    let WASM_VECTOR_LEN = 0;

    const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : { encode: () => { throw Error('TextEncoder not available') } } );

    const encodeString = (typeof cachedTextEncoder.encodeInto === 'function'
        ? function (arg, view) {
        return cachedTextEncoder.encodeInto(arg, view);
    }
        : function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    });

    function passStringToWasm0(arg, malloc, realloc) {

        if (realloc === undefined) {
            const buf = cachedTextEncoder.encode(arg);
            const ptr = malloc(buf.length, 1) >>> 0;
            getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
            WASM_VECTOR_LEN = buf.length;
            return ptr;
        }

        let len = arg.length;
        let ptr = malloc(len, 1) >>> 0;

        const mem = getUint8ArrayMemory0();

        let offset = 0;

        for (; offset < len; offset++) {
            const code = arg.charCodeAt(offset);
            if (code > 0x7F) break;
            mem[ptr + offset] = code;
        }

        if (offset !== len) {
            if (offset !== 0) {
                arg = arg.slice(offset);
            }
            ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
            const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
            const ret = encodeString(arg, view);

            offset += ret.written;
            ptr = realloc(ptr, len, offset, 1) >>> 0;
        }

        WASM_VECTOR_LEN = offset;
        return ptr;
    }

    const WasmAnalysisFinalization = (typeof FinalizationRegistry === 'undefined')
        ? { register: () => {}, unregister: () => {} }
        : new FinalizationRegistry(ptr => wasm.__wbg_wasmanalysis_free(ptr >>> 0, 1));
    /**
     * A hint sandbox built ONLY from a filtered observation. Unknown identities
     * are placeholders, never copied from the live game's hidden state. The
     * sandbox seals itself at the first draw/reveal and cannot encode it.
     */
    class WasmAnalysis {

        __destroy_into_raw() {
            const ptr = this.__wbg_ptr;
            this.__wbg_ptr = 0;
            WasmAnalysisFinalization.unregister(this);
            return ptr;
        }

        free() {
            const ptr = this.__destroy_into_raw();
            wasm.__wbg_wasmanalysis_free(ptr, 0);
        }
        /**
         * @param {string} json
         */
        constructor(json) {
            const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmanalysis_new(ptr0, len0);
            if (ret[2]) {
                throw takeFromExternrefTable0(ret[1]);
            }
            this.__wbg_ptr = ret[0] >>> 0;
            WasmAnalysisFinalization.register(this, this.__wbg_ptr, this);
            return this;
        }
        /**
         * @returns {string}
         */
        observation_json() {
            let deferred2_0;
            let deferred2_1;
            try {
                const ret = wasm.wasmanalysis_observation_json(this.__wbg_ptr);
                var ptr1 = ret[0];
                var len1 = ret[1];
                if (ret[3]) {
                    ptr1 = 0; len1 = 0;
                    throw takeFromExternrefTable0(ret[2]);
                }
                deferred2_0 = ptr1;
                deferred2_1 = len1;
                return getStringFromWasm0(ptr1, len1);
            } finally {
                wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
            }
        }
        /**
         * @returns {Float32Array}
         */
        encode() {
            const ret = wasm.wasmanalysis_encode(this.__wbg_ptr);
            if (ret[3]) {
                throw takeFromExternrefTable0(ret[2]);
            }
            var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
        /**
         * @returns {Uint8Array}
         */
        mask() {
            const ret = wasm.wasmanalysis_mask(this.__wbg_ptr);
            if (ret[3]) {
                throw takeFromExternrefTable0(ret[2]);
            }
            var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
            return v1;
        }
        /**
         * @param {number} idx
         * @returns {string}
         */
        step(idx) {
            let deferred2_0;
            let deferred2_1;
            try {
                const ret = wasm.wasmanalysis_step(this.__wbg_ptr, idx);
                var ptr1 = ret[0];
                var len1 = ret[1];
                if (ret[3]) {
                    ptr1 = 0; len1 = 0;
                    throw takeFromExternrefTable0(ret[2]);
                }
                deferred2_0 = ptr1;
                deferred2_1 = len1;
                return getStringFromWasm0(ptr1, len1);
            } finally {
                wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
            }
        }
    }
    __exports.WasmAnalysis = WasmAnalysis;

    const WasmGameFinalization = (typeof FinalizationRegistry === 'undefined')
        ? { register: () => {}, unregister: () => {} }
        : new FinalizationRegistry(ptr => wasm.__wbg_wasmgame_free(ptr >>> 0, 1));

    class WasmGame {

        __destroy_into_raw() {
            const ptr = this.__wbg_ptr;
            this.__wbg_ptr = 0;
            WasmGameFinalization.unregister(this);
            return ptr;
        }

        free() {
            const ptr = this.__destroy_into_raw();
            wasm.__wbg_wasmgame_free(ptr, 0);
        }
        /**
         * @param {number} n_players
         * @param {bigint} seed
         */
        constructor(n_players, seed) {
            const ret = wasm.wasmgame_new(n_players, seed);
            if (ret[2]) {
                throw takeFromExternrefTable0(ret[1]);
            }
            this.__wbg_ptr = ret[0] >>> 0;
            WasmGameFinalization.register(this, this.__wbg_ptr, this);
            return this;
        }
        /**
         * Only legally visible information; never export the actual deck order.
         * @param {number} viewer
         * @returns {string}
         */
        observation_json(viewer) {
            let deferred2_0;
            let deferred2_1;
            try {
                const ret = wasm.wasmgame_observation_json(this.__wbg_ptr, viewer);
                var ptr1 = ret[0];
                var len1 = ret[1];
                if (ret[3]) {
                    ptr1 = 0; len1 = 0;
                    throw takeFromExternrefTable0(ret[2]);
                }
                deferred2_0 = ptr1;
                deferred2_1 = len1;
                return getStringFromWasm0(ptr1, len1);
            } finally {
                wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
            }
        }
        /**
         * Temporary baseline until a policy is retrained on the patched rules.
         * @returns {number}
         */
        greedy_index() {
            const ret = wasm.wasmgame_greedy_index(this.__wbg_ptr);
            if (ret[2]) {
                throw takeFromExternrefTable0(ret[1]);
            }
            return ret[0] >>> 0;
        }
        /**
         * @returns {Uint32Array}
         */
        legal_indices() {
            const ret = wasm.wasmgame_legal_indices(this.__wbg_ptr);
            var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
        /**
         * @param {number} idx
         */
        apply_index(idx) {
            const ret = wasm.wasmgame_apply_index(this.__wbg_ptr, idx);
            if (ret[1]) {
                throw takeFromExternrefTable0(ret[0]);
            }
        }
        /**
         * End only the current turn under the optional browser time limit.
         */
        finish_timed_out_turn() {
            const ret = wasm.wasmgame_finish_timed_out_turn(this.__wbg_ptr);
            if (ret[1]) {
                throw takeFromExternrefTable0(ret[0]);
            }
        }
        /**
         * ML observation vector for the current player.
         * @returns {Float32Array}
         */
        encode() {
            const ret = wasm.wasmgame_encode(this.__wbg_ptr);
            var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
        /**
         * Legality mask (1 = legal) over the versioned action space.
         * @returns {Uint8Array}
         */
        mask() {
            const ret = wasm.wasmgame_mask(this.__wbg_ptr);
            var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
            return v1;
        }
        /**
         * @returns {number}
         */
        current() {
            const ret = wasm.wasmgame_current(this.__wbg_ptr);
            return ret >>> 0;
        }
        /**
         * @returns {string}
         */
        phase() {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.wasmgame_phase(this.__wbg_ptr);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * @returns {number}
         */
        round() {
            const ret = wasm.wasmgame_round(this.__wbg_ptr);
            return ret >>> 0;
        }
        /**
         * @returns {Uint32Array}
         */
        winners() {
            const ret = wasm.wasmgame_winners(this.__wbg_ptr);
            var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
    }
    __exports.WasmGame = WasmGame;

    async function __wbg_load(module, imports) {
        if (typeof Response === 'function' && module instanceof Response) {
            if (typeof WebAssembly.instantiateStreaming === 'function') {
                try {
                    return await WebAssembly.instantiateStreaming(module, imports);

                } catch (e) {
                    if (module.headers.get('Content-Type') != 'application/wasm') {
                        console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                    } else {
                        throw e;
                    }
                }
            }

            const bytes = await module.arrayBuffer();
            return await WebAssembly.instantiate(bytes, imports);

        } else {
            const instance = await WebAssembly.instantiate(module, imports);

            if (instance instanceof WebAssembly.Instance) {
                return { instance, module };

            } else {
                return instance;
            }
        }
    }

    function __wbg_get_imports() {
        const imports = {};
        imports.wbg = {};
        imports.wbg.__wbindgen_error_new = function(arg0, arg1) {
            const ret = new Error(getStringFromWasm0(arg0, arg1));
            return ret;
        };
        imports.wbg.__wbindgen_init_externref_table = function() {
            const table = wasm.__wbindgen_export_0;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
            ;
        };
        imports.wbg.__wbindgen_throw = function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        };

        return imports;
    }

    function __wbg_init_memory(imports, memory) {

    }

    function __wbg_finalize_init(instance, module) {
        wasm = instance.exports;
        __wbg_init.__wbindgen_wasm_module = module;
        cachedFloat32ArrayMemory0 = null;
        cachedUint32ArrayMemory0 = null;
        cachedUint8ArrayMemory0 = null;


        wasm.__wbindgen_start();
        return wasm;
    }

    function initSync(module) {
        if (wasm !== undefined) return wasm;


        if (typeof module !== 'undefined') {
            if (Object.getPrototypeOf(module) === Object.prototype) {
                ({module} = module)
            } else {
                console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
            }
        }

        const imports = __wbg_get_imports();

        __wbg_init_memory(imports);

        if (!(module instanceof WebAssembly.Module)) {
            module = new WebAssembly.Module(module);
        }

        const instance = new WebAssembly.Instance(module, imports);

        return __wbg_finalize_init(instance, module);
    }

    async function __wbg_init(module_or_path) {
        if (wasm !== undefined) return wasm;


        if (typeof module_or_path !== 'undefined') {
            if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
                ({module_or_path} = module_or_path)
            } else {
                console.warn('using deprecated parameters for the initialization function; pass a single object instead')
            }
        }

        if (typeof module_or_path === 'undefined' && typeof script_src !== 'undefined') {
            module_or_path = script_src.replace(/\.js$/, '_bg.wasm');
        }
        const imports = __wbg_get_imports();

        if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
            module_or_path = fetch(module_or_path);
        }

        __wbg_init_memory(imports);

        const { instance, module } = await __wbg_load(await module_or_path, imports);

        return __wbg_finalize_init(instance, module);
    }

    wasm_bindgen = Object.assign(__wbg_init, { initSync }, __exports);

})();
