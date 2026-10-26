// Bus de messages partagé entre agents (blackboard pattern).
// N'est actif que si config._sharedBus existe — sinon les outils retournent BUS_NON_ACTIF.

/**
 * Crée un bus de messages isolé pour une session multi-agents.
 * @returns {{ post, readFor, toSummary, clear }}
 */
function createSharedBus() {
  const _log = [];

  return {
    post(from, to, content) {
      _log.push({ from, to: to || 'all', content, ts: Date.now() });
    },
    readFor(role) {
      return _log.filter(m => m.to === 'all' || m.to === role);
    },
    toSummary() {
      return _log.map(m => `[${m.from} → ${m.to}]: ${m.content}`).join('\n');
    },
    get size() { return _log.length; },
  };
}

// ── Outil enable_collaboration ───────────────────────────────────────────────

function enableCollaboration(_args, config, onEvent) {
  if (config._sharedBus) {
    return { ok: true, already_active: true, message: 'Bus de messages déjà actif.' };
  }
  config._sharedBus = createSharedBus();
  onEvent({ type: 'collaboration_enabled' });
  return {
    ok: true,
    message: 'Bus de messages activé. Utilisez post_message et read_messages pour coordonner les sous-agents.',
  };
}

// ── Outil post_message ───────────────────────────────────────────────────────

function postMessage({ to, content }, config, onEvent) {
  const bus = config._sharedBus;
  if (!bus) return { ok: false, error: 'BUS_NON_ACTIF — appelle enable_collaboration d\'abord' };
  if (!content) return { ok: false, error: 'POST_MESSAGE_SANS_CONTENU' };

  const from = config._subRole || 'main';
  const dest = to || 'all';
  bus.post(from, dest, content);
  onEvent({ type: 'bus_message', from, to: dest, content });
  return { ok: true };
}

// ── Outil read_messages ──────────────────────────────────────────────────────

function readMessages({ from: filterFrom } = {}, config) {
  const bus = config._sharedBus;
  if (!bus) return { ok: false, error: 'BUS_NON_ACTIF — appelle enable_collaboration d\'abord' };

  const role = config._subRole || 'main';
  let messages = bus.readFor(role);
  if (filterFrom) messages = messages.filter(m => m.from === filterFrom);

  return { ok: true, messages, count: messages.length };
}

module.exports = { createSharedBus, enableCollaboration, postMessage, readMessages };
