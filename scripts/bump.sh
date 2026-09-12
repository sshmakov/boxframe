#!/usr/bin/env bash
# Релиз: bump минорной версии в pyproject.toml, commit, тег vX.Y.Z, push ветки и тега.
# Использование: bash scripts/bump.sh [--dry-run]
set -euo pipefail

dry_run=0
if [[ "${1:-}" == "--dry-run" ]]; then
    dry_run=1
fi

cd "$(git rev-parse --show-toplevel)"

# 1. Чистое дерево (изменения в отслеживаемых файлах)
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: есть незакоммиченные изменения — прерываю:" >&2
    git status --short >&2
    exit 1
fi

# 2. Текущая версия из pyproject.toml
current=$(sed -n 's/^version = "\(.*\)"$/\1/p' pyproject.toml | head -n1)
if [[ ! "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    echo "ERROR: не удалось разобрать версию из pyproject.toml (получено: '${current}')" >&2
    exit 1
fi

major=${BASH_REMATCH[1]}
minor=${BASH_REMATCH[2]}
new_version="${major}.$((minor + 1)).0"
tag="v${new_version}"

# 3. Тег не должен существовать
if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null 2>&1; then
    echo "ERROR: тег ${tag} уже существует" >&2
    exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" == "HEAD" ]]; then
    echo "ERROR: detached HEAD — сначала закоммиться на ветку" >&2
    exit 1
fi

if [[ "$dry_run" == 1 ]]; then
    echo "DRY-RUN: ${current} -> ${new_version}, тег ${tag}, ветка ${branch} (без изменений)"
    exit 0
fi

# 4. Bump версии
sed -i "s/^version = \".*\"$/version = \"${new_version}\"/" pyproject.toml
if ! grep -q "^version = \"${new_version}\"$" pyproject.toml; then
    echo "ERROR: не удалось обновить версию в pyproject.toml" >&2
    exit 1
fi

# 5. Commit
git add pyproject.toml
git commit -m "chore(release): bump version to ${new_version}"

# 6. Тег
git tag "${tag}"

# 7. Push ветки и тега
git push origin "${branch}" "${tag}"

echo "OK: ${current} -> ${new_version} (commit $(git rev-parse --short HEAD), тег ${tag}, ветка ${branch})"
