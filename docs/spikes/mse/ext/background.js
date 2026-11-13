// Registers the page-world hook the way the real extension will: at run time, MAIN world, document_start.
const api = globalThis.browser ?? globalThis.chrome;

async function register() {
  try {
    const existing = await api.scripting.getRegisteredContentScripts({ ids: ['hook'] });
    if (existing.length > 0) {
      return;
    }
    await api.scripting.registerContentScripts([
      { id: 'hook', js: ['hook.js'], matches: ['http://127.0.0.1/*'], world: 'MAIN', runAt: 'document_start', persistAcrossSessions: false },
    ]);
  } catch (error) {
    console.error('spike: could not register the hook', error);
  }
}

void register();
