#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# generate-report.sh — Gera relatório HTML a partir do JSON de saída do k6
#
# Uso:
#   ./run/generate-report.sh <json-file> [test-type] [timestamp]
#
# Exemplos:
#   ./run/generate-report.sh reports/load_20260820_143000.json load 20260820_143000
#   ./run/generate-report.sh reports/stress_20260820_143000.json
#
# Requer: jq (https://stedolan.github.io/jq/)
# Saída: reports/<test-type>_<timestamp>_report.html
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORTS_DIR="$(dirname "$SCRIPT_DIR")/reports"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; RESET='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${RESET}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${RESET}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
log_error() { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# ─── Argumentos ──────────────────────────────────────────────────────────────
JSON_FILE="${1:-}"
TEST_TYPE="${2:-unknown}"
TIMESTAMP="${3:-$(date +%Y%m%d_%H%M%S)}"

if [[ -z "$JSON_FILE" || ! -f "$JSON_FILE" ]]; then
  log_error "Arquivo JSON não encontrado: $JSON_FILE"
  echo "Uso: $0 <json-file> [test-type] [timestamp]"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  log_warn "jq não encontrado. Relatório HTML não será gerado."
  log_warn "Instale: https://stedolan.github.io/jq/"
  exit 0
fi

# ─── Extrair métricas do JSON k6 ──────────────────────────────────────────────
log_info "Extraindo métricas de: $JSON_FILE"

# k6 JSON summary format
extract_metric() {
  local metric="$1"
  local stat="$2"
  jq -r --arg m "$metric" --arg s "$stat" \
    '.metrics[$m][$s] // "N/A"' "$JSON_FILE" 2>/dev/null || echo "N/A"
}

P95=$(extract_metric "http_req_duration" "p(95)")
P99=$(extract_metric "http_req_duration" "p(99)")
P50=$(extract_metric "http_req_duration" "p(50)")
AVG=$(extract_metric "http_req_duration" "avg")
MAX=$(extract_metric "http_req_duration" "max")
MIN=$(extract_metric "http_req_duration" "min")

REQ_COUNT=$(extract_metric "http_reqs" "count")
REQ_RATE=$(extract_metric "http_reqs" "rate")
FAIL_RATE=$(extract_metric "http_req_failed" "rate")

VUS_MAX=$(extract_metric "vus_max" "max")

# Status geral — k6 retorna "pass" ou "fail" nos thresholds
PASS_COUNT=$(jq '[.metrics[] | .thresholds // {} | to_entries[] | select(.value.ok == true)] | length' "$JSON_FILE" 2>/dev/null || echo "0")
FAIL_COUNT=$(jq '[.metrics[] | .thresholds // {} | to_entries[] | select(.value.ok == false)] | length' "$JSON_FILE" 2>/dev/null || echo "0")
OVERALL_STATUS="PASSOU"
STATUS_COLOR="#27ae60"
if [[ "$FAIL_COUNT" -gt "0" ]]; then
  OVERALL_STATUS="FALHOU"
  STATUS_COLOR="#e74c3c"
fi

# ─── Gerar HTML ──────────────────────────────────────────────────────────────
OUTPUT_FILE="$REPORTS_DIR/${TEST_TYPE}_${TIMESTAMP}_report.html"

declare -A TEST_NAMES=(
  [load]="Teste de Carga"
  [stress]="Teste de Estresse"
  [spike]="Teste de Pico"
  [soak]="Teste de Resistência / Imersão"
  [volume]="Teste de Volume / Capacidade"
  [unknown]="Teste de Performance"
)

TEST_DISPLAY_NAME="${TEST_NAMES[$TEST_TYPE]:-$TEST_TYPE}"

format_ms() {
  local val="$1"
  if [[ "$val" == "N/A" ]]; then echo "N/A"; return; fi
  printf "%.2f ms" "$val" 2>/dev/null || echo "$val ms"
}

format_rate() {
  local val="$1"
  if [[ "$val" == "N/A" ]]; then echo "N/A"; return; fi
  printf "%.2f%%" "$(echo "$val * 100" | bc -l 2>/dev/null || echo 0)"
}

cat > "$OUTPUT_FILE" << HTML
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>k6 Report — ${TEST_DISPLAY_NAME}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #0f172a; color: #e2e8f0; padding: 2rem; }
    h1 { font-size: 1.8rem; color: #60a5fa; margin-bottom: 0.5rem; }
    h2 { font-size: 1.1rem; color: #94a3b8; font-weight: normal; margin-bottom: 2rem; }
    h3 { font-size: 1rem; color: #60a5fa; margin: 1.5rem 0 0.75rem; }
    .status-badge { display: inline-block; padding: 0.4rem 1.2rem; border-radius: 2rem;
                    background: ${STATUS_COLOR}; color: #fff; font-size: 1.2rem;
                    font-weight: bold; margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 1rem; margin-bottom: 2rem; }
    .card { background: #1e293b; border-radius: 0.75rem; padding: 1.25rem;
            border: 1px solid #334155; }
    .card-label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase;
                  letter-spacing: 0.1em; margin-bottom: 0.5rem; }
    .card-value { font-size: 1.8rem; font-weight: bold; color: #f1f5f9; }
    .card-unit  { font-size: 0.8rem; color: #64748b; }
    .card.warn  { border-color: #f59e0b; }
    .card.error { border-color: #ef4444; }
    table { width: 100%; border-collapse: collapse; background: #1e293b;
            border-radius: 0.75rem; overflow: hidden; }
    th { background: #0f172a; color: #60a5fa; padding: 0.75rem 1rem;
         text-align: left; font-size: 0.85rem; text-transform: uppercase; }
    td { padding: 0.75rem 1rem; border-bottom: 1px solid #334155; font-size: 0.9rem; }
    tr:last-child td { border-bottom: none; }
    .ok  { color: #4ade80; }
    .bad { color: #f87171; }
    footer { margin-top: 3rem; font-size: 0.75rem; color: #475569; text-align: center; }
  </style>
</head>
<body>
  <h1>📊 k6 — ${TEST_DISPLAY_NAME}</h1>
  <h2>voting-session API · Gerado em: $(date)</h2>

  <div class="status-badge">${OVERALL_STATUS}</div>

  <h3>Métricas de Latência HTTP</h3>
  <div class="grid">
    <div class="card"><div class="card-label">p50 (mediana)</div>
      <div class="card-value">$(format_ms "$P50")</div></div>
    <div class="card"><div class="card-label">p95</div>
      <div class="card-value">$(format_ms "$P95")</div></div>
    <div class="card"><div class="card-label">p99</div>
      <div class="card-value">$(format_ms "$P99")</div></div>
    <div class="card"><div class="card-label">Média</div>
      <div class="card-value">$(format_ms "$AVG")</div></div>
    <div class="card"><div class="card-label">Mínimo</div>
      <div class="card-value">$(format_ms "$MIN")</div></div>
    <div class="card"><div class="card-label">Máximo</div>
      <div class="card-value">$(format_ms "$MAX")</div></div>
  </div>

  <h3>Throughput e Estabilidade</h3>
  <div class="grid">
    <div class="card"><div class="card-label">Total de Requisições</div>
      <div class="card-value">${REQ_COUNT}</div></div>
    <div class="card"><div class="card-label">Throughput</div>
      <div class="card-value">${REQ_RATE}</div>
      <div class="card-unit">req/s</div></div>
    <div class="card"><div class="card-label">Taxa de Erro</div>
      <div class="card-value">$(format_rate "$FAIL_RATE")</div></div>
    <div class="card"><div class="card-label">VUs Máximos</div>
      <div class="card-value">${VUS_MAX}</div></div>
    <div class="card"><div class="card-label">Thresholds OK</div>
      <div class="card-value ok">${PASS_COUNT}</div></div>
    <div class="card"><div class="card-label">Thresholds Violados</div>
      <div class="card-value $([ "$FAIL_COUNT" -gt 0 ] && echo bad || echo ok)">${FAIL_COUNT}</div></div>
  </div>

  <h3>Arquivo de Dados Brutos</h3>
  <p style="color:#64748b; margin-top:0.5rem; font-size:0.85rem;">
    📄 <code>${JSON_FILE}</code>
  </p>

  <footer>
    Gerado por voting-session-k6 · ${TEST_TYPE} · ${TIMESTAMP}
  </footer>
</body>
</html>
HTML

log_ok "Relatório HTML gerado: $OUTPUT_FILE"
