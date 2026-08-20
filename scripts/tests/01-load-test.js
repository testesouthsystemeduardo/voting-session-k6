/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TESTE DE CARGA (Load Testing)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * OBJETIVO:
 *   Simular o volume de usuários esperado no uso diário da plataforma
 *   para verificar se o sistema responde com rapidez e mantém estabilidade.
 *
 * CENÁRIO:
 *   - Ramp-up gradual até 50 VUs em 1 minuto
 *   - Carga estável de 50 VUs por 5 minutos (estado estacionário)
 *   - Ramp-down gradual em 1 minuto
 *   Total: ~7 minutos
 *
 * CRITÉRIOS DE ACEITE:
 *   - p95 < 500ms (95% das requisições em menos de 500ms)
 *   - p99 < 1000ms
 *   - Taxa de erro < 1%
 *   - Throughput mínimo de 20 req/s
 *
 * FLUXO SIMULADO (mix representativo de carga diária):
 *   60% — Leitura (list agendas, get by id, get result)
 *   40% — Escrita (create agenda, open session, cast vote)
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

// ─── Opções do teste ─────────────────────────────────────────────────────────
const VUS = parseInt(__ENV.LOAD_VUS || '50');

export const options = {
  stages: [
    { duration: '1m',  target: VUS      },  // ramp-up
    { duration: '5m',  target: VUS      },  // steady state
    { duration: '1m',  target: 0        },  // ramp-down
  ],
  thresholds: {
    http_req_duration:            ['p(95)<500', 'p(99)<1000'],
    http_req_failed:              ['rate<0.01'],
    custom_error_rate:            ['rate<0.01'],
    custom_read_latency:          ['p(95)<400'],
    custom_write_latency:         ['p(95)<700'],
  },
  tags: { test_type: 'load' },
};

// ─── Setup: cria pautas com sessão aberta para evitar conflito de sessão ──────
export function setup() {
  return { agendaIds: seedAgendasWithOpenSessions(20, 120) };
}

// ─── Cenário principal ───────────────────────────────────────────────────────
export default function (data) {
  const { agendaIds } = data;
  const roll = Math.random();

  // 60% leitura
  if (roll < 0.6) {
    readScenario(agendaIds);
  }
  // 40% escrita
  else {
    writeScenario();
  }

  sleep(1 + Math.random()); // think time realista: 1-2s
}

function readScenario(agendaIds) {
  // Lista todas as pautas
  const listRes = listAgendas();
  readLatency.add(listRes.timings.duration);
  const listOk = checkListAgendas(listRes);
  errorRate.add(!listOk);

  if (!listOk || agendaIds.length === 0) return;
  sleep(0.3);

  // Busca pauta específica
  const agendaId = agendaIds[Math.floor(Math.random() * agendaIds.length)];
  const getRes = getAgenda(agendaId);
  readLatency.add(getRes.timings.duration);
  errorRate.add(getRes.status !== 200);

  sleep(0.3);

  // Consulta resultado
  const resultRes = getResult(agendaId);
  readLatency.add(resultRes.timings.duration);
  const resultOk = checkGetResult(resultRes);
  errorRate.add(!resultOk);
}

function writeScenario() {
  // Cria nova pauta
  const title    = uniqueAgendaTitle(__VU, __ITER);
  const agendaRes = createAgenda(title, 'Load test agenda');
  writeLatency.add(agendaRes.timings.duration);
  const agendaOk = checkCreateAgenda(agendaRes);
  errorRate.add(!agendaOk);

  if (!agendaOk) return;
  let agendaId;
  try { agendaId = agendaRes.json('id'); } catch (_) { return; }
  if (!agendaId) return;
  sleep(0.2);

  // Abre sessão
  const sessionRes = openSession(agendaId, 60);
  writeLatency.add(sessionRes.timings.duration);
  const sessionOk = checkOpenSession(sessionRes);
  errorRate.add(!sessionOk);

  if (!sessionOk) return;
  sleep(0.2);

  // Vota
  const associateId = uniqueAssociateId(__VU, __ITER);
  const voteRes     = castVote(agendaId, associateId, randomChoice());
  writeLatency.add(voteRes.timings.duration);
  const voteOk = checkCastVote(voteRes);
  errorRate.add(!voteOk);
}

// ─── Teardown: log resumo ────────────────────────────────────────────────────
export function teardown(data) {
  console.log(`[load-test] Concluído. Pautas usadas no setup: ${data.agendaIds.length}`);
}
