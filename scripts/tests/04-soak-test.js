/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TESTE DE RESISTÊNCIA / IMERSÃO (Endurance / Soak Testing)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * OBJETIVO:
 *   Manter carga constante por longo período para detectar memory leaks,
 *   esgotamento de connection pool e degradação gradual de latência.
 *
 * VARIÁVEIS DE AMBIENTE:
 *   LOAD_VUS          VUs constantes durante o soak        (padrão: 30)
 *   SOAK_DURATION     Duração da fase de imersão           (padrão: 30m)
 *   SOAK_RAMPUP       Duração do ramp-up inicial           (padrão: 2m)
 *   SOAK_RAMPDOWN     Duração do ramp-down final           (padrão: 1m)
 *
 * Exemplos de uso:
 *   ./run/run-test.sh soak
 *   SOAK_DURATION=2h LOAD_VUS=20 ./run/run-test.sh soak
 *   SOAK_DURATION=10m LOAD_VUS=10 ./run/run-test.sh soak   # rápido para dev
 *
 * OBSERVAÇÃO:
 *   Monitorar /actuator/metrics durante o teste:
 *     jvm.memory.used, hikaricp.connections.active, jvm.gc.pause
 * ══════════════════════════════════════════════════════════════════════════════
 */
import { sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import {
  listAgendas, getResult, castVote, createAgenda, openSession, healthCheck,
} from '../helpers/api.js';
import {
  checkListAgendas, checkGetResult, checkCastVote, checkHealth,
  checkCreateAgenda, checkOpenSession,
} from '../helpers/checks.js';
import { uniqueAssociateId, uniqueAgendaTitle, randomChoice } from '../helpers/data.js';
import { seedAgendasWithOpenSessions } from '../setup/seed.js';

// ─── Métricas para detectar degradação temporal ───────────────────────────────
const soakLatencyTrend = new Trend('soak_latency_ms',               true);
const soakErrorRate    = new Rate('soak_error_rate');
const memoryWarnings   = new Counter('soak_potential_leak_warnings');

// ─── Parâmetros via env ───────────────────────────────────────────────────────
const VUS          = parseInt(__ENV.LOAD_VUS       || '30');
const SOAK_DUR     = __ENV.SOAK_DURATION           || '30m';
const RAMPUP_DUR   = __ENV.SOAK_RAMPUP             || '2m';
const RAMPDOWN_DUR = __ENV.SOAK_RAMPDOWN           || '1m';

// Duração da sessão de seed = soak + margem (para não fechar durante o teste)
// Converte SOAK_DUR para minutos somando 60 de margem
function soakSessionDuration() {
  const d = SOAK_DUR;
  if (d.endsWith('h')) return parseInt(d) * 60 + 60;
  if (d.endsWith('m')) return parseInt(d) + 60;
  return 480; // fallback 8h
}

// ─── Opções ──────────────────────────────────────────────────────────────────
export const options = {
  setupTimeout: '5m',
  stages: [
    { duration: RAMPUP_DUR,   target: VUS }, // ramp-up suave
    { duration: SOAK_DUR,     target: VUS }, // soak
    { duration: RAMPDOWN_DUR, target: 0   }, // ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed:   ['rate<0.005'],
    soak_error_rate:   ['rate<0.005'],
    soak_latency_ms:   ['p(95)<1000'],
  },
  tags: { test_type: 'soak' },
};

let iterationCount = 0;

export function setup() {
  console.log(`[soak] VUS=${VUS} | duration=${SOAK_DUR} | rampup=${RAMPUP_DUR} | rampdown=${RAMPDOWN_DUR}`);
  return { agendaIds: seedAgendasWithOpenSessions(20, soakSessionDuration()) };
}

export default function (data) {
  const { agendaIds } = data;
  iterationCount++;

  if (iterationCount % 500 === 0) {
    console.log(`[soak] Iteração ${iterationCount} — VU ${__VU}`);
  }

  const roll = Math.random();
  if (roll < 0.5) {
    soakReadScenario(agendaIds);
  } else if (roll < 0.8) {
    soakWriteScenario();
  } else {
    soakHealthScenario();
  }

  sleep(1.5 + Math.random());
}

function soakReadScenario(agendaIds) {
  const listRes = listAgendas();
  soakLatencyTrend.add(listRes.timings.duration);
  const ok = checkListAgendas(listRes);
  soakErrorRate.add(!ok);

  if (listRes.timings.duration > 2000) {
    memoryWarnings.add(1);
    console.warn(`[soak] Latência alta: ${listRes.timings.duration}ms no VU ${__VU}`);
  }

  if (agendaIds.length > 0) {
    sleep(0.5);
    const agendaId  = agendaIds[Math.floor(Math.random() * agendaIds.length)];
    const resultRes = getResult(agendaId);
    soakLatencyTrend.add(resultRes.timings.duration);
    soakErrorRate.add(!checkGetResult(resultRes));
  }
}

function soakWriteScenario() {
  const title     = uniqueAgendaTitle(__VU, __ITER);
  const agendaRes = createAgenda(title, 'Soak test write');
  soakLatencyTrend.add(agendaRes.timings.duration);
  const agendaOk  = checkCreateAgenda(agendaRes);
  soakErrorRate.add(!agendaOk);
  if (!agendaOk) return;

  let agendaId;
  try { agendaId = agendaRes.json('id'); } catch (_) { soakErrorRate.add(1); return; }
  if (!agendaId) { soakErrorRate.add(1); return; }
  sleep(0.3);

  const sessionRes = openSession(agendaId, 60);
  soakLatencyTrend.add(sessionRes.timings.duration);
  const sessionOk  = checkOpenSession(sessionRes);
  soakErrorRate.add(!sessionOk);
  if (!sessionOk) return;
  sleep(0.2);

  const associateId = uniqueAssociateId(__VU, __ITER);
  const voteRes     = castVote(agendaId, associateId, randomChoice());
  soakLatencyTrend.add(voteRes.timings.duration);
  soakErrorRate.add(![201, 409].includes(voteRes.status));
}

function soakHealthScenario() {
  const healthRes = healthCheck();
  soakLatencyTrend.add(healthRes.timings.duration);
  const ok = checkHealth(healthRes);
  soakErrorRate.add(!ok);

  if (!ok) {
    console.error(`[soak] HEALTH CHECK FAILED no VU ${__VU}`);
    memoryWarnings.add(5);
  }
}

export function teardown(data) {
  console.log(`[soak] Concluído após ${SOAK_DUR}. Total iterações: ${iterationCount}`);
}
