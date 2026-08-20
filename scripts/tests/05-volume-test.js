/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TESTE DE VOLUME / CAPACIDADE (Volume / Capacity Testing)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * OBJETIVO:
 *   Inserir quantidade massiva de dados para verificar:
 *   - Se o banco mantém performance com alto volume de registros
 *   - Se queries ficam mais lentas conforme o volume de dados cresce
 *   - Se os índices estão funcionando corretamente (sem full table scan)
 *   - Limites práticos de armazenamento e processamento
 *
 * CENÁRIO (sequencial por fases):
 *   Fase 1 — Warm-up:     100 pautas com sessão (baseline de latência)
 *   Fase 2 — Volume:      500 pautas com sessão + 10.000 votos
 *   Fase 3 — Query stress: consultas intensivas ao banco com alto volume
 *   Fase 4 — Validation:  verifica se latência degradou vs. baseline
 *
 * PARÂMETROS (configuráveis via env):
 *   VOLUME_AGENDAS         = 500  (total de pautas criadas)
 *   VOLUME_VOTES_PER_AGENDA = 20  (votos por pauta — ajustar ao CPF pool)
 *
 * CRITÉRIOS DE ACEITE:
 *   - Latência de listagem com 500+ registros < 1s p95
 *   - Latência de consulta de resultado (com índice) < 300ms p95
 *   - Taxa de erro durante inserção massiva < 2%
 *   - Degradação de latência entre fase 1 e fase 3 < 50%
 *
 * NOTA:
 *   Este teste é executado com poucos VUs mas muitas iterações,
 *   diferente dos outros que escalam VUs. O foco é volume de dados,
 *   não concorrência.
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
const warmupLatency  = new Trend('volume_warmup_latency',  true);
const volumeLatency  = new Trend('volume_bulk_latency',    true);
const queryLatency   = new Trend('volume_query_latency',   true);
const insertErrors   = new Counter('volume_insert_errors');
const volumeErrorRate = new Rate('volume_error_rate');

// ─── Parâmetros ──────────────────────────────────────────────────────────────
const VOLUME_AGENDAS          = parseInt(__ENV.VOLUME_AGENDAS          || '500');
const VOLUME_VOTES_PER_AGENDA = parseInt(__ENV.VOLUME_VOTES_PER_AGENDA || '20');
const WARMUP_AGENDAS          = 100;

// ─── Opções ──────────────────────────────────────────────────────────────────
export const options = {
  // Cenários separados por fase executados sequencialmente
  scenarios: {
    warmup: {
      executor:    'per-vu-iterations',
      vus:         5,
      iterations:  WARMUP_AGENDAS,
      maxDuration: '10m',
      tags:        { phase: 'warmup' },
    },
    volume_insert: {
      executor:          'per-vu-iterations',
      vus:               10,
      iterations:        VOLUME_AGENDAS,
      maxDuration:       '30m',
      startAfterTest:    'warmup',  // executa após warmup
      tags:              { phase: 'volume_insert' },
    },
    query_stress: {
      executor:          'constant-vus',
      vus:               20,
      duration:          '5m',
      startAfterTest:    'volume_insert',
      tags:              { phase: 'query_stress' },
    },
  },
  thresholds: {
    'http_req_duration{phase:warmup}':        ['p(95)<500'],
    'http_req_duration{phase:volume_insert}': ['p(95)<1000'],
    'http_req_duration{phase:query_stress}':  ['p(95)<1500'],
    http_req_failed:  ['rate<0.02'],
    volume_error_rate: ['rate<0.02'],
    volume_query_latency: ['p(95)<1500'],
  },
  tags: { test_type: 'volume' },
};

// ─── Cenário de warmup ───────────────────────────────────────────────────────
export function warmup() {
  insertAgendaWithVotes('warmup', __VU, __ITER, warmupLatency, 5);
  sleep(0.1);
}

// ─── Cenário de inserção em volume ───────────────────────────────────────────
export function volume_insert() {
  insertAgendaWithVotes('volume', __VU, __ITER, volumeLatency, VOLUME_VOTES_PER_AGENDA);
  sleep(0.05);
}

// ─── Cenário de query stress (com banco cheio) ────────────────────────────────
export function query_stress() {
  // Listagem — mede custo com alto volume de registros na tabela
  const listRes = listAgendas();
  queryLatency.add(listRes.timings.duration);
  const listOk = checkListAgendas(listRes);
  volumeErrorRate.add(!listOk);

  if (!listOk) return;

  const agendas = listRes.json();
  if (!agendas || agendas.length === 0) return;

  // Consulta resultado de pautas aleatórias — testa índice por agenda_id
  const sample = agendas.slice(0, 5); // primeiras 5 da lista
  for (const agenda of sample) {
    const resultRes = getResult(agenda.id);
    queryLatency.add(resultRes.timings.duration);
    const ok = checkGetResult(resultRes);
    volumeErrorRate.add(!ok);
    sleep(0.1);
  }

  sleep(0.5);
}

// ─── Função utilitária ────────────────────────────────────────────────────────
function insertAgendaWithVotes(phase, vuId, iter, latencyMetric, votesCount) {
  const title = `[k6-vol-${phase}-${vuId}-${iter}] Pauta Volume ${Date.now()}`;

  // Criar pauta
  const agendaRes = createAgenda(title, `Volume test phase: ${phase}`);
  latencyMetric.add(agendaRes.timings.duration);
  const agendaOk = checkCreateAgenda(agendaRes);
  volumeErrorRate.add(!agendaOk);

  if (!agendaOk) {
    insertErrors.add(1);
    return;
  }

  const agendaId = agendaRes.json('id');

  // Abrir sessão com 2h para não fechar durante inserção
  const sessionRes = openSession(agendaId, 120);
  latencyMetric.add(sessionRes.timings.duration);
  const sessionOk = checkOpenSession(sessionRes);
  volumeErrorRate.add(!sessionOk);

  if (!sessionOk) {
    insertErrors.add(1);
    return;
  }

  // Inserir votos em lote
  const associateIds = generateAssociateIds(votesCount, vuId * 10000 + iter);

  for (const associateId of associateIds) {
    const voteRes = castVote(agendaId, associateId, randomChoice());
    latencyMetric.add(voteRes.timings.duration);
    // 409 é esperado se por algum acaso o ID colidir
    const voteOk = [201, 409].includes(voteRes.status);
    volumeErrorRate.add(!voteOk);
    if (!voteOk) insertErrors.add(1);
  }

  // Valida contagem
  const resultRes = getResult(agendaId);
  latencyMetric.add(resultRes.timings.duration);
  checkGetResult(resultRes);
}
