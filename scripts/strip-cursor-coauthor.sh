#!/usr/bin/env bash
# =============================================================================
# strip-cursor-coauthor.sh — Remove "Co-authored-by: Cursor" de TODOS os commits
#
# Reescreve o histórico Git (filter-branch). Não faz push.
# Depois de rodar com --yes, o remote só atualiza com: git push --force-with-lease
#
# Uso:
#   ./scripts/strip-cursor-coauthor.sh              # dry-run: lista commits afetados
#   ./scripts/strip-cursor-coauthor.sh --yes        # reescreve a branch atual
#   ./scripts/strip-cursor-coauthor.sh --yes --all  # todas as refs (branches + tags)
#
# Opções:
#   --yes       Executa a reescrita (sem esta flag, só lista)
#   --all       Varre --all em vez de HEAD da branch atual
#   --help      Exibe esta ajuda
# =============================================================================

set -euo pipefail

COAUTHOR_LINE='Co-authored-by: Cursor <cursoragent@cursor.com>'
APPLY=false
REV_LIST='HEAD'

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \?//'
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --yes)     APPLY=true ;;
    --all)     REV_LIST='--all' ;;
    --help|-h) usage ;;
    *)
      echo "Opção desconhecida: $arg" >&2
      echo "Use --help" >&2
      exit 1
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Erro: execute este script dentro de um repositório Git." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "Repositório: $REPO_ROOT"
echo "Linha a remover: ${COAUTHOR_LINE}"
echo

# --all inclui refs/original (backup do filter-branch) e o stash; isso
# geraria falso positivo depois da reescrita.
log_coauthor() {
  if [[ "$REV_LIST" == "--all" ]]; then
    git log --all --exclude='refs/original/*' --exclude='refs/stash' \
      --format="$1" --grep="$COAUTHOR_LINE" --fixed-strings
  else
    git log $REV_LIST --format="$1" --grep="$COAUTHOR_LINE" --fixed-strings
  fi
}

AFFECTED_COUNT="$(log_coauthor '%H' | wc -l | tr -d ' ')"

if [[ "$AFFECTED_COUNT" == "0" ]]; then
  echo "Nenhum commit contém a citação. Nada a fazer."
  exit 0
fi

echo "Commits afetados (${AFFECTED_COUNT}):"
log_coauthor '%h  %s'
echo

if [[ "$APPLY" != "true" ]]; then
  echo "Dry-run. Para reescrever o histórico:"
  echo "  $0 --yes$( [[ "$REV_LIST" == "--all" ]] && echo " --all" )"
  echo
  echo "Atenção: isso muda SHAs. Se a branch já foi enviada:"
  echo "  git push --force-with-lease"
  exit 0
fi

# Arquivos não rastreados (ex.: este próprio script) não impedem a reescrita.
if ! git diff-index --quiet HEAD --; then
  echo "Erro: working tree suja. Faça commit ou stash antes de reescrever o histórico." >&2
  git status --short
  exit 1
fi

FILTER_PY="$(mktemp)"
trap 'rm -f "$FILTER_PY"' EXIT

cat > "$FILTER_PY" << PY
#!/usr/bin/env python3
import re
import sys

needle = ${COAUTHOR_LINE@Q}
msg = sys.stdin.read()
pattern = re.compile(
    r"(?:\r?\n)?[ \t]*" + re.escape(needle) + r"[ \t]*(?:\r?\n)?",
    re.MULTILINE,
)
msg = pattern.sub("\n", msg)
msg = re.sub(r"\n{3,}", "\n\n", msg)
msg = msg.strip() + "\n"
sys.stdout.write(msg)
PY
chmod +x "$FILTER_PY"

echo "Reescrevendo histórico ($REV_LIST)..."
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --msg-filter "$FILTER_PY" -- $REV_LIST

echo
REMAINING="$(log_coauthor '%h' | wc -l | tr -d ' ')"
if [[ "$REMAINING" == "0" ]]; then
  echo "OK: citação removida de todos os commits."
else
  echo "Aviso: ainda restam ${REMAINING} commit(s) com a citação:" >&2
  log_coauthor '%h  %s'
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo
echo "Backup em refs/original/. Para descartar:"
echo "  git update-ref -d refs/original/refs/heads/${BRANCH}"
echo "  git reflog expire --expire=now --all && git gc --prune=now"
echo
echo "Se a branch já estava no remote:"
echo "  git push --force-with-lease"
