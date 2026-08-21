/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TESTE DE VOLUME / CAPACIDADE (Volume / Capacity Testing)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * OBJETIVO:
 *   Inserir massa de dados para validar índices, queries e degradação de
 *   performance conforme o volume de registros cresce.
 *
 * VARIÁVEIS DE AMBIENTE:
 *   VOLUME_AGENDAS           Total de pautas a criar         (padrão: 500)
 *   VOLUME_VOTES_PER_AGENDA  Votos por pauta                 (padrão: 20)
 *   VOLUME_INSERT_VUS        VUs na fase de inserção         (padrão: 10)
 *   VOLUME_WARMUP_VUS        VUs na fase de warmup           (padrão: 5)
 *   VOLUME_QUERY_VUS         VUs na fase de query stress     (padrão: 20)
 *   VOLUME_QUERY_DURATION    Duração da fase de queries      (padrão: 5m)
 *
 * Exemplos de uso:
 *   ./run/run-test.sh volume
 *   VOLUME_AGENDAS=100 VOLUME_VOTES_PER_AGENDA=5 ./run/run-test.sh volume
 *   VOLUME_AGENDAS=1000 VOLUME_INSERT_VUS=20 ./run/run-test.sh volume
 * ══════════════════════════════════════════════════════════════════════════════
 */
import { sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import {
  createAgenda, openSession, castVote, getResult, listAgendas,
} from '../helpers/api.js';
import {
  checkCreateAgenda, checkOpenSession, checkCastVote, checkGetResult, checkListAgendas,
} from '../helpers/checks.js';
import { generateAssociateIds, randomChoice } from '../helpers/data.js';

// ─── Métricas por fase ────────────────────────────────────────────────────────
const warmupLatency   = new Trend('volume_warmup_latency',  true);
const volumeLatency   = new Trend('volume_bulk_latency',    true);
const queryLatency    = new Trend('volume_query_latency',   true);
const insertErrors    = new Counter('volume_insert_errors');
const volumeErrorRate = new Rate('volume_error_rate');

// ─── Parâmetros via env ───────────────────────────────────────────────────────
const TOTAL_AGENDAS    = parseInt(__ENV.VOLUME_AGENDAS           || '500');
const VOTES_PER_AGENDA = parseInt(__ENV.VOLUME_VOTES_PER_AGENDA  || '20');
const INSERT_VUS       = parseInt(__ENV.VOLUME_INSERT_VUS        || '10');
const WARMUP_VUS       = parseInt(__ENV.VOLUME_WARMUP_VUS        || '5');
const QUERY_VUS        = parseInt(__ENV.VOLUME_QUERY_VUS         || '20');
const QUERY_DURATION   = __ENV.VOLUME_QUERY_DURATION             || '5m';
const WARMUP_AGENDAS   = Math.max(10, Math.round(TOTAL_AGENDAS * 0.1)); // 10% como warmup

// ─── Opções ──────────────────────────────────────────────────────────────────
export const options = {
  setupTimeout: '5m',
  scenarios: {
    warmup: {
      executor:    'per-vu-iterations',
      vus:         WARMUP_VUS,
      iterations:  WARMUP_AGENDAS,
      maxDuration: '10m',
      tags:        { phase: 'warmup' },
    },
    volume_insert: {
      executor:       'per-vu-iterations',
      vus:            INSERT_VUS,
      iterations:     TOTAL_AGENDAS,
      maxDuration:    '60m',
      startAfterTest: 'warmup',
      tags:           { phase: 'volume_insert' },
    },
    query_stress: {
      executor:       'constant-vus',
      vus:            QUERY_VUS,
      duration:       QUERY_DURATION,
      startAfterTest: 'volume_insert',
      tags:           { phase: 'query_stress' },
    },
  },
  thresholds: {
    'http_req_duration{phase:warmup}':        ['p(95)<500'],
    'http_req_duration{phase:volume_insert}': ['p(95)<1000'],
    'http_req_duration{phase:query_stress}':  ['p(95)<1500'],
    http_req_failed:   ['rate<0.02'],
    volume_error_rate: ['rate<0.02'],
    volume_query_latency: ['p(95)<1500'],
  },
  tags: { test_type: 'volume' },
};

export function setup() {
  console.log(
    `[volume] agendas=${TOTAL_AGENDAS} votes=${VOTES_PER_AGENDA} ` +
    `insert_vus=${INSERT_VUS} query_vus=${QUERY_VUS} query_dur=${QUERY_DURATION}`
  );
}

// ─── Cenários por fase ────────────────────────────────────────────────────────

export function warmup() {
  insertAgendaWithVotes('warmup', __VU, __ITER, warmupLatency, 5);
  sleep(0.1);
}

export function volume_insert() {
  insertAgendaWithVotes('volume', __VU, __ITER, volumeLatency, VOTES_PER_AGENDA);
  sleep(0.05);
}

export function query_stress() {
  const listRes = listAgendas();
  queryLatency.add(listRes.timings.duration);
  const listOk = checkListAgendas(listRes);
  volumeErrorRate.add(!listOk);
  if (!listOk) return;

  const agendas = listRes.json();
  if (!agendas || agendas.length === 0) return;

  const sample = agendas.slice(0, 5);
  for (const agenda of sample) {
    const resultRes = getResult(agenda.id);
    queryLatency.add(resultRes.timings.duration);
    volumeErrorRate.add(!checkGetResult(resultRes));
    sleep(0.1);
  }

  sleep(0.5);
}

// ─── Utilitário ───────────────────────────────────────────────────────────────
function insertAgendaWithVotes(phase, vuId, iter, latencyMetric, votesCount) {
  const title     = `[k6-vol-${phase}-${vuId}-${iter}] ${Date.now()}`;
  const agendaRes = createAgenda(title, `Volume ${phase}`);
  latencyMetric.add(agendaRes.timings.duration);
  const agendaOk = checkCreateAgenda(agendaRes);
  volumeErrorRate.add(!agendaOk);
  if (!agendaOk) { insertErrors.add(1); return; }

  const agendaId = agendaRes.json('id');

  const sessionRes = openSession(agendaId, 120);
  latencyMetric.add(sessionRes.timings.duration);
  const sessionOk = checkOpenSession(sessionRes);
  volumeErrorRate.add(!sessionOk);
  if (!sessionOk) { insertErrors.add(1); return; }

  const associateIds = generateAssociateIds(votesCount, vuId * 10000 + iter);
  for (const associateId of associateIds) {
    const voteRes = castVote(agendaId, associateId, randomChoice());
    latencyMetric.add(voteRes.timings.duration);
    const voteOk = [201, 409].includes(voteRes.status);
    volumeErrorRate.add(!voteOk);
    if (!voteOk) insertErrors.add(1);
  }

  const resultRes = getResult(agendaId);
  latencyMetric.add(resultRes.timings.duration);
  checkGetResult(resultRes);
}
