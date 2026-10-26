/**
 * Outil scratchpad — permet au LLM de prendre des notes intra-session.
 * Le scratchpad est injecté via config._scratchpad depuis agent.js.
 */

function useScratchpad({ action, key, value } = {}, scratchpad) {
  if (!scratchpad) return { ok: false, error: 'SCRATCHPAD_NON_DISPONIBLE' };

  switch (action) {
    case 'set':
      if (!key) return { ok: false, error: 'SCRATCHPAD_SANS_CLE' };
      scratchpad.set(key, value ?? '');
      return { ok: true, set: key };

    case 'get':
      if (!key) return { ok: false, error: 'SCRATCHPAD_SANS_CLE' };
      return { ok: true, value: scratchpad.get(key) };

    case 'append':
      if (!key) return { ok: false, error: 'SCRATCHPAD_SANS_CLE' };
      scratchpad.append(key, value ?? '');
      return { ok: true, appended: key };

    case 'list': {
      const data = scratchpad.toJSON();
      const entries = Object.entries(data).map(([k, v]) => ({
        key: k,
        preview: String(v).slice(0, 100),
      }));
      return { ok: true, entries };
    }

    default:
      return { ok: false, error: 'ACTION_INCONNUE' };
  }
}

module.exports = { useScratchpad };
