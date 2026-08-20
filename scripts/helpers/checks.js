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
 * Valida resposta de criação de pauta.
 * Aceita 201 como sucesso.
 */
export function checkCreateAgenda(res) {
  const ok = check(res, {
    'create agenda: status 201': (r) => r.status === 201,
    'create agenda: has id':     (r) => r.json('id') !== undefined,
    'create agenda: has title':  (r) => r.json('title') !== undefined,
  });
  if (!ok) errors.createAgenda.add(1);
  return ok;
}

/**
 * Valida resposta de abertura de sessão.
 * Aceita 201 (novo) ou 409 (já existe — tolerável em retry loops).
 */
export function checkOpenSession(res, tolerateConflict = false) {
  const validStatuses = tolerateConflict
    ? [201, 409]
    : [201];

  const ok = check(res, {
    'open session: valid status': (r) => validStatuses.includes(r.status),
    'open session: has id':       (r) => r.status === 201 ? r.json('id') !== undefined : true,
  });
  if (!ok) errors.openSession.add(1);
  return ok;
}

/**
 * Valida resposta de voto.
 * Aceita 201 (ok) ou 409 (associado já votou — esperado em stress/volume).
 */
export function checkCastVote(res, tolerateDuplicate = false) {
  const validStatuses = tolerateDuplicate
    ? [201, 409, 422]
    : [201];

  const ok = check(res, {
    'cast vote: valid status': (r) => validStatuses.includes(r.status),
  });
  if (!ok) errors.castVote.add(1);
  return ok;
}

/**
 * Valida resposta de resultado de votação.
 */
export function checkGetResult(res) {
  const ok = check(res, {
    'get result: status 200':    (r) => r.status === 200,
    'get result: has totalVotes': (r) => r.json('totalVotes') !== undefined,
    'get result: has winner':    (r) => r.json('winner') !== undefined,
  });
  if (!ok) errors.getResult.add(1);
  return ok;
}

/**
 * Valida resposta de listagem de pautas.
 */
export function checkListAgendas(res) {
  const ok = check(res, {
    'list agendas: status 200': (r) => r.status === 200,
    'list agendas: is array':   (r) => Array.isArray(r.json()),
  });
  if (!ok) errors.listAgendas.add(1);
  return ok;
}

/**
 * Valida health check da aplicação.
 */
export function checkHealth(res) {
  const ok = check(res, {
    'health: status 200': (r) => r.status === 200,
    'health: is UP':      (r) => r.json('status') === 'UP',
  });
  if (!ok) errors.healthCheck.add(1);
  return ok;
}
