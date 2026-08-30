#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Train Journey Live - test suite
#
#   ./test.sh
#
# Three passes, none of which need a device:
#   1. engine     - geometry, map matching, route tracing, arrival detection,
#                   driven by a scripted GPS trace over a synthetic railway
#   2. overpass   - the OpenStreetMap query and the JSON reader, against a
#                   response shaped exactly like the real API returns
#   3. api-surface- every framework call the compiled app makes, resolved
#                   against a genuine public android.jar, so nothing that only
#                   exists in AOSP can slip through and fail on a real phone
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT/build/test"
SRC="$ROOT/app/src/main/java/com/trainjourney/live"

ANDROID_JAR="${ANDROID_JAR:-/opt/andtools/android-all-34.jar}"
PUBLIC_JAR="${PUBLIC_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"

rm -rf "$OUT"; mkdir -p "$OUT"/{engine,overpass,api}
fail=0

echo "==================== 1/3  engine ===================="
# Pure-Java classes only: everything the routing logic needs, none of the
# Android plumbing around it.
ENGINE_SRC=$(find "$SRC/util" "$SRC/data" "$SRC/engine" -name '*.java' \
  | grep -vE "Ui.java|Icons.java|RailCache.java|RailRepository.java|OverpassClient.java|Alerts.java|LocationEngine.java|RouteEngine.java|JourneyHistoryStore.java")
javac -nowarn -d "$OUT/engine" $ENGINE_SRC "$ROOT/tools/EngineSim.java"
java -cp "$OUT/engine" EngineSim || fail=1

echo
echo "==================== 2/3  overpass ===================="
# android.util.JsonReader is pure Java, so the real reader runs here unmocked.
javac -nowarn -d "$OUT/overpass" -cp "$ANDROID_JAR" \
  "$SRC/util/Fmt.java" "$SRC/util/Geo.java" \
  "$SRC/data/Station.java" "$SRC/data/RailWay.java" "$SRC/data/OverpassClient.java" \
  "$ROOT/tools/OverpassTest.java" 2>&1 | grep -v "deprecat" || true
java -cp "$OUT/overpass:$ANDROID_JAR" com.trainjourney.live.data.OverpassTest || fail=1

echo
echo "==================== 3/3  api surface ===================="
if [ ! -d "$ROOT/build/classes" ]; then
  echo "  (no compiled classes yet - run ./build.sh first)"
else
  CLASSES=$(cd "$ROOT/build/classes" && find . -name '*.class' \
            | sed 's#^\./##; s#\.class$##; s#/#.#g')
  ( cd "$ROOT" && javap -p -c -cp build/classes $CLASSES ) > "$OUT/api/javap.txt" 2>/dev/null
  python3 "$ROOT/tools/extract_refs.py" "$OUT/api/javap.txt" "$OUT/api/refs.txt"
  javac -nowarn -d "$OUT/api" "$ROOT/tools/ApiCheck.java"
  java -cp "$OUT/api" ApiCheck "$PUBLIC_JAR" "$ROOT/build/classes" "$ANDROID_JAR" \
       "$OUT/api/refs.txt"
  echo
  echo "  Everything above the public API-23 line is expected and version-guarded:"
  echo "    NotificationChannel / createNotificationChannel / Notification.Builder(ctx,ch)"
  echo "    VibrationEffect / Vibrator.vibrate(effect) / startForegroundService  - API 26"
  echo "    Service.startForeground(id,n,type) / Insets                          - API 29"
  echo "    WindowInsets.getInsets / WindowInsets.Type                           - API 30"
  echo "    VibratorManager                                                      - API 31"
fi

echo
if [ "$fail" -eq 0 ]; then echo "ALL SUITES PASSED"; else echo "SOME SUITES FAILED"; exit 1; fi
