/**
 * api.js — Cliente HTTP para a API voting-session
 *
 * Centraliza todas as chamadas HTTP com headers padrão,
 * facilitando reutilização nos 5 tipos de teste.
 */
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const API_V1   = `${BASE_URL}/api/v1/agendas`;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Accept':       'application/json',
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
    { headers: JSON_HEADERS, tags: { endpoint: 'create_agenda' } }
  );
}

/**
 * GET /api/v1/agendas
 * Lista todas as pautas cadastradas.
 */
export function listAgendas() {
  return http.get(API_V1, {
    headers: JSON_HEADERS,
    tags: { endpoint: 'list_agendas' },
  });
}

/**
 * GET /api/v1/agendas/{agendaId}
 * Retorna uma pauta específica.
 */
export function getAgenda(agendaId) {
  return http.get(`${API_V1}/${agendaId}`, {
    headers: JSON_HEADERS,
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
    { headers: JSON_HEADERS, tags: { endpoint: 'open_session' } }
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
    { headers: JSON_HEADERS, tags: { endpoint: 'cast_vote' } }
  );
}

// ─── Resultado ───────────────────────────────────────────────────────────────

/**
 * GET /api/v1/agendas/{agendaId}/result
 * Retorna resultado consolidado da votação.
 */
export function getResult(agendaId) {
  return http.get(`${API_V1}/${agendaId}/result`, {
    headers: JSON_HEADERS,
    tags: { endpoint: 'get_result' },
  });
}

// ─── Health ──────────────────────────────────────────────────────────────────

/**
 * GET /actuator/health
 * Verifica saúde da aplicação.
 */
export function healthCheck() {
  return http.get(`${BASE_URL}/actuator/health`, {
    tags: { endpoint: 'health' },
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

  const resultRes = getResult(agendaId);

  return { agendaId, agendaRes, sessionRes, voteRes, resultRes };
}
