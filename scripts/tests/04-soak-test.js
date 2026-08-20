/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TESTE DE RESISTÊNCIA / IMERSÃO (Endurance / Soak Testing)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * OBJETIVO:
 *   Manter carga constante e moderada por longo período para detectar:
 *   - Vazamentos de memória (memory leaks) — JVM heap cresce continuamente?
 *   - Connection pool exhaustion — pool de DB esgota ao longo do tempo?
 *   - Degradação gradual de latência — p95 piora com o tempo?
 *   - Acúmulo de threads ou recursos não liberados
 *
 * CENÁRIO:
 *   - Ramp-up: 30 VUs em 2 minutos
 *   - Soak:    30 VUs por SOAK_DURATION (padrão: 30m — aumentar para prod: 2h+)
 *   - Ramp-down: 0 VUs em 1 minuto
 *   Total padrão: ~33 minutos
 *
 * CRITÉRIOS DE ACEITE:
 *   - p95 não deve aumentar mais de 20% do início para o fim
 *   - Taxa de erro < 0.5% em todo o período
 *   - Sem falhas catastróficas (p99 < 2s em todo período)
 *
 * OBSERVAÇÕES:
 *   - Para produção, configurar SOAK_DURATION=2h ou 4h
 *   - Monitorar métricas JVM via /actuator/metrics durante o teste:
 *       jvm.memory.used, jvm.gc.pause, hikaricp.connections.active
 *   - Usar Grafana + InfluxDB para visualizar evolução temporal
 *
 * FLUXO SIMULADO:
 *   Ciclo completo repetido com pequena pausa (simula uso sustentado real)
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
const soakLatencyTrend = new Trend('soak_latency_ms', true);
const soakErrorRate    = new Rate('soak_error_rate');
const memoryWarnings   = new Counter('soak_potential_leak_warnings');

// ─── Opções ──────────────────────────────────────────────────────────────────
const SOAK_DURATION = __ENV.SOAK_DURATION || '30m';
const SOAK_VUS      = parseInt(__ENV.LOAD_VUS || '30');

export const options = {
  stages: [
    { duration: '2m',          target: SOAK_VUS }, // ramp-up suave
    { duration: SOAK_DURATION, target: SOAK_VUS }, // soak
    { duration: '1m',          target: 0         }, // ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed:   ['rate<0.005'],
    soak_error_rate:   ['rate<0.005'],
    // Latência do soak não deve exceder 1s no p95 em nenhum momento
    soak_latency_ms:   ['p(95)<1000'],
  },
  tags: { test_type: 'soak' },
};

// ─── Variável de controle para detectar degradação ───────────────────────────
let iterationCount = 0;

// ─── Setup ───────────────────────────────────────────────────────────────────
export function setup() {
  console.log(`[soak-test] Iniciando soak com ${SOAK_VUS} VUs por ${SOAK_DURATION}`);
  const agendaIds = seedAgendasWithOpenSessions(20, 480); // 8h de sessão para soak longo
  return { agendaIds };
}

// ─── Cenário principal ───────────────────────────────────────────────────────
export default function (data) {
  const { agendaIds } = data;
  iterationCount++;

  // A cada 500 iterações, loga aviso para auxiliar análise pós-teste
  if (iterationCount % 500 === 0) {
    console.log(`[soak] Iteração ${iterationCount} — VU ${__VU}`);
  }

  const roll = Math.random();

  if (roll < 0.5) {
    // Leitura — 50%
    soakReadScenario(agendaIds);
  } else if (roll < 0.8) {
    // Fluxo de votação — 30%
    soakWriteScenario();
  } else {
    // Health check — 20% (detecta se app ainda está saudável)
    soakHealthScenario();
  }

  // Think time consistente — simula uso sustentado, não explosivo
  sleep(1.5 + Math.random());
}

function soakReadScenario(agendaIds) {
  const listRes = listAgendas();
  soakLatencyTrend.add(listRes.timings.duration);
  const ok = checkListAgendas(listRes);
  soakErrorRate.add(!ok);

  // Detecta latência anormalmente alta — pode indicar leak de memória
  if (listRes.timings.duration > 2000) {
    memoryWarnings.add(1);
    console.warn(`[soak] Latência alta detectada: ${listRes.timings.duration}ms no VU ${__VU}`);
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
  const title = uniqueAgendaTitle(__VU, __ITER);

  const agendaRes = createAgenda(title, 'Soak test - sustained write');
  soakLatencyTrend.add(agendaRes.timings.duration);
  const agendaOk = checkCreateAgenda(agendaRes);
  soakErrorRate.add(!agendaOk);

  if (!agendaOk) return;
  const agendaId = agendaRes.json('id');
  sleep(0.3);

  const sessionRes = openSession(agendaId, 60);
  soakLatencyTrend.add(sessionRes.timings.duration);
  const sessionOk = checkOpenSession(sessionRes);
  soakErrorRate.add(!sessionOk);

  if (!sessionOk) return;
  sleep(0.2);

  const associateId = uniqueAssociateId(__VU, __ITER);
  const voteRes     = castVote(agendaId, associateId, randomChoice());
  soakLatencyTrend.add(voteRes.timings.duration);
  checkCastVote(voteRes);
  soakErrorRate.add(![201, 409].includes(voteRes.status));
}

function soakHealthScenario() {
  const healthRes = healthCheck();
  soakLatencyTrend.add(healthRes.timings.duration);
  const ok = checkHealth(healthRes);
  soakErrorRate.add(!ok);

  if (!ok) {
    console.error(`[soak] HEALTH CHECK FAILED no VU ${__VU}, iteração ${__ITER}`);
    memoryWarnings.add(5); // peso maior: health falhou
  }
}

export function teardown(data) {
  console.log(`[soak-test] Concluído após ${SOAK_DURATION}. Total iterações: ${iterationCount}`);
  console.log(`[soak-test] Warnings de possível leak: verificar métrica soak_potential_leak_warnings`);
}
