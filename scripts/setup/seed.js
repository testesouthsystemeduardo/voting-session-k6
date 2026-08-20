/**
 * seed.js — Setup compartilhado: cria pautas com sessão aberta
 * para testes que precisam de dados pré-existentes.
 *
 * Usado como função setup() no k6. Retorna dados para os VUs.
 */
import { createAgenda, openSession, healthCheckSeed } from '../helpers/api.js';
import { check, sleep, fail } from 'k6';

const SEED_AGENDAS = parseInt(__ENV.SEED_AGENDAS || '10');
const BASE_URL     = __ENV.BASE_URL || 'http://localhost:8081';

/**
 * Verifica se a API está acessível antes de iniciar o seed.
 * Tenta até MAX_RETRIES vezes com intervalo de RETRY_INTERVAL_S segundos.
 * Falha cedo com mensagem clara em vez de logar dezenas de erros nos VUs.
 */
function assertApiReachable() {
  const MAX_RETRIES      = 8;   // 8 × (30s timeout + 3s wait) = até 264s de espera
  const RETRY_INTERVAL_S = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Usa healthCheckSeed (timeout=30s) para suportar startup lento com Kafka
    const res = healthCheckSeed();

    if (res.status === 200) {
      let statusLabel = 'OK';
      try { statusLabel = res.json('status'); } catch (_) {}
      console.log(`[seed] API OK em ${BASE_URL} (status: ${statusLabel}) — tentativa ${attempt}/${MAX_RETRIES}`);
      return;
    }

    if (res.status === 403 || res.status === 401) {
      fail(
        `[seed] API retornou ${res.status} em ${BASE_URL}/actuator/health.\n` +
        `  → Indica porta errada ou proxy bloqueando.\n` +
        `  → docker-compose da voting-session usa porta 8081: BASE_URL=http://localhost:8081\n` +
        `  → Dentro do Docker: BASE_URL=http://host.docker.internal:8081`
      );
    }

    if (res.status === 0) {
      console.warn(
        `[seed] API inacessível em ${BASE_URL} (tentativa ${attempt}/${MAX_RETRIES}) — connection refused/timeout.\n` +
        `  → Porta padrão do docker-compose: 8081. Verifique: BASE_URL=http://localhost:8081\n` +
        `  → Para subir: cd <voting-session> && docker compose up -d`
      );
    } else {
      console.warn(`[seed] Health retornou HTTP ${res.status} (tentativa ${attempt}/${MAX_RETRIES})`);
    }

    if (attempt < MAX_RETRIES) {
      console.log(`[seed] Aguardando ${RETRY_INTERVAL_S}s antes de tentar novamente...`);
      sleep(RETRY_INTERVAL_S);
    }
  }

  // Última tentativa falhou
  fail(
    `[seed] API inacessível em ${BASE_URL} após ${MAX_RETRIES} tentativas.\n` +
    `  1. Verifique se a aplicação está rodando:\n` +
    `       cd <caminho>/voting-session && docker compose up -d\n` +
    `  2. Confirme a porta correta:\n` +
    `       curl ${BASE_URL}/actuator/health\n` +
    `  3. Se a porta for diferente, ajuste BASE_URL no .env:\n` +
    `       BASE_URL=http://localhost:<porta>`
  );
}

/**
 * Cria N pautas com sessão aberta (duração configurável em minutos).
 * Sessão longa por padrão para não fechar durante testes de imersão.
 *
 * @param {number} count            Número de pautas a criar
 * @param {number} sessionDuration  Duração da sessão em minutos
 * @returns {string[]}              Array de agendaIds com sessão aberta
 */
export function seedAgendasWithOpenSessions(count = SEED_AGENDAS, sessionDuration = 120) {
  assertApiReachable();

  const agendaIds = [];

  for (let i = 0; i < count; i++) {
    const title = `[k6-seed-${i}] Pauta de Performance ${Date.now()}-${i}`;

    const agendaRes = createAgenda(title, 'Pauta criada automaticamente pelo k6 setup');
    check(agendaRes, {
      [`seed: agenda ${i} created`]: (r) => r.status === 201,
    });

    if (agendaRes.status !== 201) {
      const body = agendaRes.body ? String(agendaRes.body).substring(0, 150) : '(empty)';
      console.error(`[seed] Falha ao criar agenda ${i}: HTTP ${agendaRes.status} | ${body}`);

      // 403 consecutivos → abortar seed cedo com dica clara
      if (agendaRes.status === 403) {
        console.error(
          `[seed] HTTP 403 recebido. Possíveis causas:\n` +
          `  1. BASE_URL aponta para porta errada.\n` +
          `     docker-compose usa porta 8081: BASE_URL=http://localhost:8081\n` +
          `  2. Há um proxy/firewall bloqueando a rota.\n` +
          `  Execute: curl -s ${BASE_URL}/api/v1/agendas`
        );
        break;
      }

      continue;
    }

    // Extrair ID com try/catch — nunca deixar o setup quebrar por JSON inválido
    let agendaId;
    try {
      agendaId = agendaRes.json('id');
    } catch (_) {
      console.error(`[seed] Resposta da agenda ${i} não é JSON válido.`);
      continue;
    }

    if (!agendaId) {
      console.error(`[seed] Agenda ${i} criada mas sem campo 'id' na resposta.`);
      continue;
    }

    const sessionRes = openSession(agendaId, sessionDuration);
    check(sessionRes, {
      [`seed: session ${i} opened`]: (r) => r.status === 201,
    });

    if (sessionRes.status !== 201) {
      console.error(`[seed] Falha ao abrir sessão para agenda ${agendaId}: HTTP ${sessionRes.status}`);
      // Mesmo sem sessão, mantém o agendaId para reads parciais
      agendaIds.push(agendaId);
      continue;
    }

    agendaIds.push(agendaId);
    sleep(0.05); // throttle mínimo para não sobrecarregar o setup
  }

  console.log(`[seed] ${agendaIds.length}/${count} agendas prontas (sessão: ${sessionDuration}min)`);

  if (agendaIds.length === 0) {
    console.warn(
      `[seed] AVISO: Nenhuma agenda criada.\n` +
      `  O teste continuará mas sem dados de seed — reads retornarão arrays vazios.\n` +
      `  Verifique BASE_URL: ${BASE_URL}`
    );
  }

  return agendaIds;
}
