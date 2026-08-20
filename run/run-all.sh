#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# run-all.sh — Executa todos os testes de performance em sequência
#
# IMPORTANTE: Executar em sequência (não paralelo) para evitar
# interferência entre testes e garantir leituras isoladas.
#
# Uso:
#   ./run/run-all.sh
#   ./run/run-all.sh --skip soak,volume     # pula testes específicos
#   BASE_URL=http://staging:8080 ./run/run-all.sh
#
# Opções:
#   --skip <testes>   Pula testes separados por vírgula (ex: soak,volume)
#   --only <testes>   Executa apenas os testes informados
#
# Saída:
#   reports/all_<timestamp>_summary.md  — Relatório consolidado em Markdown
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
REPORTS_DIR="$ROOT_DIR/reports"

# Carrega .env automaticamente se existir
ENV_FILE="$ROOT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  echo -e "\033[0;34m[INFO]\033[0m  Configurações carregadas de: $ENV_FILE"
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
log_success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
log_header()  { echo -e "\n${BOLD}${BLUE}══════════════════════════════════════════${RESET}"; \
                echo -e "${BOLD}${BLUE}  $*${RESET}"; \
                echo -e "${BOLD}${BLUE}══════════════════════════════════════════${RESET}\n"; }

# ─── Parsing de argumentos ────────────────────────────────────────────────────
SKIP_TESTS=""
ONLY_TESTS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip) SKIP_TESTS="$2"; shift 2 ;;
    --only) ONLY_TESTS="$2"; shift 2 ;;
    *) log_error "Argumento desconhecido: $1"; exit 1 ;;
  esac
done

# ─── Definição da ordem dos testes ───────────────────────────────────────────
# Ordem importa: load → stress → spike → soak → volume
ALL_TESTS=("load" "stress" "spike" "soak" "volume")

# Filtrar testes a executar
TESTS_TO_RUN=()
for t in "${ALL_TESTS[@]}"; do
  if [[ -n "$ONLY_TESTS" ]]; then
    [[ ",$ONLY_TESTS," == *",$t,"* ]] && TESTS_TO_RUN+=("$t")
  elif [[ -n "$SKIP_TESTS" ]]; then
    [[ ",$SKIP_TESTS," != *",$t,"* ]] && TESTS_TO_RUN+=("$t")
  else
    TESTS_TO_RUN+=("$t")
  fi
done

if [[ ${#TESTS_TO_RUN[@]} -eq 0 ]]; then
  log_error "Nenhum teste selecionado para execução."
  exit 1
fi

# ─── Cabeçalho ───────────────────────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
CONSOLIDATED_REPORT="$REPORTS_DIR/all_${TIMESTAMP}_summary.md"

mkdir -p "$REPORTS_DIR"

log_header "voting-session — Suite Completa de Performance com k6"
log_info "Alvo:    ${BASE_URL:-http://localhost:8080}"
log_info "Testes:  ${TESTS_TO_RUN[*]}"
log_info "Início:  $(date)"
echo ""

# ─── Inicializar relatório consolidado ────────────────────────────────────────
cat > "$CONSOLIDATED_REPORT" << MDHEADER
# Relatório Consolidado — k6 Performance Tests
**Data:** $(date)
**Target:** ${BASE_URL:-http://localhost:8080}
**Testes executados:** ${TESTS_TO_RUN[*]}

---

| Teste | Status | Duração |
|-------|--------|---------|
MDHEADER

# ─── Executar testes ─────────────────────────────────────────────────────────
declare -A RESULTS
declare -A DURATIONS

TOTAL_PASS=0
TOTAL_FAIL=0

for TEST in "${TESTS_TO_RUN[@]}"; do
  log_header "Executando: $TEST"

  START_TS=$(date +%s)

  set +e
  "$SCRIPT_DIR/run-test.sh" "$TEST"
  EXIT_CODE=$?
  set -e

  END_TS=$(date +%s)
  DURATION=$((END_TS - START_TS))
  DURATIONS[$TEST]="${DURATION}s"

  if [[ $EXIT_CODE -eq 0 ]]; then
    RESULTS[$TEST]="✅ PASSOU"
    TOTAL_PASS=$((TOTAL_PASS + 1))
    log_success "Teste '$TEST' passou em ${DURATION}s"
  else
    RESULTS[$TEST]="❌ FALHOU"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    log_error "Teste '$TEST' falhou em ${DURATION}s"
  fi

  # Adicionar ao relatório consolidado
  echo "| $TEST | ${RESULTS[$TEST]} | ${DURATION}s |" >> "$CONSOLIDATED_REPORT"

  # Pausa entre testes para o sistema se recuperar
  if [[ "$TEST" != "${TESTS_TO_RUN[-1]}" ]]; then
    log_info "Aguardando 30s antes do próximo teste (recuperação do sistema)..."
    sleep 30
  fi
done

# ─── Finalizar relatório consolidado ─────────────────────────────────────────
cat >> "$CONSOLIDATED_REPORT" << MDFOOTER

---

## Resumo
- **Total:** ${#TESTS_TO_RUN[@]} testes
- **Passou:** $TOTAL_PASS
- **Falhou:** $TOTAL_FAIL
- **Fim:** $(date)

## Localização dos Relatórios Individuais
\`\`\`
$REPORTS_DIR/
\`\`\`

## Próximos Passos
- Analisar JSON reports para métricas detalhadas
- Verificar dashboard Grafana: http://localhost:${GRAFANA_PORT:-3000}
- Consultar soak_potential_leak_warnings para análise de memória
MDFOOTER

# ─── Resumo final ─────────────────────────────────────────────────────────────
log_header "Resumo da Suite"
echo ""
for TEST in "${TESTS_TO_RUN[@]}"; do
  printf "  %-10s %s  (%s)\n" "$TEST" "${RESULTS[$TEST]}" "${DURATIONS[$TEST]}"
done
echo ""
log_info "Relatório consolidado: $CONSOLIDATED_REPORT"

if [[ $TOTAL_FAIL -gt 0 ]]; then
  log_error "$TOTAL_FAIL teste(s) falharam. Verifique os relatórios para detalhes."
  exit 1
else
  log_success "Todos os $TOTAL_PASS testes passaram!"
  exit 0
fi
