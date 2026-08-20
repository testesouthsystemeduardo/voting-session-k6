/**
 * data.js — Gerador de dados de teste para voting-session
 *
 * Garante unicidade de associateId para evitar conflito 409
 * em testes com múltiplos VUs simultâneos.
 *
 * IMPORTANTE: os CPFs gerados aqui são matematicamente válidos
 * (passam na verificação de dígitos verificadores) para não serem
 * rejeitados pela validação de CPF da API voting-session.
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

// ─── Geração de CPF válido ────────────────────────────────────────────────────

/**
 * Calcula um dígito verificador do CPF.
 * @param {number[]} digits - Array de dígitos usados no cálculo
 * @returns {number} Dígito verificador (0-9)
 */
function calcCheckDigit(digits) {
  const len    = digits.length;
  let   sum    = 0;
  for (let i = 0; i < len; i++) {
    sum += digits[i] * (len + 1 - i);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/**
 * Verifica se todos os 9 dígitos base são iguais (CPF inválido por definição).
 * Ex: 111.111.111-xx é inválido independente dos dígitos verificadores.
 */
function isAllSameDigits(digits) {
  return digits.every((d) => d === digits[0]);
}

/**
 * Gera um CPF matematicamente válido (11 dígitos, string) a partir de um seed
 * numérico inteiro. O mesmo seed sempre produz o mesmo CPF (determinístico).
 *
 * Algoritmo:
 *  1. Extrai 9 dígitos do seed
 *  2. Se todos iguais, incrementa o último para garantir unicidade
 *  3. Calcula os 2 dígitos verificadores pelo algoritmo oficial da Receita Federal
 *
 * @param {number} seed - Inteiro >= 0 usado como base dos 9 primeiros dígitos
 * @returns {string} CPF de 11 dígitos sem formatação (ex: "04598123671")
 */
export function generateValidCpf(seed) {
  // Extrai 9 dígitos do seed, garantindo range 100000000–999999999
  const base9 = (Math.abs(seed) % 900000000) + 100000000;
  const digits = String(base9).split('').map(Number);

  // CPF com todos os dígitos iguais é inválido — corrige o último
  if (isAllSameDigits(digits)) {
    digits[8] = (digits[8] + 1) % 10;
  }

  const d1 = calcCheckDigit(digits);
  const d2 = calcCheckDigit([...digits, d1]);

  return [...digits, d1, d2].join('');
}

// ─── IDs únicos por VU / iteração ────────────────────────────────────────────

/**
 * Gera um CPF válido e único por combinação de VU + iteração + seq.
 * Garante que cada VU em cada iteração use um CPF diferente,
 * evitando o erro 409 (associado já votou) em execuções paralelas.
 *
 * @param {number} vuId     - ID do Virtual User (k6 __VU)
 * @param {number} iteration - Iteração do VU (k6 __ITER)
 * @param {number} seq       - Sequencial adicional para volume tests
 * @returns {string} CPF válido de 11 dígitos
 */
export function uniqueAssociateId(vuId, iteration, seq = 0) {
  // Composição que garante unicidade no espaço VU×ITER×SEQ
  // Multiplica por primos para espalhar bem o espaço de valores
  const seed = (vuId * 99991) + (iteration * 9973) + (seq * 997);
  return generateValidCpf(seed);
}

// ─── Outros helpers ───────────────────────────────────────────────────────────

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
 * Gera array de N CPFs válidos e únicos para um dado contexto.
 * Usado em volume test para criar muitos votos em uma pauta.
 *
 * @param {number} count  - Quantos CPFs gerar
 * @param {number} prefix - Offset base para garantir unicidade entre chamadas
 * @returns {string[]} Array de CPFs válidos de 11 dígitos
 */
export function generateAssociateIds(count, prefix = 0) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    // Seed único por prefix × posição — mesmo prefix + i sempre dá o mesmo CPF
    ids.push(generateValidCpf(prefix * 10000 + i + 1));
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
