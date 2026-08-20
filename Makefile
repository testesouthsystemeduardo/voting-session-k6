# ══════════════════════════════════════════════════════════════════════════════
# Makefile — voting-session-k6
#
# Interface unificada para executar testes, gerenciar a stack e gerar relatórios.
#
# Uso:
#   make help               — Lista todos os comandos disponíveis
#   make stack-up           — Sobe InfluxDB + Grafana
#   make load               — Executa Teste de Carga
#   make stress             — Executa Teste de Estresse
#   make spike              — Executa Teste de Pico
#   make soak               — Executa Teste de Imersão
#   make volume             — Executa Teste de Volume
#   make all-tests          — Executa todos os testes em sequência
# ══════════════════════════════════════════════════════════════════════════════

# Carrega variáveis do .env se existir
-include .env

BASE_URL             ?= http://localhost:8081
LOAD_VUS             ?= 50
SOAK_DURATION        ?= 30m
VOLUME_AGENDAS       ?= 500
VOLUME_VOTES_PER_AGENDA ?= 20
GRAFANA_PORT         ?= 3000
INFLUXDB_DB          ?= k6
K6_INFLUXDB_OUT      ?= false

export BASE_URL LOAD_VUS SOAK_DURATION VOLUME_AGENDAS VOLUME_VOTES_PER_AGENDA
export GRAFANA_PORT INFLUXDB_DB K6_INFLUXDB_OUT

.PHONY: help stack-up stack-down stack-logs grafana-open \
        load stress spike soak volume all-tests \
        clean-reports check-k6 check-deps

# ─── Help ────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "voting-session-k6 — Suite de Performance com k6"
	@echo ""
	@echo "Stack de Observabilidade:"
	@echo "  make stack-up        Sobe InfluxDB + Grafana (docker compose)"
	@echo "  make stack-down      Para e remove a stack"
	@echo "  make stack-logs      Acompanha logs da stack"
	@echo "  make grafana-open    Abre Grafana no browser"
	@echo ""
	@echo "Testes:"
	@echo "  make load            Teste de Carga (uso diário normal)"
	@echo "  make stress          Teste de Estresse (breaking point)"
	@echo "  make spike           Teste de Pico (choque repentino)"
	@echo "  make soak            Teste de Imersão (memory leak)"
	@echo "  make volume          Teste de Volume (massa de dados)"
	@echo "  make all-tests       Executa todos em sequência"
	@echo ""
	@echo "Com InfluxDB output:"
	@echo "  make stack-up && K6_INFLUXDB_OUT=true make load"
	@echo ""
	@echo "Variáveis configuráveis:"
	@echo "  BASE_URL=$(BASE_URL)"
	@echo "  LOAD_VUS=$(LOAD_VUS)"
	@echo "  SOAK_DURATION=$(SOAK_DURATION)"
	@echo "  VOLUME_AGENDAS=$(VOLUME_AGENDAS)"
	@echo ""
	@echo "Relatórios:"
	@echo "  make clean-reports   Remove relatórios antigos"
	@echo ""

# ─── Stack de Observabilidade ─────────────────────────────────────────────────
stack-up:
	@echo "→ Subindo InfluxDB + Grafana..."
	docker compose up -d influxdb grafana
	@echo "✓ Stack iniciada"
	@echo "  Grafana:  http://localhost:$(GRAFANA_PORT) (admin/admin)"
	@echo "  InfluxDB: http://localhost:8086"

stack-down:
	docker compose down

stack-logs:
	docker compose logs -f influxdb grafana

grafana-open:
	xdg-open "http://localhost:$(GRAFANA_PORT)/d/k6-voting-session" 2>/dev/null \
	|| open "http://localhost:$(GRAFANA_PORT)/d/k6-voting-session" 2>/dev/null \
	|| echo "Acesse: http://localhost:$(GRAFANA_PORT)/d/k6-voting-session"

# ─── Verificações ─────────────────────────────────────────────────────────────
check-k6:
	@command -v k6 >/dev/null 2>&1 || (command -v docker >/dev/null 2>&1 && echo "Using Docker for k6") || \
	  (echo "ERROR: k6 ou Docker necessários. https://k6.io/docs/get-started/installation/" && exit 1)

check-deps: check-k6
	@echo "✓ Dependências verificadas"

# ─── Testes individuais ───────────────────────────────────────────────────────
load: check-k6
	@chmod +x run/run-test.sh
	./run/run-test.sh load

stress: check-k6
	@chmod +x run/run-test.sh
	./run/run-test.sh stress

spike: check-k6
	@chmod +x run/run-test.sh
	./run/run-test.sh spike

soak: check-k6
	@chmod +x run/run-test.sh
	./run/run-test.sh soak

volume: check-k6
	@chmod +x run/run-test.sh
	./run/run-test.sh volume

# ─── Suite completa ───────────────────────────────────────────────────────────
all-tests: check-k6
	@chmod +x run/run-all.sh run/run-test.sh
	./run/run-all.sh

# Suite rápida: pula soak (muito longo) para CI
quick-tests: check-k6
	@chmod +x run/run-all.sh run/run-test.sh
	./run/run-all.sh --skip soak

# ─── Relatórios ───────────────────────────────────────────────────────────────
clean-reports:
	@echo "→ Removendo relatórios antigos..."
	find reports/ -name "*.json" -o -name "*.html" -o -name "*.md" | \
	  grep -v ".gitkeep" | xargs rm -f 2>/dev/null || true
	@echo "✓ Relatórios removidos"
