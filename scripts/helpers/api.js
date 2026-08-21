/**
 * api.js — Cliente HTTP para a API voting-session
 *
 * Centraliza todas as chamadas HTTP com headers padrão,
 * facilitando reutilização nos 5 tipos de teste.
 */
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8081';
const API_V1   = `${BASE_URL}/api/v1/agendas`;

// Timeout padrão: 10s. Ajustável via K6_TIMEOUT env.
// Evita que timeouts de TCP (30s padrão do kernel) travem os VUs
// e inflem artificialmente a duração do teste.
const TIMEOUT = __ENV.K6_TIMEOUT || '10s';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Accept':       'application/json',
};

const JSON_PARAMS = {
  headers: JSON_HEADERS,
  timeout: TIMEOUT,
};

const GET_PARAMS = {
  headers: JSON_HEADERS,
  timeout: TIMEOUT,
};

// ─── Agendas ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/agendas
 * Cria uma nova pauta de votação.
 */
export function createAgenda(title, description = '') {
  return http.post(
    API_V1,
    JSON.stringify({ title, description }),
    { ...JSON_PARAMS, tags: { endpoint: 'create_agenda' } }
  );
}

/**
 * GET /api/v1/agendas?page=0&size=20
 * Lista pautas com paginação para evitar full table scan.
 * A API suporta ?page=N&size=N (máx 100 por página).
 */
export function listAgendas(page = 0, size = 20) {
  return http.get(`${API_V1}?page=${page}&size=${size}`, {
    ...GET_PARAMS,
    tags: { endpoint: 'list_agendas' },
  });
}

/**
 * GET /api/v1/agendas/{agendaId}
 * Retorna uma pauta específica.
 */
export function getAgenda(agendaId) {
  return http.get(`${API_V1}/${agendaId}`, {
    ...GET_PARAMS,
    tags: { endpoint: 'get_agenda' },
  });
}

// ─── Sessão ──────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/agendas/{agendaId}/session
 * Abre sessão de votação. durationMinutes padrão = 60 (testes longos).
 */
export function openSession(agendaId, durationMinutes = 60) {
  return http.post(
    `${API_V1}/${agendaId}/session`,
    JSON.stringify({ durationMinutes }),
    { ...JSON_PARAMS, tags: { endpoint: 'open_session' } }
  );
}

// ─── Votos ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/agendas/{agendaId}/votes
 * Registra voto de um associado. choice: 'Sim' | 'Não'
 */
export function castVote(agendaId, associateId, choice = 'Sim') {
  return http.post(
    `${API_V1}/${agendaId}/votes`,
    JSON.stringify({ associateId, choice }),
    { ...JSON_PARAMS, tags: { endpoint: 'cast_vote' } }
  );
}

// ─── Resultado ───────────────────────────────────────────────────────────────

/**
 * GET /api/v1/agendas/{agendaId}/result
 * Retorna resultado consolidado da votação.
 */
export function getResult(agendaId) {
  return http.get(`${API_V1}/${agendaId}/result`, {
    ...GET_PARAMS,
    tags: { endpoint: 'get_result' },
  });
}

// ─── Health ──────────────────────────────────────────────────────────────────

/**
 * GET /actuator/health
 * Verifica saúde da aplicação.
 */
/**
 * Health check simples — usa K6_TIMEOUT (para VUs durante o teste).
 */
export function healthCheck() {
  return http.get(`${BASE_URL}/actuator/health`, {
    timeout: TIMEOUT,
    tags: { endpoint: 'health' },
  });
}

/**
 * Health check do seed — timeout maior para suportar inicialização lenta.
 * O KafkaHealthIndicator pode atrasar o /actuator/health por até 30s
 * se o broker ainda estiver warm-up.
 *
 * Usa 30s (independente do K6_TIMEOUT dos requests normais).
 */
export function healthCheckSeed() {
  // 5s — o pre-flight do run-test.sh já espera a API subir.
  // 30s aqui estoura o setupTimeout padrão do k6 (60s) na 2ª tentativa.
  const SEED_HEALTH_TIMEOUT = __ENV.SEED_HEALTH_TIMEOUT || '5s';
  return http.get(`${BASE_URL}/actuator/health`, {
    timeout: SEED_HEALTH_TIMEOUT,
    tags: { endpoint: 'health-seed' },
  });
}

// ─── Fluxo completo ──────────────────────────────────────────────────────────

/**
 * Fluxo completo: cria pauta → abre sessão → vota → retorna resultado.
 * Retorna { agendaId, sessionId, voteId, resultResponse }
 */
export function fullVotingFlow(title, associateId, choice = 'Sim', sessionDuration = 60) {
  const agendaRes = createAgenda(title, 'k6 performance test');
  if (agendaRes.status !== 201) {
    return { agendaRes, error: 'create_agenda_failed' };
  }

  const agendaId = agendaRes.json('id');

  const sessionRes = openSession(agendaId, sessionDuration);
  if (sessionRes.status !== 201) {
    return { agendaRes, sessionRes, error: 'open_session_failed' };
  }

  const voteRes = castVote(agendaId, associateId, choice);
  // castVote retorna 202 Accepted (assíncrono via Kafka) — não bloquear em 201

  const resultRes = getResult(agendaId);

  return { agendaId, agendaRes, sessionRes, voteRes, resultRes };
}
