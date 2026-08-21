/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TESTE DE CARGA (Load Testing)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * OBJETIVO:
 *   Simular o volume de usuários esperado no uso diário da plataforma.
 *
 * VARIÁVEIS DE AMBIENTE:
 *   LOAD_VUS            VUs no estado estacionário          (padrão: 50)
 *   LOAD_RAMPUP         Duração do ramp-up                  (padrão: 1m)
 *   LOAD_STEADY         Duração da carga estável            (padrão: 5m)
 *   LOAD_RAMPDOWN       Duração do ramp-down                (padrão: 1m)
 *
 * Exemplos de uso:
 *   ./run/run-test.sh load
 *   LOAD_VUS=100 LOAD_STEADY=10m ./run/run-test.sh load
 *   LOAD_VUS=20 LOAD_RAMPUP=30s LOAD_STEADY=2m ./run/run-test.sh load
 *
 * CRITÉRIOS DE ACEITE:
 *   p95 < 500ms | p99 < 1000ms | taxa de erro < 1%
 * ══════════════════════════════════════════════════════════════════════════════
 */
import { sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import {
  createAgenda, listAgendas, getAgenda, openSession, castVote, getResult,
} from '../helpers/api.js';
import {
  checkCreateAgenda, checkOpenSession, checkCastVote,
  checkGetResult, checkListAgendas,
} from '../helpers/checks.js';
import { uniqueAssociateId, uniqueAgendaTitle, randomChoice } from '../helpers/data.js';
import { seedAgendasWithOpenSessions } from '../setup/seed.js';

// ─── Métricas customizadas ────────────────────────────────────────────────────
const readLatency  = new Trend('custom_read_latency',  true);
const writeLatency = new Trend('custom_write_latency', true);
const errorRate    = new Rate('custom_error_rate');

// ─── Parâmetros via env ───────────────────────────────────────────────────────
const VUS      = parseInt(__ENV.LOAD_VUS      || '50');
const RAMPUP   = __ENV.LOAD_RAMPUP            || '1m';
const STEADY   = __ENV.LOAD_STEADY            || '5m';
const RAMPDOWN = __ENV.LOAD_RAMPDOWN          || '1m';

// ─── Opções do teste ─────────────────────────────────────────────────────────
export const options = {
  setupTimeout: '5m', // seed aguarda Kafka + app warm-up (app leva ~20s para iniciar)
  stages: [
    { duration: RAMPUP,   target: VUS }, // ramp-up
    { duration: STEADY,   target: VUS }, // steady state
    { duration: RAMPDOWN, target: 0   }, // ramp-down
  ],
  thresholds: {
    http_req_duration:   ['p(95)<500', 'p(99)<1000'],
    http_req_failed:     ['rate<0.01'],
    custom_error_rate:   ['rate<0.01'],
    custom_read_latency: ['p(95)<400'],
    custom_write_latency:['p(95)<700'],
  },
  tags: { test_type: 'load' },
};

export function setup() {
  console.log(`[load] VUS=${VUS} | rampup=${RAMPUP} | steady=${STEADY} | rampdown=${RAMPDOWN}`);
  return { agendaIds: seedAgendasWithOpenSessions(20, 120) };
}

export default function (data) {
  const { agendaIds } = data;
  const roll = Math.random();

  if (roll < 0.6) {
    readScenario(agendaIds);
  } else {
    writeScenario();
  }

  sleep(1 + Math.random());
}

function readScenario(agendaIds) {
  const listRes = listAgendas();
  readLatency.add(listRes.timings.duration);
  const listOk = checkListAgendas(listRes);
  errorRate.add(!listOk);

  if (!listOk || agendaIds.length === 0) return;
  sleep(0.3);

  const agendaId = agendaIds[Math.floor(Math.random() * agendaIds.length)];
  const getRes   = getAgenda(agendaId);
  readLatency.add(getRes.timings.duration);
  errorRate.add(getRes.status !== 200);

  sleep(0.3);

  const resultRes = getResult(agendaId);
  readLatency.add(resultRes.timings.duration);
  const resultOk = checkGetResult(resultRes);
  errorRate.add(!resultOk);
}

function writeScenario() {
  const title     = uniqueAgendaTitle(__VU, __ITER);
  const agendaRes = createAgenda(title, 'Load test agenda');
  writeLatency.add(agendaRes.timings.duration);
  const agendaOk  = checkCreateAgenda(agendaRes);
  errorRate.add(!agendaOk);

  if (!agendaOk) return;
  let agendaId;
  try { agendaId = agendaRes.json('id'); } catch (_) { return; }
  if (!agendaId) return;
  sleep(0.2);

  const sessionRes = openSession(agendaId, 60);
  writeLatency.add(sessionRes.timings.duration);
  const sessionOk  = checkOpenSession(sessionRes);
  errorRate.add(!sessionOk);

  if (!sessionOk) return;
  sleep(0.2);

  const associateId = uniqueAssociateId(__VU, __ITER);
  const voteRes     = castVote(agendaId, associateId, randomChoice());
  writeLatency.add(voteRes.timings.duration);
  const voteOk = checkCastVote(voteRes);
  errorRate.add(!voteOk);
}

export function teardown(data) {
  console.log(`[load] Concluído. Pautas seed: ${data.agendaIds.length}`);
}
