#!/bin/bash
# Compile and run the pure-JVM core test suite (no emulator required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="${VEER_TOOLCHAIN:-/opt/veer-toolchain}"
KOTLINC="${VEER_KOTLINC:-$TC/kotlinc/bin/kotlinc}"
OUT="$ROOT/build/test"

rm -rf "$OUT"; mkdir -p "$OUT"
echo "==> compiling core + tests"
TC_JAR="${VEER_ANDROID_JAR:-$TC/android-all-14.jar}"
# the whole app is type-checked here, not just the core, so a rendering-layer
# break shows up in the test gate instead of at packaging time
JAVA_OPTS="-Xmx2g" "$KOTLINC" -d "$OUT" -jvm-target 17 -nowarn -cp "$TC_JAR" \
  $(find "$ROOT/app/src/main/java" -name '*.kt') \
  "$ROOT/app/src/test/java/com/veergames/veer/"*.kt 2>&1 | grep -vE "^(Picked up|warning:)" || true

echo "==> running"
java -cp "$OUT:$TC/kotlin-stdlib.jar" com.veergames.veer.CoreTests
