#!/bin/bash
# Build a signed, installable VeerPath APK without Gradle/AGP.
#
# Pipeline: kotlinc -> D8 (dex) -> aapt2 compile/link -> add dex+assets
#           -> zipalign -> apksigner (v1+v2+v3)
#
# Requires: JDK 17+, aapt2, zipalign, apksigner, and the jars listed in TC.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="${VEER_TOOLCHAIN:-/opt/veer-toolchain}"
ANDROID_JAR="${VEER_ANDROID_JAR:-$TC/android-all-14.jar}"
OUT="$ROOT/build"
APP="$ROOT/app/src/main"
DIST="$ROOT/dist"
APK_NAME="${APK_NAME:-VeerPath-1.0.apk}"
MIN_SDK=26
TARGET_SDK=34

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex" "$OUT/res" "$DIST"

echo "==> [1/6] Kotlin compile"
KOTLINC="${VEER_KOTLINC:-$TC/kotlinc/bin/kotlinc}"
JAVA_OPTS="-Xmx2g" "$KOTLINC" \
  -cp "$ANDROID_JAR" -d "$OUT/classes" -jvm-target 17 \
  -Werror -nowarn \
  $(find "$APP/java" -name '*.kt') 2>&1 | grep -vE "^(Picked up|warning:)" || true
if [ ! -d "$OUT/classes/com" ]; then echo "FATAL: kotlin compile produced no classes"; exit 1; fi

echo "==> [2/6] D8 dex"
java -Xmx2g -cp "$TC/r8lib.jar" com.android.tools.r8.D8 \
  --release --min-api $MIN_SDK --lib "$ANDROID_JAR" \
  --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class') "$TC/kotlin-stdlib.jar"

echo "==> [3/6] aapt2 compile resources"
# this aapt2 wants the whole res/ tree in a single --dir invocation
aapt2 compile --dir "$APP/res" -o "$OUT/res/resources.zip"
if [ "$(unzip -l "$OUT/res/resources.zip" | tail -1 | awk '{print $2}')" = "0" ]; then
  echo "FATAL: resource compilation produced nothing"; exit 1
fi

echo "==> [4/6] aapt2 link"
aapt2 link \
  -o "$OUT/base.apk" \
  --manifest "$APP/AndroidManifest.xml" \
  -I "$ANDROID_JAR" \
  --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK \
  --version-code 1 --version-name 1.0 \
  --no-version-vectors \
  -A "$APP/assets" \
  $(ls "$OUT"/res/*.zip)

echo "==> [5/6] package dex + align"
cd "$OUT"
cp base.apk unaligned.apk
(cd dex && zip -q -X "$OUT/unaligned.apk" classes*.dex)
zipalign -f -p 4 unaligned.apk aligned.apk

echo "==> [6/6] sign"
KS="$ROOT/tools/veerpath-release.keystore"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -v -keystore "$KS" -alias veerpath \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass veerpath -keypass veerpath \
    -dname "CN=VeerPath, OU=Games, O=VeerGames, L=, S=, C=US" >/dev/null 2>&1
fi
apksigner sign --ks "$KS" --ks-pass pass:veerpath --key-pass pass:veerpath \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$DIST/$APK_NAME" aligned.apk
apksigner verify --verbose "$DIST/$APK_NAME" | head -5

echo
echo "APK: $DIST/$APK_NAME  ($(du -h "$DIST/$APK_NAME" | cut -f1))"
