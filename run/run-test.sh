#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# run-test.sh — Executa um tipo de teste k6 específico
#
# Uso:
#   ./run/run-test.sh <tipo-de-teste> [opções]
#
# Tipos disponíveis:
#   load     Teste de Carga      (01-load-test.js)
#   stress   Teste de Estresse   (02-stress-test.js)
#   spike    Teste de Pico       (03-spike-test.js)
#   soak     Teste de Imersão    (04-soak-test.js)
#   volume   Teste de Volume     (05-volume-test.js)
#
# Exemplos:
#   ./run/run-test.sh load
#   ./run/run-test.sh stress --vus 200
#   ./run/run-test.sh soak --env SOAK_DURATION=2h
#   BASE_URL=http://api.staging.example.com ./run/run-test.sh load
#   ./run/run-test.sh load --out influxdb=http://localhost:8086/k6
#
# Variáveis de ambiente:
#   BASE_URL            URL base da API (padrão: http://localhost:8080)
#   LOAD_VUS            VUs para load test (padrão: 50)
#   SOAK_DURATION       Duração do soak test (padrão: 30m)
#   VOLUME_AGENDAS      Total de pautas para volume test (padrão: 500)
#   K6_INFLUXDB_OUT     Se "true", habilita output para InfluxDB
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TESTS_DIR="$ROOT_DIR/scripts/tests"
REPORTS_DIR="$ROOT_DIR/reports"

# ─── Carrega .env automaticamente (se existir) ───────────────────────────────
# Garante que `./run/run-test.sh load` e `make load` tenham o mesmo comportamento.
ENV_FILE="$ROOT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a  # exporta automaticamente todas as variáveis definidas no source
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  echo -e "\033[0;34m[INFO]\033[0m  Configurações carregadas de: $ENV_FILE"
fi

# ─── Cores ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
log_success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
log_header()  { echo -e "\n${BOLD}${BLUE}══ $* ══${RESET}\n"; }

# ─── Mapa de tipos → arquivos ─────────────────────────────────────────────────
declare -A TEST_FILES=(
  [load]="01-load-test.js"
  [stress]="02-stress-test.js"
  [spike]="03-spike-test.js"
  [soak]="04-soak-test.js"
  [volume]="05-volume-test.js"
)

declare -A TEST_DESCRIPTIONS=(
  [load]="Teste de Carga — simula uso diário esperado"
  [stress]="Teste de Estresse — descobre o ponto de quebra"
  [spike]="Teste de Pico — choque repentino de usuários"
  [soak]="Teste de Imersão — detecta memory leaks em longo prazo"
  [volume]="Teste de Volume — insere massa de dados no banco"
)

# ─── Validação de argumentos ──────────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
  log_error "Tipo de teste não informado."
  echo ""
  echo "Uso: $0 <tipo> [k6-args...]"
  echo ""
  echo "Tipos disponíveis:"
  for t in "${!TEST_FILES[@]}"; do
    echo "  $t — ${TEST_DESCRIPTIONS[$t]}"
  done | sort
  exit 1
fi

TEST_TYPE="${1,,}"  # lowercase
shift

if [[ -z "${TEST_FILES[$TEST_TYPE]+x}" ]]; then
  log_error "Tipo desconhecido: '$TEST_TYPE'"
  echo "Tipos válidos: ${!TEST_FILES[*]}"
  exit 1
fi

TEST_SCRIPT="$TESTS_DIR/${TEST_FILES[$TEST_TYPE]}"

if [[ ! -f "$TEST_SCRIPT" ]]; then
  log_error "Script não encontrado: $TEST_SCRIPT"
  exit 1
fi

# ─── Verificar se k6 está instalado ──────────────────────────────────────────
K6_CMD=""
if command -v k6 &>/dev/null; then
  K6_CMD="k6"
