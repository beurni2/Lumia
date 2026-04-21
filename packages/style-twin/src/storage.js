import { SCHEMA_VERSION, STORAGE_KEY } from "./types";
let backend = null;
export function configureBackend(impl) {
    backend = impl;
}
function requireBackend() {
    if (!backend) {
        throw new Error("@workspace/style-twin: secure storage backend not configured. " +
            "Call configureBackend() at app startup.");
    }
    return backend;
}
export async function loadTwin() {
    const raw = await requireBackend().getItem(STORAGE_KEY);
    if (!raw)
        return null;
    try {
        const env = JSON.parse(raw);
        if (env.schema !== SCHEMA_VERSION)
            return null;
        return env.twin;
    }
    catch {
        return null;
    }
}
export async function saveTwin(twin) {
    const env = { schema: SCHEMA_VERSION, twin };
    await requireBackend().setItem(STORAGE_KEY, JSON.stringify(env));
}
export async function wipe() {
    await requireBackend().deleteItem(STORAGE_KEY);
}
/** In-memory backend for tests and SSR. */
export class MemoryBackend {
    store = new Map();
    async getItem(key) {
        return this.store.get(key) ?? null;
    }
    async setItem(key, value) {
        this.store.set(key, value);
    }
    async deleteItem(key) {
        this.store.delete(key);
    }
}
