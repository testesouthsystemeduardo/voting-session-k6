# voting-session-k6

Suite de testes de performance para a API [`voting-session`](https://github.com/testesouthsystemeduardo/voting-session), implementada com [k6](https://k6.io). Cobre os 5 tipos fundamentais de teste de carga com dashboards Grafana em tempo real e geração de relatórios HTML.

---

## Tipos de Teste Implementados

| # | Tipo | Arquivo | Objetivo |
|---|------|---------|----------|
| 1 | **Carga (Load)** | `01-load-test.js` | Simula o volume diário esperado e verifica estabilidade |
| 2 | **Estresse (Stress)** | `02-stress-test.js` | Aumenta carga progressivamente para encontrar o ponto de quebra |
| 3 | **Pico (Spike)** | `03-spike-test.js` | Choque repentino de 50x VUs — testa absorção e recuperação |
| 4 | **Imersão (Soak)** | `04-soak-test.js` | Carga constante por longo período — detecta memory leaks |
| 5 | **Volume (Capacity)** | `05-volume-test.js` | Insere massa de dados — valida índices e performance do banco |

---

## Arquitetura

```
voting-session-k6/
├── scripts/
│   ├── helpers/
│   │   ├── api.js          # Cliente HTTP — todos os endpoints da voting-session API
│   │   ├── data.js         # Gerador de dados únicos por VU/iteração
│   │   └── checks.js       # Validações de resposta e contadores de erro
│   ├── setup/
│   │   └── seed.js         # Setup compartilhado: cria pautas com sessão aberta
│   └── tests/
│       ├── 01-load-test.js
│       ├── 02-stress-test.js
│       ├── 03-spike-test.js
│       ├── 04-soak-test.js
│       └── 05-volume-test.js
├── run/
│   ├── run-test.sh         # Executa um teste específico
│   ├── run-all.sh          # Executa toda a suite em sequência
│   └── generate-report.sh  # Gera relatório HTML a partir do JSON k6
├── grafana/
│   ├── dashboards/         # Dashboard k6 pré-configurado
│   └── provisioning/       # Datasource InfluxDB auto-provisionado
├── reports/                # Relatórios gerados (JSON + HTML)
├── docker-compose.yml      # Stack: InfluxDB + Grafana + k6 runner
├── Makefile                # Interface unificada de comandos
└── .env.example            # Variáveis de ambiente configuráveis
```

---

## Pré-requisitos

### Opção A: k6 instalado localmente (recomendado)

```bash
# Linux (Debian/Ubuntu)
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# macOS
brew install k6

# Windows (Chocolatey)
choco install k6
```

### Opção B: Docker (sem instalação local)

O `run-test.sh` detecta automaticamente a ausência do k6 e usa Docker como fallback.

### Dependências opcionais

- **Docker Compose** — para stack de observabilidade (InfluxDB + Grafana)
- **jq** — para geração de relatório HTML (`sudo apt install jq`)
- **make** — para interface simplificada de comandos

---

## Quickstart

### 1. Configurar ambiente

```bash
cp .env.example .env
# Editar .env com a URL da API alvo
nano .env
```

```env
BASE_URL=http://localhost:8080   # URL da voting-session API
LOAD_VUS=50                       # VUs para teste de carga
SOAK_DURATION=30m                 # Duração do soak test
```

### 2. Subir stack de observabilidade (opcional mas recomendado)

```bash
make stack-up
# ou
docker compose up -d influxdb grafana
```

Acesse o Grafana em: http://localhost:3000 (admin/admin)

### 3. Executar um teste

```bash
# Via Make (recomendado)
make load
make stress
make spike
make soak
make volume

# Via script diretamente
./run/run-test.sh load
./run/run-test.sh stress

# Com variáveis customizadas
BASE_URL=http://staging.example.com LOAD_VUS=100 make load
```

### 4. Com output para InfluxDB (tempo real no Grafana)

```bash
make stack-up
K6_INFLUXDB_OUT=true make load
# Abre dashboard: make grafana-open
```

### 5. Executar toda a suite

```bash
# Suite completa (load → stress → spike → soak → volume)
make all-tests

# Suite rápida (pula soak — útil para CI)
make quick-tests

# Pular testes específicos
./run/run-all.sh --skip soak,volume

# Apenas testes específicos
./run/run-all.sh --only load,stress
```

---

## Endpoints Testados

A suite cobre todos os endpoints funcionais da `voting-session` API:

| Método | Endpoint | Teste |
|--------|----------|-------|
| `GET` | `/actuator/health` | Soak (health check periódico) |
| `POST` | `/api/v1/agendas` | Load, Stress, Spike, Soak, Volume |
| `GET` | `/api/v1/agendas` | Load, Stress, Spike, Soak, Volume |
| `GET` | `/api/v1/agendas/{id}` | Load |
| `POST` | `/api/v1/agendas/{id}/session` | Load, Stress, Spike, Soak, Volume |
| `POST` | `/api/v1/agendas/{id}/votes` | Load, Stress, Spike, Soak, Volume |
| `GET` | `/api/v1/agendas/{id}/result` | Load, Stress, Spike, Soak, Volume |

---

## Thresholds por Tipo de Teste

| Teste | p95 | p99 | Taxa de Erro |
|-------|-----|-----|--------------|
| Load  | < 500ms | < 1000ms | < 1% |
| Stress | N/A (observação) | < 5000ms | < 30% |
| Spike | N/A (spike) | < 3000ms | < 15% |
| Soak  | < 1000ms | < 2000ms | < 0.5% |
| Volume | < 1500ms | N/A | < 2% |

---

## Relatórios

Cada execução gera automaticamente:
- **`reports/<tipo>_<timestamp>.json`** — Dados brutos do k6 (todas as métricas)
- **`reports/<tipo>_<timestamp>_summary.html`** — Summary exportado pelo k6
- **`reports/<tipo>_<timestamp>_report.html`** — Relatório HTML enriquecido (requer `jq`)

Após `make all-tests`:
- **`reports/all_<timestamp>_summary.md`** — Relatório consolidado de toda a suite

---

## Dashboard Grafana

O dashboard `k6 — voting-session Performance` (provisionado automaticamente) exibe:

- **Visão geral**: req/s, taxa de erro, p95, VUs ativos
- **Latência por percentil**: p50, p90, p95, p99 ao longo do tempo
- **Latência por endpoint**: comparação entre `create_agenda`, `open_session`, `cast_vote`, `get_result`, `list_agendas`
- **Throughput + VUs**: correlação entre carga e taxa de requisições
- **Métricas customizadas**: latências de read/write (load), soak trend, volume query

---

## Integração com CI/CD

### GitHub Actions — Exemplo

```yaml
name: Performance Tests

on:
  workflow_dispatch:
    inputs:
      test_type:
        description: 'Tipo de teste'
        type: choice
        options: [load, stress, spike, quick-tests]
        default: load
      base_url:
        description: 'URL da API alvo'
        default: 'http://staging.example.com'

jobs:
  k6-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install k6
        run: |
          sudo gpg --no-default-keyring \
            --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
            --keyserver hkp://keyserver.ubuntu.com:80 \
            --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] \
            https://dl.k6.io/deb stable main" \
            | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update && sudo apt-get install k6 jq

      - name: Run Performance Test
        run: |
          chmod +x run/run-test.sh
          ./run/run-test.sh ${{ inputs.test_type }}
        env:
          BASE_URL: ${{ inputs.base_url }}
          LOAD_VUS: 30

      - name: Upload Reports
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: k6-reports-${{ inputs.test_type }}
          path: reports/
```

---

## Configuração de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `BASE_URL` | `http://localhost:8080` | URL base da API voting-session |
| `LOAD_VUS` | `50` | VUs para teste de carga |
| `SOAK_DURATION` | `30m` | Duração do soak test |
| `VOLUME_AGENDAS` | `500` | Total de pautas no volume test |
| `VOLUME_VOTES_PER_AGENDA` | `20` | Votos por pauta no volume test |
| `K6_INFLUXDB_OUT` | `false` | Habilita output para InfluxDB |
| `INFLUXDB_URL` | `http://localhost:8086` | URL do InfluxDB |
| `INFLUXDB_DB` | `k6` | Database no InfluxDB |
| `GRAFANA_PORT` | `3000` | Porta do Grafana |

---

## Relacionado

- [`voting-session`](https://github.com/testesouthsystemeduardo/voting-session) — API testada
- [`voting-session-infra`](https://github.com/testesouthsystemeduardo/voting-session-infra) — Infraestrutura Kubernetes + GitOps