elif command -v docker &>/dev/null; then
  log_warn "k6 não encontrado localmente. Usando Docker."
  K6_CMD="docker run --rm \
    -v $ROOT_DIR/scripts:/scripts \
    -v $REPORTS_DIR:/reports \
    -e BASE_URL=${BASE_URL:-http://host.docker.internal:8081} \
    -e LOAD_VUS=${LOAD_VUS:-50} \
    -e LOAD_RAMPUP=${LOAD_RAMPUP:-1m} \
    -e LOAD_STEADY=${LOAD_STEADY:-5m} \
    -e LOAD_RAMPDOWN=${LOAD_RAMPDOWN:-1m} \
    -e STRESS_MAX_VUS=${STRESS_MAX_VUS:-300} \
    -e STRESS_STAGE_DURATION=${STRESS_STAGE_DURATION:-2m} \
    -e STRESS_RECOVERY_VUS=${STRESS_RECOVERY_VUS:-50} \
    -e SPIKE_BASE_VUS=${SPIKE_BASE_VUS:-10} \
    -e SPIKE_PEAK_VUS=${SPIKE_PEAK_VUS:-500} \
    -e SPIKE_WARMUP_DURATION=${SPIKE_WARMUP_DURATION:-1m} \
    -e SPIKE_PEAK_DURATION=${SPIKE_PEAK_DURATION:-2m} \
    -e SPIKE_RECOVERY_DURATION=${SPIKE_RECOVERY_DURATION:-3m} \
    -e SOAK_DURATION=${SOAK_DURATION:-30m} \
    -e SOAK_RAMPUP=${SOAK_RAMPUP:-2m} \
    -e SOAK_RAMPDOWN=${SOAK_RAMPDOWN:-1m} \
    -e VOLUME_AGENDAS=${VOLUME_AGENDAS:-500} \
    -e VOLUME_VOTES_PER_AGENDA=${VOLUME_VOTES_PER_AGENDA:-20} \
    -e VOLUME_INSERT_VUS=${VOLUME_INSERT_VUS:-10} \
    -e VOLUME_WARMUP_VUS=${VOLUME_WARMUP_VUS:-5} \
    -e VOLUME_QUERY_VUS=${VOLUME_QUERY_VUS:-20} \
    -e VOLUME_QUERY_DURATION=${VOLUME_QUERY_DURATION:-5m} \
    --add-host host.docker.internal:host-gateway \
    --network k6-network \
    grafana/k6:0.53.0"
else
  log_error "k6 e Docker não encontrados. Instale um deles para continuar."
  log_error "k6:    https://k6.io/docs/get-started/installation/"
  log_error "Docker: https://docs.docker.com/get-docker/"
  exit 1
fi

# ─── Pre-flight: verificar se a API está acessível ───────────────────────────
TARGET_URL="${BASE_URL:-http://localhost:8081}"
HEALTH_URL="${TARGET_URL}/actuator/health"

log_info "Pre-flight: verificando API em ${HEALTH_URL} ..."

HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")

if [[ "$HEALTH_STATUS" == "000" ]]; then
  log_error "API inacessível (connection refused / timeout): ${TARGET_URL}"
  echo ""
  echo "  Para subir a aplicação via docker-compose:"
  echo "    cd <caminho>/voting-session"
  echo "    docker compose up -d"
  echo ""
  echo "  Aguarde ~10s e verifique:"
  echo "    curl ${HEALTH_URL}"
  echo ""
  echo "  Se a porta for diferente, ajuste no .env:"
  echo "    BASE_URL=http://localhost:<porta>"
  exit 1
elif [[ "$HEALTH_STATUS" == "403" || "$HEALTH_STATUS" == "401" ]]; then
  log_warn "API retornou ${HEALTH_STATUS} em ${HEALTH_URL}."
  log_warn "Isso pode indicar porta errada ou proxy à frente."
  log_warn "Verifique: curl -v ${HEALTH_URL}"
  # Continua mesmo assim — pode ser configuração de actuator
elif [[ "$HEALTH_STATUS" != "200" ]]; then
  log_warn "Health check retornou HTTP ${HEALTH_STATUS}. Continuando mesmo assim..."
else
  log_success "API respondeu HTTP 200 — OK para iniciar o teste"
fi

# ─── Configurar output ────────────────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="$REPORTS_DIR/${TEST_TYPE}_${TIMESTAMP}.json"
SUMMARY_FILE="$REPORTS_DIR/${TEST_TYPE}_${TIMESTAMP}_summary.html"

mkdir -p "$REPORTS_DIR"

K6_OUT_ARGS=""

