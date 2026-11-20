#!/usr/bin/env bash
# Build the Makon Android app (signed APK) from ../frontend.
#   ./build.sh https://makon-xxxx.onrender.com
# The APK carries the whole app, so it opens without internet; data syncs with that server.
set -euo pipefail
cd "$(dirname "$0")"
API_URL="${1:-${MAKON_API_URL:-}}"
[ -n "$API_URL" ] || { echo "usage: ./build.sh https://your-server"; exit 1; }
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$PATH"

# 1. web files (no service worker: the app ships its own files)
rm -rf www && mkdir www
rsync -a --exclude sw.js --exclude download --exclude privacy.html ../frontend/ www/
python3 - "$API_URL" <<'PY'
import pathlib, sys
url = sys.argv[1].rstrip('/')
p = pathlib.Path('www/index.html')
s = p.read_text(encoding='utf-8')
s = s.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n  <meta name="makon-api" content="{url}">', 1)
p.write_text(s, encoding='utf-8')
PY

# 2. Android project
[ -d android ] || npx cap add android
npx cap sync android

# 3. signing key: created once, kept in keys/ (NOT in git). Updates must be signed with the same key.
mkdir -p keys
if [ ! -f keys/makon.jks ]; then
  PASS="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
  "$JAVA_HOME/bin/keytool" -genkeypair -v -keystore keys/makon.jks -alias makon -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" -dname "CN=Makon, O=Makon, C=UZ" >/dev/null 2>&1
  printf 'storePassword=%s\nkeyPassword=%s\nkeyAlias=makon\n' "$PASS" "$PASS" > keys/keystore.properties
fi
PASS="$(grep storePassword keys/keystore.properties | cut -d= -f2-)"

# 4. build (Gradle signs with v1+v2+v3 using keys/keystore.properties, see android/app/build.gradle)
VERSION_CODE="${VERSION_CODE:-$(date +%y%m%d%H)}"
sed -i '' -E "s/versionCode [0-9]+/versionCode ${VERSION_CODE}/" android/app/build.gradle
(cd android && ./gradlew --quiet assembleRelease)
APK=android/app/build/outputs/apk/release/app-release.apk
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify "$APK"
mkdir -p ../frontend/download
cp "$APK" ../frontend/download/makon.apk
cp "$APK" ./Makon.apk
echo "APK: $PWD/Makon.apk"
