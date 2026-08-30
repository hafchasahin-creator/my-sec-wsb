#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Train Journey Live - APK builder
#
# The normal route is Gradle + the Android Gradle Plugin (see build.gradle.kts,
# open the project in Android Studio and hit Run). This script exists so the app
# can also be built on a plain Linux box with no Android Studio and no access to
# Google's Maven repository: it drives aapt2 / javac / dx / zipalign / apksigner
# directly. Both routes produce the same APK.
#
#   ./build.sh              build a signed release APK -> dist/TrainJourneyLive.apk
#   ./build.sh clean        remove build output
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$ROOT/app/src/main"
OUT="$ROOT/build"
DIST="$ROOT/dist"

PKG="com.trainjourney.live"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0.0}"
MIN_SDK=24
TARGET_SDK=34

# --- tool discovery --------------------------------------------------------
ANDROID_JAR="${ANDROID_JAR:-/opt/andtools/android-all-34.jar}"
DX_JAR="${DX_JAR:-/opt/andtools/dalvik-dx.jar}"
AAPT2="${AAPT2:-$(command -v aapt2 || true)}"
ZIPALIGN="${ZIPALIGN:-$(command -v zipalign || true)}"
APKSIGNER="${APKSIGNER:-$(command -v apksigner || true)}"
KEYSTORE="${KEYSTORE:-$ROOT/keystore/trainjourney.jks}"
KS_PASS="${KS_PASS:-trainjourney}"
KEY_ALIAS="${KEY_ALIAS:-trainjourney}"

if [ "${1:-}" = "clean" ]; then rm -rf "$OUT" "$DIST"; echo "cleaned"; exit 0; fi

die() { echo "error: $*" >&2; exit 1; }
[ -n "$AAPT2" ]     || die "aapt2 not found (apt-get install aapt)"
[ -n "$ZIPALIGN" ]  || die "zipalign not found (apt-get install zipalign)"
[ -n "$APKSIGNER" ] || die "apksigner not found (apt-get install apksigner)"
[ -f "$ANDROID_JAR" ] || die "android platform jar not found at $ANDROID_JAR (set ANDROID_JAR)"
[ -f "$DX_JAR" ]      || die "dx not found at $DX_JAR (set DX_JAR)"

rm -rf "$OUT"; mkdir -p "$OUT"/{flat,gen,classes,apk} "$DIST"

# --- 0. launcher icons (regenerated from source, no binary blobs required) --
if [ ! -f "$APP/res/mipmap-mdpi/ic_launcher.png" ]; then
  echo "==> generating launcher icons"
  ( cd "$ROOT" && java tools/IconGen.java app/src/main/res >/dev/null )
fi

# --- 1. compile resources --------------------------------------------------
echo "==> aapt2 compile"
"$AAPT2" compile --dir "$APP/res" -o "$OUT/flat/resources.zip"

# --- 2. link resources + manifest, emit R.java -----------------------------
echo "==> aapt2 link"
LINK_ARGS=(
  -o "$OUT/apk/base.apk"
  --manifest "$APP/AndroidManifest.xml"
  -I "$ANDROID_JAR"
  --java "$OUT/gen"
  --min-sdk-version "$MIN_SDK"
  --target-sdk-version "$TARGET_SDK"
  --version-code "$VERSION_CODE"
  --version-name "$VERSION_NAME"
  --no-version-vectors
  "$OUT/flat/resources.zip"
)
[ -d "$APP/assets" ] && LINK_ARGS=(-A "$APP/assets" "${LINK_ARGS[@]}")
"$AAPT2" link "${LINK_ARGS[@]}"

# --- 3. compile Java -------------------------------------------------------
# dx cannot desugar invokedynamic, so the sources deliberately stay on Java 8
# *without* lambdas or method references. -source/-target 8 enforces the rest.
echo "==> javac"
find "$APP/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -nowarn -Xlint:-options -encoding UTF-8 \
      --release 8 -cp "$ANDROID_JAR" \
      -d "$OUT/classes" @"$OUT/sources.txt"

# --- 4. dex ----------------------------------------------------------------
echo "==> dx"
java -Xmx2g -cp "$DX_JAR" com.android.dx.command.Main \
     --dex --min-sdk-version="$MIN_SDK" --output="$OUT/apk/classes.dex" "$OUT/classes"

# --- 5. package ------------------------------------------------------------
echo "==> package"
cp "$OUT/apk/base.apk" "$OUT/apk/unsigned.apk"
( cd "$OUT/apk" && zip -q -X unsigned.apk classes.dex )
"$ZIPALIGN" -f -p 4 "$OUT/apk/unsigned.apk" "$OUT/apk/aligned.apk"

# --- 6. sign ---------------------------------------------------------------
if [ ! -f "$KEYSTORE" ]; then
  echo "==> generating signing key ($KEYSTORE)"
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=Train Journey Live, OU=Mobile, O=Train Journey Live, C=IN" >/dev/null 2>&1
fi
echo "==> apksigner"
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --ks-key-alias "$KEY_ALIAS" --min-sdk-version "$MIN_SDK" \
  --out "$DIST/TrainJourneyLive.apk" "$OUT/apk/aligned.apk"
rm -f "$DIST/TrainJourneyLive.apk.idsig"

"$APKSIGNER" verify --min-sdk-version "$MIN_SDK" "$DIST/TrainJourneyLive.apk" >/dev/null
echo
echo "BUILD OK -> $DIST/TrainJourneyLive.apk  ($(du -h "$DIST/TrainJourneyLive.apk" | cut -f1))"
"$AAPT2" dump badging "$DIST/TrainJourneyLive.apk" | head -4
