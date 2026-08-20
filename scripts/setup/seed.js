/**
 * seed.js — Setup compartilhado: cria pautas com sessão aberta
 * para testes que precisam de dados pré-existentes.
 *
 * Usado como função setup() no k6. Retorna dados para os VUs.
 *
 * Uso: importar e chamar setup() no arquivo de teste.
 */
import { createAgenda, openSession } from '../helpers/api.js';
import { check, sleep } from 'k6';

const SEED_AGENDAS = parseInt(__ENV.SEED_AGENDAS || '10');

/**
 * Cria N pautas com sessão aberta (duração: 120 minutos por padrão
 * para garantir que os testes de longa duração não encontrem sessão fechada).
 *
 * @returns {string[]} Array de agendaIds criados
 */
export function seedAgendasWithOpenSessions(count = SEED_AGENDAS, sessionDuration = 120) {
  const agendaIds = [];

  for (let i = 0; i < count; i++) {
    const title = `[k6-seed-${i}] Pauta de Performance ${Date.now()}-${i}`;

    const agendaRes = createAgenda(title, 'Pauta criada automaticamente pelo k6 setup');
    check(agendaRes, {
      [`seed: agenda ${i} created`]: (r) => r.status === 201,
    });

    if (agendaRes.status !== 201) {
      console.error(`[seed] Falha ao criar agenda ${i}: ${agendaRes.status} ${agendaRes.body}`);
      continue;
    }

    const agendaId = agendaRes.json('id');

    const sessionRes = openSession(agendaId, sessionDuration);
    check(sessionRes, {
      [`seed: session ${i} opened`]: (r) => r.status === 201,
    });

    if (sessionRes.status !== 201) {
      console.error(`[seed] Falha ao abrir sessão para agenda ${agendaId}: ${sessionRes.status}`);
      continue;
    }

    agendaIds.push(agendaId);
    sleep(0.1); // evita rate-limit no setup
  }

  console.log(`[seed] ${agendaIds.length}/${count} agendas criadas com sessão aberta`);
  return agendaIds;
}
