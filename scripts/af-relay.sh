#!/usr/bin/env bash
# وسيط API-Football (يُشغَّل من .github/workflows/af-relay.yml)
# حلقة مستمرة: يسأل الخادم ماذا يحتاج (/api/__relay/plan)، يجلب من API-Football، يرسل النتيجة موقّعة،
# ثم ينتظر المدة التي يحددها الخادم (next) حسب المباريات الجارية والرصيد اليومي المتبقي.
set -uo pipefail

: "${API_FOOTBALL_KEY:?}" "${APP_URL:?}"
MAX_MINUTES=${MAX_MINUTES:-340}
deadline=$(( $(date +%s) + MAX_MINUTES * 60 ))
work=$(mktemp -d)
cd "$work"

api() { curl -s --retry 2 --max-time 30 -H "x-apisports-key: $API_FOOTBALL_KEY" "https://v3.football.api-sports.io$1"; }
# الرد صالح إن خلا من الأخطاء
ok() { jq -e '((.errors // []) | length) == 0 and (.response | type == "array")' >/dev/null 2>&1; }
add() { jq -c "$1" --slurpfile v "$2" ${3:+--arg k "$3"} payload.json > p.tmp && mv p.tmp payload.json; }
log() { echo "[$(date -u +%H:%M:%S)] $*"; }

tick() {
  next=120
  plan=$(curl -sf --retry 3 --max-time 30 "$APP_URL/api/__relay/plan") || { log "تعذّر جلب الخطة"; return; }
  next=$(echo "$plan" | jq -r '.next // 300')
  log "خطة: $(echo "$plan" | jq -c '{mode, live, full, days, next, fastSec, slowSec, liveLeft, browseLeft}')"
  leagues=$(echo "$plan" | jq -c '.leagues')
  echo '{}' > payload.json

  days=$(echo "$plan" | jq -r '.days | join(" ")')
  if [ "$(echo "$plan" | jq -r '.live')" = true ]; then
    api "/fixtures?live=$(echo "$leagues" | jq -r 'join("-")')" > live.json
    if ok < live.json; then
      jq -c '.response' live.json > v.json && add '.live = $v[0]' v.json
      log "مباشر: $(jq length v.json)"
      # مباريات كانت جارية واختفت من المباشر: قائمة يومها تعطي النتيجة النهائية
      extra=$(echo "$plan" | jq -r --slurpfile v v.json '($v[0] | map(.fixture.id | tostring)) as $live | .openDays | to_entries | map(select(.key as $k | $live | index($k) | not) | .value) | unique | join(" ")')
      if [ -n "$extra" ]; then days=$(echo $days $extra | tr ' ' '\n' | sort -u | tr '\n' ' '); fi
    else
      log "::warning::المباشر: $(jq -c '.errors' live.json 2>/dev/null)"
    fi
  fi

  # التفاصيل (أحداث + إحصائيات + تشكيلة): مباراة واحدة لكل طلب في الخطة المجانية
  echo '[]' > full.json
  for id in $(echo "$plan" | jq -r '.full[]'); do
    api "/fixtures?id=$id" > f.json
    if ok < f.json; then
      # بيانات اللاعبين الفردية غير مستخدمة وكبيرة الحجم
      jq -c '[.response[] | {fixture, league, teams, goals, score, events, lineups, statistics}]' f.json > v.json
      jq -c -s 'add' full.json v.json > p.tmp && mv p.tmp full.json
    else
      log "::warning::التفاصيل $id: $(jq -c '.errors' f.json 2>/dev/null)"
    fi
  done
  if [ "$(jq length full.json)" != 0 ]; then add '.full = $v[0]' full.json; log "تفاصيل: $(jq length full.json)"; fi

  for d in $days; do
    api "/fixtures?date=$d&timezone=UTC" > day.json
    if ok < day.json; then
      jq -c --argjson L "$leagues" '[.response[] | select(.league.id as $l | $L | index($l))]' day.json > v.json
      add '.days[$k] = $v[0]' v.json "$d"
      log "$d: $(jq length v.json)"
    else
      log "::warning::$d: $(jq -c '.errors' day.json 2>/dev/null)"
    fi
  done

  [ "$(jq 'length' payload.json)" = 0 ] && return
  jq -c --argjson ts "$(date +%s%3N)" '. + {ts: $ts}' payload.json > body.json
  sig=$(openssl dgst -sha256 -hmac "$API_FOOTBALL_KEY" -hex < body.json | awk '{print $NF}')
  code=$(curl -s -o res.json -w '%{http_code}' --retry 2 --max-time 60 -X POST "$APP_URL/api/__relay/ingest" \
    -H 'content-type: application/json' -H "x-relay-signature: $sig" --data-binary @body.json)
  log "إرسال $(wc -c < body.json) بايت -> $code $(cat res.json)"
}

while :; do
  tick
  case "$next" in ''|*[!0-9]*) next=300;; esac
  [ "$next" -lt 60 ] && next=60
  # نترك وقتاً لتشغيل الحلقة التالية قبل حد GitHub (6 ساعات للمهمة)
  if [ $(( $(date +%s) + next )) -ge "$deadline" ]; then break; fi
  log "انتظار ${next}s"
  sleep "$next"
done

# تشغيل الحلقة التالية (GITHUB_TOKEN يستطيع تشغيل workflow_dispatch)
if [ -n "${GITHUB_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] && [ "${RELAY_CHAIN:-true}" = true ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $GITHUB_TOKEN" -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$GITHUB_REPOSITORY/actions/workflows/af-relay.yml/dispatches" -d "{\"ref\":\"$GITHUB_REF_NAME\"}")
  log "تشغيل الحلقة التالية -> $code"
fi
