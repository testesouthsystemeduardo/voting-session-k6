/**
 * checks.js — Funções de validação de resposta HTTP para k6
 *
 * Centraliza os checks comuns e registra counters de falha
 * para aparecerem nos relatórios de forma granular.
 */
import { check } from 'k6';
import { Counter } from 'k6/metrics';

export const errors = {
  createAgenda:  new Counter('errors_create_agenda'),
  openSession:   new Counter('errors_open_session'),
  castVote:      new Counter('errors_cast_vote'),
  getResult:     new Counter('errors_get_result'),
  listAgendas:   new Counter('errors_list_agendas'),
  healthCheck:   new Counter('errors_health_check'),
};

/**
 * Parse JSON defensivo: evita que r.json() lance exceção e derrube o VU
 * quando a API retorna HTML, mensagem de erro não-JSON ou body vazio.
 *
 * @param {Object} res - Resposta HTTP do k6
 * @param {string|null} key - Chave a extrair do JSON (null para o objeto inteiro)
 * @returns {*} Valor extraído ou null em caso de falha
 */
function safeJson(res, key = null) {
  try {
    const parsed = res.json();
    if (key === null) return parsed;
    return parsed != null ? parsed[key] : null;
  } catch (_) {
    return null;
  }
}

/**
 * Loga contexto de erro para facilitar debugging (status, primeiros bytes do body).
 */
function logError(label, res) {
  const body = res.body ? String(res.body).substring(0, 200) : '(empty)';
  console.error(`[check] ${label} → HTTP ${res.status} | body: ${body}`);
}

// ─── Checks por endpoint ──────────────────────────────────────────────────────

/**
 * Valida resposta de criação de pauta.
 * Aceita 201 como sucesso.
 */
export function checkCreateAgenda(res) {
  const ok = check(res, {
    'create agenda: status 201': (r) => r.status === 201,
    'create agenda: has id':     (r) => safeJson(r, 'id') !== null,
    'create agenda: has title':  (r) => safeJson(r, 'title') !== null,
  });
  if (!ok) {
    errors.createAgenda.add(1);
    logError('createAgenda', res);
  }
  return ok;
}

/**
 * Valida resposta de abertura de sessão.
 * Aceita 201 (novo) ou 409 (já existe — tolerável em retry loops).
 */
export function checkOpenSession(res, tolerateConflict = false) {
  const validStatuses = tolerateConflict ? [201, 409] : [201];

  const ok = check(res, {
    'open session: valid status': (r) => validStatuses.includes(r.status),
    'open session: has id':       (r) => r.status === 201 ? safeJson(r, 'id') !== null : true,
  });
  if (!ok) {
    errors.openSession.add(1);
    logError('openSession', res);
  }
  return ok;
}

/**
 * Valida resposta de voto.
 * Aceita 201 (ok) ou 409 (associado já votou — esperado em stress/volume).
 */
export function checkCastVote(res, tolerateDuplicate = false) {
  const validStatuses = tolerateDuplicate ? [201, 409, 422] : [201];

  const ok = check(res, {
    'cast vote: valid status': (r) => validStatuses.includes(r.status),
  });
  if (!ok) {
    errors.castVote.add(1);
    logError('castVote', res);
  }
  return ok;
}

/**
 * Valida resposta de resultado de votação.
 */
export function checkGetResult(res) {
  const ok = check(res, {
    'get result: status 200':     (r) => r.status === 200,
    'get result: has totalVotes': (r) => safeJson(r, 'totalVotes') !== null,
    'get result: has winner':     (r) => safeJson(r, 'winner') !== null,
  });
  if (!ok) {
    errors.getResult.add(1);
    logError('getResult', res);
  }
  return ok;
}

/**
 * Valida resposta de listagem de pautas.
 */
export function checkListAgendas(res) {
  const ok = check(res, {
    'list agendas: status 200': (r) => r.status === 200,
    'list agendas: is array':   (r) => Array.isArray(safeJson(r)),
  });
  if (!ok) {
    errors.listAgendas.add(1);
    logError('listAgendas', res);
  }
  return ok;
}

/**
 * Valida health check da aplicação.
 */
export function checkHealth(res) {
  const ok = check(res, {
    'health: status 200': (r) => r.status === 200,
    'health: is UP':      (r) => safeJson(r, 'status') === 'UP',
  });
  if (!ok) {
    errors.healthCheck.add(1);
    logError('healthCheck', res);
  }
  return ok;
}
