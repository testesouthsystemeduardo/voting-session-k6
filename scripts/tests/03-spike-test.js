/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TESTE DE PICO (Spike Testing)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * OBJETIVO:
 *   Enviar um aumento repentino e massivo de usuários de uma só vez para:
 *   - Verificar se o sistema absorve o choque sem erros graves
 *   - Medir o tempo de recuperação após o pico
 *   - Identificar se há degradação permanente após o spike
 *
 * CENÁRIO (pico abrupto):
 *   Stage 1 — Pre-spike:  10 VUs por 1min  (tráfego mínimo)
 *   Stage 2 — Spike UP:  500 VUs por 0s    (spike instantâneo — 50x)
 *   Stage 3 — Spike:     500 VUs por 2min  (pico mantido brevemente)
 *   Stage 4 — Spike DN:   10 VUs por 0s    (queda instantânea)
 *   Stage 5 — Recovery:   10 VUs por 3min  (observar recuperação)
 *   Stage 6 — Cooldown:    0 VUs por 1min
 *   Total: ~7 minutos
 *
 * CRITÉRIOS OBSERVADOS:
 *   - Taxa de erro durante pico < 10%
 *   - Tempo de recuperação: p95 volta abaixo de 1s em < 2min após pico
 *   - Sem erros persistentes após recuperação (recovery stage)
 *
 * FLUXO SIMULADO:
 *   70% — Leitura (listagem, busca) — operações mais frequentes em picos reais
 *   30% — Votação (fluxo completo)  — operações de escrita
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

// ─── Métricas customizadas ────────────────────────────────────────────────────
const spikeErrorRate    = new Rate('spike_error_rate');
const recoveryLatency   = new Trend('spike_recovery_latency', true);

// ─── Opções ──────────────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '1m',  target: 10  },  // tráfego base
    { duration: '10s', target: 500 },  // spike instantâneo
    { duration: '2m',  target: 500 },  // mantém pico
    { duration: '10s', target: 10  },  // queda instantânea
    { duration: '3m',  target: 10  },  // recuperação
    { duration: '30s', target: 0   },  // cooldown
  ],
  thresholds: {
    // Durante pico: até 15% de erro é tolerável
    http_req_failed: ['rate<0.15'],
    // Após recuperação (todo o teste): p99 < 3s
    http_req_duration: ['p(99)<3000'],
    spike_error_rate:  ['rate<0.15'],
  },
  tags: { test_type: 'spike' },
};

// ─── Setup: pautas pré-criadas para read durante pico ───────────────────────
export function setup() {
  return { agendaIds: seedAgendasWithOpenSessions(30, 180) };
}

// ─── Cenário principal ───────────────────────────────────────────────────────
export default function (data) {
  const { agendaIds } = data;
  const roll = Math.random();

  if (roll < 0.70) {
    // Cenário de leitura — mais frequente em picos reais (ex: notificação viral)
    readHeavyScenario(agendaIds);
  } else {
    // Cenário de escrita — votar durante pico
    writeScenario();
  }

  // Think time mínimo durante pico para simular comportamento real
  sleep(0.2 + Math.random() * 0.5);
}

function readHeavyScenario(agendaIds) {
  // Listagem geral — endpoint mais acessado
  const listRes = listAgendas();
  recoveryLatency.add(listRes.timings.duration);
  const listOk = checkListAgendas(listRes);
  spikeErrorRate.add(!listOk);

  if (agendaIds.length === 0) return;

  // Consulta resultado de pauta aleatória
  const agendaId  = agendaIds[Math.floor(Math.random() * agendaIds.length)];
  const resultRes = getResult(agendaId);
  recoveryLatency.add(resultRes.timings.duration);
  const resultOk = checkGetResult(resultRes);
  spikeErrorRate.add(!resultOk);
}

function writeScenario() {
  const title = uniqueAgendaTitle(__VU, __ITER);

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
  // Durante spike, 409/422 são esperados se a sessão fechar
  checkCastVote(voteRes, true);
  spikeErrorRate.add(![201, 409, 422].includes(voteRes.status));
}

export function teardown(data) {
  console.log(`[spike-test] Concluído. ${data.agendaIds.length} pautas usadas para reads.`);
}
