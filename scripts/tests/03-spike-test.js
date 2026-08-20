/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TESTE DE PICO (Spike Testing)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * OBJETIVO:
 *   Enviar choque repentino e massivo de usuários para testar absorção e
 *   tempo de recuperação do sistema.
 *
 * VARIÁVEIS DE AMBIENTE:
 *   SPIKE_BASE_VUS          VUs em tráfego normal          (padrão: 10)
 *   SPIKE_PEAK_VUS          VUs no pico instantâneo        (padrão: 500)
 *   SPIKE_WARMUP_DURATION   Duração do aquecimento pré-pico (padrão: 1m)
 *   SPIKE_PEAK_DURATION     Duração do pico                (padrão: 2m)
 *   SPIKE_RECOVERY_DURATION Duração da fase de recuperação  (padrão: 3m)
 *
 * Exemplos de uso:
 *   ./run/run-test.sh spike
 *   SPIKE_PEAK_VUS=200 SPIKE_PEAK_DURATION=1m ./run/run-test.sh spike
 *   SPIKE_BASE_VUS=5 SPIKE_PEAK_VUS=1000 ./run/run-test.sh spike
 * ══════════════════════════════════════════════════════════════════════════════
 */
import { sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import {
  listAgendas, getResult, createAgenda, openSession, castVote,
} from '../helpers/api.js';
import {
  checkListAgendas, checkGetResult, checkCreateAgenda,
  checkOpenSession, checkCastVote,
} from '../helpers/checks.js';
import { uniqueAssociateId, uniqueAgendaTitle, randomChoice } from '../helpers/data.js';
import { seedAgendasWithOpenSessions } from '../setup/seed.js';

// ─── Métricas ─────────────────────────────────────────────────────────────────
const spikeErrorRate  = new Rate('spike_error_rate');
const recoveryLatency = new Trend('spike_recovery_latency', true);

// ─── Parâmetros via env ───────────────────────────────────────────────────────
const BASE_VUS     = parseInt(__ENV.SPIKE_BASE_VUS          || '10');
const PEAK_VUS     = parseInt(__ENV.SPIKE_PEAK_VUS          || '500');
const WARMUP_DUR   = __ENV.SPIKE_WARMUP_DURATION            || '1m';
const PEAK_DUR     = __ENV.SPIKE_PEAK_DURATION              || '2m';
const RECOVERY_DUR = __ENV.SPIKE_RECOVERY_DURATION          || '3m';

// ─── Opções ──────────────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: WARMUP_DUR,   target: BASE_VUS  }, // aquecimento
    { duration: '10s',        target: PEAK_VUS  }, // spike instantâneo ↑
    { duration: PEAK_DUR,     target: PEAK_VUS  }, // mantém pico
    { duration: '10s',        target: BASE_VUS  }, // queda instantânea ↓
    { duration: RECOVERY_DUR, target: BASE_VUS  }, // recuperação
    { duration: '30s',        target: 0         }, // cooldown
  ],
  thresholds: {
    http_req_failed:   ['rate<0.15'],
    http_req_duration: ['p(99)<3000'],
    spike_error_rate:  ['rate<0.15'],
  },
  tags: { test_type: 'spike' },
};

export function setup() {
  console.log(`[spike] base=${BASE_VUS} peak=${PEAK_VUS} warmup=${WARMUP_DUR} peak_dur=${PEAK_DUR} recovery=${RECOVERY_DUR}`);
  return { agendaIds: seedAgendasWithOpenSessions(30, 180) };
}

export default function (data) {
  const { agendaIds } = data;
  const roll = Math.random();

  if (roll < 0.70) {
    readHeavyScenario(agendaIds);
  } else {
    writeScenario();
  }

  sleep(0.2 + Math.random() * 0.5);
}

function readHeavyScenario(agendaIds) {
  const listRes = listAgendas();
  recoveryLatency.add(listRes.timings.duration);
  const listOk  = checkListAgendas(listRes);
  spikeErrorRate.add(!listOk);

  if (agendaIds.length === 0) return;

  const agendaId  = agendaIds[Math.floor(Math.random() * agendaIds.length)];
  const resultRes = getResult(agendaId);
  recoveryLatency.add(resultRes.timings.duration);
  spikeErrorRate.add(!checkGetResult(resultRes));
}

function writeScenario() {
  const title     = uniqueAgendaTitle(__VU, __ITER);
  const agendaRes = createAgenda(title, 'Spike test write');
  const agendaOk  = checkCreateAgenda(agendaRes);
  spikeErrorRate.add(!agendaOk);
  if (!agendaOk) return;

  let agendaId;
  try { agendaId = agendaRes.json('id'); } catch (_) { return; }
  if (!agendaId) return;

  const sessionRes = openSession(agendaId, 60);
  const sessionOk  = checkOpenSession(sessionRes);
  spikeErrorRate.add(!sessionOk);
  if (!sessionOk) return;

  const associateId = uniqueAssociateId(__VU, __ITER);
  const voteRes     = castVote(agendaId, associateId, randomChoice());
  checkCastVote(voteRes, true);
  spikeErrorRate.add(![201, 409, 422].includes(voteRes.status));
}

export function teardown(data) {
  console.log(`[spike] Concluído. Pautas seed: ${data.agendaIds.length}`);
}
