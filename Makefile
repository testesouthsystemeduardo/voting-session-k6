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

BASE_URL                 ?= http://127.0.0.1:8081

# ─── Timeout HTTP ─────────────────────────────────────────────────────────────
K6_TIMEOUT               ?= 10s

# ─── Carga (load) ─────────────────────────────────────────────────────────────
# Local Docker: 10-20 VUs | Staging: 50-200 VUs
LOAD_VUS                 ?= 20
LOAD_RAMPUP              ?= 30s
LOAD_STEADY              ?= 3m
LOAD_RAMPDOWN            ?= 30s

# ─── Estresse (stress) ────────────────────────────────────────────────────────
STRESS_MAX_VUS           ?= 150
STRESS_STAGE_DURATION    ?= 2m
STRESS_RECOVERY_VUS      ?= $(LOAD_VUS)

# ─── Pico (spike) ─────────────────────────────────────────────────────────────
SPIKE_BASE_VUS           ?= 5
SPIKE_PEAK_VUS           ?= 100
SPIKE_WARMUP_DURATION    ?= 30s
SPIKE_PEAK_DURATION      ?= 1m
SPIKE_RECOVERY_DURATION  ?= 2m

# ─── Imersão (soak) ───────────────────────────────────────────────────────────
SOAK_DURATION            ?= 10m
SOAK_RAMPUP              ?= 1m
SOAK_RAMPDOWN            ?= 30s

# ─── Volume ───────────────────────────────────────────────────────────────────
VOLUME_AGENDAS           ?= 100
VOLUME_VOTES_PER_AGENDA  ?= 10
VOLUME_INSERT_VUS        ?= 5
VOLUME_WARMUP_VUS        ?= 2
VOLUME_QUERY_VUS         ?= 10
VOLUME_QUERY_DURATION    ?= 2m

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
        clean-reports check-k6 check-deps wait-api

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

# Aguarda a API ficar pronta (até PREFLIGHT_MAX_WAIT segundos)
# Útil após 'docker compose up -d' quando o app demora para inicializar (ex: com Kafka)
#   make wait-api                  # aguarda até 120s
#   make wait-api PREFLIGHT_MAX_WAIT=180  # aguarda até 180s
wait-api:
	@echo "→ Aguardando API em $(BASE_URL)/actuator/health ..."
	@MAX=$${PREFLIGHT_MAX_WAIT:-120}; ELAPSED=0; INTERVAL=5; \
	while [ $$ELAPSED -lt $$MAX ]; do \
	  STATUS=$$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 5 \
	    "$(BASE_URL)/actuator/health" 2>/dev/null || echo "000"); \
	  if [ "$$STATUS" = "200" ]; then \
	    echo "  ✓ API pronta (HTTP 200) — após $${ELAPSED}s"; \
	    exit 0; \
	  fi; \
	  echo "  [$${ELAPSED}s] HTTP $$STATUS — aguardando $${INTERVAL}s..."; \
	  sleep $$INTERVAL; \
	  ELAPSED=$$((ELAPSED + INTERVAL)); \
	done; \
	echo "  ✗ API não ficou pronta em $${MAX}s"; \
	echo "    Verifique: docker compose logs app --tail=50"; \
	exit 1

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
