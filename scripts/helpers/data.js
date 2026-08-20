/**
 * data.js — Gerador de dados de teste para voting-session
 *
 * Garante unicidade de associateId para evitar conflito 409
 * em testes com múltiplos VUs simultâneos.
 */

const CHOICES = ['Sim', 'Não'];
const AGENDA_TOPICS = [
  'Aprovação do orçamento anual',
  'Eleição da diretoria executiva',
  'Revisão do estatuto social',
  'Distribuição de sobras do exercício',
  'Aquisição de novo imóvel',
  'Política de crédito rural',
  'Plano de expansão regional',
  'Contratação de auditoria externa',
  'Renovação da frota de veículos',
  'Programa de educação cooperativista',
];

/**
 * Gera um CPF-like string único por VU + iteração.
 * Formato: VU{vuId}IT{iter}SEQ{seq} — identifica cada voto unicamente.
 */
export function uniqueAssociateId(vuId, iteration, seq = 0) {
  // Garante string de 11 dígitos numéricos (simula CPF sem validação)
  const base = String(vuId).padStart(3, '0')
             + String(iteration).padStart(4, '0')
             + String(seq).padStart(4, '0');
  return base.substring(0, 11);
}

/**
 * Gera título de pauta único por VU + iteração.
 */
export function uniqueAgendaTitle(vuId, iteration) {
  const topic = AGENDA_TOPICS[iteration % AGENDA_TOPICS.length];
  return `[k6-${vuId}-${iteration}] ${topic}`;
}

/**
 * Retorna escolha aleatória de voto.
 */
export function randomChoice() {
  return CHOICES[Math.floor(Math.random() * CHOICES.length)];
}

/**
 * Gera array de N associateIds únicos para um dado contexto.
 * Usado em volume test para criar muitos votos em uma pauta.
 */
export function generateAssociateIds(count, prefix = 0) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const id = String(prefix * 10000 + i).padStart(11, '0');
    ids.push(id);
  }
  return ids;
}

/**
 * Gera descrição aleatória para pauta.
 */
export function randomDescription() {
  const desc = [
    'Pauta submetida para deliberação em assembleia geral ordinária.',
    'Item de pauta urgente para apreciação dos associados.',
    'Proposta do conselho de administração para aprovação.',
    'Decisão estratégica conforme art. 42 do estatuto social.',
  ];
  return desc[Math.floor(Math.random() * desc.length)];
}