# Output InfluxDB se stack estiver rodando
if [[ "${K6_INFLUXDB_OUT:-false}" == "true" ]]; then
  INFLUXDB_ADDR="${INFLUXDB_URL:-http://localhost:8086}"
  K6_OUT_ARGS="--out influxdb=${INFLUXDB_ADDR}/${INFLUXDB_DB:-k6}"
  log_info "Output InfluxDB habilitado: ${INFLUXDB_ADDR}/${INFLUXDB_DB:-k6}"
fi

# Sempre gera JSON summary
K6_OUT_ARGS="$K6_OUT_ARGS --out json=$REPORT_FILE"

# ─── Executar ────────────────────────────────────────────────────────────────
log_header "k6 — ${TEST_DESCRIPTIONS[$TEST_TYPE]}"
log_info "Script:    ${TEST_SCRIPT}"
log_info "Alvo:      ${TARGET_URL}"
log_info "Relatório: ${REPORT_FILE}"
log_info "Timestamp: ${TIMESTAMP}"
echo ""

# Ajuste de caminho para Docker
SCRIPT_ARG="$TEST_SCRIPT"
if [[ "$K6_CMD" == docker* ]]; then
  SCRIPT_ARG="/scripts/tests/${TEST_FILES[$TEST_TYPE]}"
fi

# Exportar todas as variáveis de configuração para o processo k6
export BASE_URL="${BASE_URL:-http://localhost:8081}"

# Carga
export LOAD_VUS="${LOAD_VUS:-50}"
export LOAD_RAMPUP="${LOAD_RAMPUP:-1m}"
export LOAD_STEADY="${LOAD_STEADY:-5m}"
export LOAD_RAMPDOWN="${LOAD_RAMPDOWN:-1m}"

# Estresse
export STRESS_MAX_VUS="${STRESS_MAX_VUS:-300}"
export STRESS_STAGE_DURATION="${STRESS_STAGE_DURATION:-2m}"
export STRESS_RECOVERY_VUS="${STRESS_RECOVERY_VUS:-${LOAD_VUS}}"

# Pico
export SPIKE_BASE_VUS="${SPIKE_BASE_VUS:-10}"
export SPIKE_PEAK_VUS="${SPIKE_PEAK_VUS:-500}"
export SPIKE_WARMUP_DURATION="${SPIKE_WARMUP_DURATION:-1m}"
export SPIKE_PEAK_DURATION="${SPIKE_PEAK_DURATION:-2m}"
export SPIKE_RECOVERY_DURATION="${SPIKE_RECOVERY_DURATION:-3m}"

# Imersão
export SOAK_DURATION="${SOAK_DURATION:-30m}"
export SOAK_RAMPUP="${SOAK_RAMPUP:-2m}"
export SOAK_RAMPDOWN="${SOAK_RAMPDOWN:-1m}"

# Volume
export VOLUME_AGENDAS="${VOLUME_AGENDAS:-500}"
export VOLUME_VOTES_PER_AGENDA="${VOLUME_VOTES_PER_AGENDA:-20}"
export VOLUME_INSERT_VUS="${VOLUME_INSERT_VUS:-10}"
export VOLUME_WARMUP_VUS="${VOLUME_WARMUP_VUS:-5}"
export VOLUME_QUERY_VUS="${VOLUME_QUERY_VUS:-20}"
export VOLUME_QUERY_DURATION="${VOLUME_QUERY_DURATION:-5m}"

# Executar k6 com summary HTML via --summary-export
set +e
$K6_CMD run \
  --summary-export "$SUMMARY_FILE" \
  $K6_OUT_ARGS \
  "$@" \
  "$SCRIPT_ARG"

EXIT_CODE=$?
set -e

# ─── Resultado ───────────────────────────────────────────────────────────────
echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
  log_success "Teste '${TEST_TYPE}' concluído com SUCESSO (todos os thresholds OK)"
else
  log_error "Teste '${TEST_TYPE}' FALHOU (exit code: $EXIT_CODE — thresholds violados)"
fi

log_info "Relatório JSON:    $REPORT_FILE"
log_info "Summary HTML:      $SUMMARY_FILE"

# Gerar relatório HTML consolidado se o script existir
if [[ -f "$SCRIPT_DIR/generate-report.sh" ]]; then
  "$SCRIPT_DIR/generate-report.sh" "$REPORT_FILE" "$TEST_TYPE" "$TIMESTAMP" 2>/dev/null || true
fi

exit $EXIT_CODE
