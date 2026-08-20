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

BASE_URL                 ?= http://localhost:8081

# ─── Carga (load) ─────────────────────────────────────────────────────────────
LOAD_VUS                 ?= 50
LOAD_RAMPUP              ?= 1m
LOAD_STEADY              ?= 5m
LOAD_RAMPDOWN            ?= 1m

# ─── Estresse (stress) ────────────────────────────────────────────────────────
STRESS_MAX_VUS           ?= 300
STRESS_STAGE_DURATION    ?= 2m
STRESS_RECOVERY_VUS      ?= $(LOAD_VUS)

# ─── Pico (spike) ─────────────────────────────────────────────────────────────
SPIKE_BASE_VUS           ?= 10
SPIKE_PEAK_VUS           ?= 500
SPIKE_WARMUP_DURATION    ?= 1m
SPIKE_PEAK_DURATION      ?= 2m
SPIKE_RECOVERY_DURATION  ?= 3m

# ─── Imersão (soak) ───────────────────────────────────────────────────────────
SOAK_DURATION            ?= 30m
SOAK_RAMPUP              ?= 2m
SOAK_RAMPDOWN            ?= 1m

# ─── Volume ───────────────────────────────────────────────────────────────────
VOLUME_AGENDAS           ?= 500
VOLUME_VOTES_PER_AGENDA  ?= 20
VOLUME_INSERT_VUS        ?= 10
VOLUME_WARMUP_VUS        ?= 5
VOLUME_QUERY_VUS         ?= 20
VOLUME_QUERY_DURATION    ?= 5m

# ─── Observabilidade ──────────────────────────────────────────────────────────
GRAFANA_PORT             ?= 3000
INFLUXDB_DB              ?= k6
K6_INFLUXDB_OUT          ?= false

export BASE_URL \
       LOAD_VUS LOAD_RAMPUP LOAD_STEADY LOAD_RAMPDOWN \
       STRESS_MAX_VUS STRESS_STAGE_DURATION STRESS_RECOVERY_VUS \
       SPIKE_BASE_VUS SPIKE_PEAK_VUS SPIKE_WARMUP_DURATION SPIKE_PEAK_DURATION SPIKE_RECOVERY_DURATION \
       SOAK_DURATION SOAK_RAMPUP SOAK_RAMPDOWN \
       VOLUME_AGENDAS VOLUME_VOTES_PER_AGENDA VOLUME_INSERT_VUS VOLUME_WARMUP_VUS VOLUME_QUERY_VUS VOLUME_QUERY_DURATION \
       GRAFANA_PORT INFLUXDB_DB K6_INFLUXDB_OUT

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
	@echo "Variáveis por tipo de teste:"
	@echo "  BASE_URL=$(BASE_URL)"
	@echo ""
	@echo "  [load]   LOAD_VUS=$(LOAD_VUS)  LOAD_RAMPUP=$(LOAD_RAMPUP)  LOAD_STEADY=$(LOAD_STEADY)  LOAD_RAMPDOWN=$(LOAD_RAMPDOWN)"
	@echo "  [stress] STRESS_MAX_VUS=$(STRESS_MAX_VUS)  STRESS_STAGE_DURATION=$(STRESS_STAGE_DURATION)  STRESS_RECOVERY_VUS=$(STRESS_RECOVERY_VUS)"
	@echo "  [spike]  SPIKE_BASE_VUS=$(SPIKE_BASE_VUS)  SPIKE_PEAK_VUS=$(SPIKE_PEAK_VUS)  SPIKE_PEAK_DURATION=$(SPIKE_PEAK_DURATION)  SPIKE_RECOVERY_DURATION=$(SPIKE_RECOVERY_DURATION)"
	@echo "  [soak]   LOAD_VUS=$(LOAD_VUS)  SOAK_DURATION=$(SOAK_DURATION)  SOAK_RAMPUP=$(SOAK_RAMPUP)"
	@echo "  [volume] VOLUME_AGENDAS=$(VOLUME_AGENDAS)  VOLUME_VOTES_PER_AGENDA=$(VOLUME_VOTES_PER_AGENDA)  VOLUME_INSERT_VUS=$(VOLUME_INSERT_VUS)  VOLUME_QUERY_DURATION=$(VOLUME_QUERY_DURATION)"
	@echo ""
	@echo "Exemplos de uso com variáveis customizadas:"
	@echo "  LOAD_VUS=100 LOAD_STEADY=10m make load"
	@echo "  STRESS_MAX_VUS=500 STRESS_STAGE_DURATION=3m make stress"
	@echo "  SPIKE_PEAK_VUS=1000 SPIKE_PEAK_DURATION=5m make spike"
	@echo "  SOAK_DURATION=2h LOAD_VUS=20 make soak"
	@echo "  VOLUME_AGENDAS=1000 VOLUME_VOTES_PER_AGENDA=50 make volume"
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

check-api:
	@echo "→ Verificando API em $(BASE_URL)/actuator/health ..."
	@STATUS=$$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 \
	  "$(BASE_URL)/actuator/health" 2>/dev/null || echo "000"); \
	if [ "$$STATUS" = "000" ]; then \
	  echo ""; \
	  echo "  ✗ API inacessível: $(BASE_URL)"; \
	  echo ""; \
	  echo "  Suba a aplicação antes de rodar os testes:"; \
	  echo "    cd <caminho>/voting-session && docker compose up -d"; \
	  echo ""; \
	  exit 1; \
	elif [ "$$STATUS" = "200" ]; then \
	  echo "  ✓ API OK (HTTP 200)"; \
	else \
	  echo "  ⚠ API respondeu HTTP $$STATUS — verifique a URL e porta"; \
	fi

check-deps: check-k6 check-api
	@echo "✓ Todas as verificações passaram"

# ─── Testes individuais ───────────────────────────────────────────────────────
load: check-k6 check-api
	@chmod +x run/run-test.sh
	./run/run-test.sh load

stress: check-k6 check-api
	@chmod +x run/run-test.sh
	./run/run-test.sh stress

spike: check-k6 check-api
	@chmod +x run/run-test.sh
	./run/run-test.sh spike

soak: check-k6 check-api
	@chmod +x run/run-test.sh
	./run/run-test.sh soak

volume: check-k6 check-api
	@chmod +x run/run-test.sh
	./run/run-test.sh volume

# ─── Suite completa ───────────────────────────────────────────────────────────
all-tests: check-k6 check-api
	@chmod +x run/run-all.sh run/run-test.sh
	./run/run-all.sh

# Suite rápida: pula soak (muito longo) para CI
quick-tests: check-k6 check-api
	@chmod +x run/run-all.sh run/run-test.sh
	./run/run-all.sh --skip soak

# ─── Relatórios ───────────────────────────────────────────────────────────────
clean-reports:
	@echo "→ Removendo relatórios antigos..."
	find reports/ -name "*.json" -o -name "*.html" -o -name "*.md" | \
	  grep -v ".gitkeep" | xargs rm -f 2>/dev/null || true
	@echo "✓ Relatórios removidos"
