/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TESTE DE ESTRESSE (Stress Testing)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * OBJETIVO:
 *   Aumentar a carga progressivamente muito além dos limites normais para:
 *   - Descobrir o ponto exato de falha (breaking point)
 *   - Entender como o sistema se comporta sob degradação
 *   - Verificar se o sistema se recupera após redução de carga
 *
 * CENÁRIO (escadas crescentes):
 *   Stage 1 — Baseline:  50 VUs por 2min  (carga normal)
 *   Stage 2 — Elevated: 100 VUs por 2min  (2x normal)
 *   Stage 3 — High:     150 VUs por 2min  (3x normal)
 *   Stage 4 — Stress:   200 VUs por 2min  (4x normal)
 *   Stage 5 — Peak:     300 VUs por 2min  (6x normal — breaking zone)
 *   Stage 6 — Recovery: 100 VUs por 2min  (verificar recuperação)
 *   Stage 7 — Cooldown:   0 VUs por 1min
 *   Total: ~13 minutos
 *
 * CRITÉRIOS OBSERVADOS (não impõem falha — objetivo é medir degradação):
 *   - Em qual VU count o p95 ultrapassa 1s?
 *   - Em qual VU count a taxa de erro ultrapassa 5%?
 *   - O sistema se recupera ao reduzir para 100 VUs?
 *
 * FLUXO SIMULADO:
 *   Fluxo completo: create agenda → open session → vote → get result
 *   (ciclo mais pesado, maximiza carga no banco)
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

// ─── Métricas customizadas ────────────────────────────────────────────────────
const fullFlowLatency  = new Trend('stress_full_flow_latency', true);
const breakingErrors   = new Counter('stress_breaking_errors');
const degradationRate  = new Rate('stress_degradation_rate');

// ─── Opções ──────────────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '2m', target: 50  },  // baseline
    { duration: '2m', target: 100 },  // 2x normal
    { duration: '2m', target: 150 },  // 3x normal
    { duration: '2m', target: 200 },  // 4x normal — stress
    { duration: '2m', target: 300 },  // 6x normal — breaking point
    { duration: '2m', target: 100 },  // recovery check
    { duration: '1m', target: 0   },  // cooldown
  ],
  // Thresholds amplos — objetivo é observar, não forçar falha do teste
  thresholds: {
    http_req_duration: ['p(99)<5000'],  // falha apenas acima de 5s p99
    http_req_failed:   ['rate<0.30'],   // tolera até 30% de erro (zona de quebra)
  },
  tags: { test_type: 'stress' },
};

// ─── Cenário principal ───────────────────────────────────────────────────────
export default function () {
  const startTime = Date.now();

  // Fluxo completo — o mais custoso, maximiza pressão
  const title       = uniqueAgendaTitle(__VU, __ITER);
  const associateId = uniqueAssociateId(__VU, __ITER);

  // 1. Criar pauta
  const agendaRes = createAgenda(title, 'Stress test - full flow');
  const agendaOk  = checkCreateAgenda(agendaRes);

  if (!agendaOk) {
    breakingErrors.add(1);
    degradationRate.add(1);
    return;
  }

  let agendaId;
  try { agendaId = agendaRes.json('id'); } catch (_) { breakingErrors.add(1); return; }
  if (!agendaId) { breakingErrors.add(1); return; }
  sleep(0.1);

  // 2. Abrir sessão
  const sessionRes = openSession(agendaId, 60);
  const sessionOk  = checkOpenSession(sessionRes);

  if (!sessionOk) {
    breakingErrors.add(1);
    degradationRate.add(1);
    return;
  }

  sleep(0.1);

  // 3. Votar
  const voteRes = castVote(agendaId, associateId, randomChoice());
  checkCastVote(voteRes, false);

  sleep(0.1);

  // 4. Consultar resultado
  const resultRes = getResult(agendaId);
  const resultOk  = checkGetResult(resultRes);

  // Mede latência total do fluxo
  const flowDuration = Date.now() - startTime;
  fullFlowLatency.add(flowDuration);
  degradationRate.add(!resultOk);

  // 5. Listagem (operação read adicional sob pressão)
  const listRes = listAgendas();
  degradationRate.add(listRes.status !== 200);

  sleep(0.5);
}
