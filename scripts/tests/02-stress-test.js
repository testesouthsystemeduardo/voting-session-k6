/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TESTE DE ESTRESSE (Stress Testing)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * OBJETIVO:
 *   Aumentar a carga progressivamente para descobrir o ponto de quebra.
 *
 * VARIÁVEIS DE AMBIENTE:
 *   LOAD_VUS              VUs da baseline (1x normal)        (padrão: 50)
 *   STRESS_MAX_VUS        VUs no pico de estresse            (padrão: 300)
 *   STRESS_STAGE_DURATION Duração de cada estágio            (padrão: 2m)
 *   STRESS_RECOVERY_VUS   VUs no estágio de recuperação      (padrão: LOAD_VUS)
 *
 * Exemplos de uso:
 *   ./run/run-test.sh stress
 *   STRESS_MAX_VUS=500 STRESS_STAGE_DURATION=3m ./run/run-test.sh stress
 *   LOAD_VUS=30 STRESS_MAX_VUS=200 ./run/run-test.sh stress
 *
 * ESTÁGIOS (escadas crescentes):
 *   1x baseline → 2x → 3x → 4x → STRESS_MAX_VUS → recuperação → cooldown
 * ══════════════════════════════════════════════════════════════════════════════
 */
import { sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import {
  createAgenda, openSession, castVote, getResult, listAgendas,
} from '../helpers/api.js';
import {
  checkCreateAgenda, checkOpenSession, checkCastVote, checkGetResult,
} from '../helpers/checks.js';
import { uniqueAssociateId, uniqueAgendaTitle, randomChoice } from '../helpers/data.js';

// ─── Métricas ─────────────────────────────────────────────────────────────────
const fullFlowLatency = new Trend('stress_full_flow_latency', true);
const breakingErrors  = new Counter('stress_breaking_errors');
const degradationRate = new Rate('stress_degradation_rate');

// ─── Parâmetros via env ───────────────────────────────────────────────────────
const BASE_VUS     = parseInt(__ENV.LOAD_VUS              || '50');
const MAX_VUS      = parseInt(__ENV.STRESS_MAX_VUS        || '300');
const STAGE_DUR    = __ENV.STRESS_STAGE_DURATION          || '2m';
const RECOVERY_VUS = parseInt(__ENV.STRESS_RECOVERY_VUS   || String(BASE_VUS));

// ─── Opções ──────────────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: STAGE_DUR, target: BASE_VUS                      }, // baseline (1x)
    { duration: STAGE_DUR, target: Math.round(BASE_VUS * 2)      }, // 2x
    { duration: STAGE_DUR, target: Math.round(BASE_VUS * 3)      }, // 3x
    { duration: STAGE_DUR, target: Math.round(BASE_VUS * 4)      }, // 4x
    { duration: STAGE_DUR, target: MAX_VUS                       }, // pico
    { duration: STAGE_DUR, target: RECOVERY_VUS                  }, // recuperação
    { duration: '1m',      target: 0                             }, // cooldown
  ],
  thresholds: {
    http_req_duration: ['p(99)<5000'],
    http_req_failed:   ['rate<0.30'],
  },
  tags: { test_type: 'stress' },
};

export function setup() {
  console.log(`[stress] base=${BASE_VUS} max=${MAX_VUS} stage=${STAGE_DUR} recovery=${RECOVERY_VUS}`);
}

export default function () {
  const startTime   = Date.now();
  const title       = uniqueAgendaTitle(__VU, __ITER);
  const associateId = uniqueAssociateId(__VU, __ITER);

  const agendaRes = createAgenda(title, 'Stress test - full flow');
  const agendaOk  = checkCreateAgenda(agendaRes);
  if (!agendaOk) { breakingErrors.add(1); degradationRate.add(1); return; }

  let agendaId;
  try { agendaId = agendaRes.json('id'); } catch (_) { breakingErrors.add(1); return; }
  if (!agendaId) { breakingErrors.add(1); return; }
  sleep(0.1);

  const sessionRes = openSession(agendaId, 60);
  const sessionOk  = checkOpenSession(sessionRes);
  if (!sessionOk) { breakingErrors.add(1); degradationRate.add(1); return; }
  sleep(0.1);

  const voteRes = castVote(agendaId, associateId, randomChoice());
  checkCastVote(voteRes, false);
  sleep(0.1);

  const resultRes = getResult(agendaId);
  const resultOk  = checkGetResult(resultRes);

  fullFlowLatency.add(Date.now() - startTime);
  degradationRate.add(!resultOk);

  const listRes = listAgendas();
  degradationRate.add(listRes.status !== 200);

  sleep(0.5);
}
