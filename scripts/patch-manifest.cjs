// Capacitor sync hook — CI/local build prep. Runs automatically via the
// "capacitor:sync:after" npm script (Capacitor CLI hooks). Idempotent.
// Three jobs, all patching the REGENERATED android/ project at the one
// honest moment (post-sync — `npx cap add android` rebuilds it fresh each
// CI run, so committed copies of these files would just drift):
//
// 1. Manifest: inject the location permissions the Yards screen needs.
//
// 2. Signing keystore: decode the repo's pinned debug keystore into the
//    android project. Without a pinned key, every GitHub Actions runner
//    invents a fresh debug key, consecutive builds sign differently, and
//    Android refuses the update ("package conflicts with another package"),
//    forcing an uninstall that wipes the user's inventory.
//    (A debug keystore in a public repo is deliberately not a secret — it
//    gates nothing but debug-build continuity. Play Store release signing,
//    when that day comes, uses a real private key.)
//
// 3. build.gradle: declare that keystore as the EXPLICIT debug signing
//    config — path, passwords, and type stated outright. Relying on the
//    ~/.android/debug.keystore convention proved silently unreliable on CI
//    runners (verified: two green runs produced two different auto-generated
//    certs). Explicit config either signs with our key or fails loudly.
const fs = require("fs");
const path = require("path");

const ANDROID = path.join(__dirname, "..", "android");

// ---- Job 1: manifest permissions ----
const MANIFEST = path.join(ANDROID, "app", "src", "main", "AndroidManifest.xml");
const PERMS = [
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
];

if (!fs.existsSync(MANIFEST)) {
  console.log("[build-prep] no android project yet — skipping (fine before `cap add android`)");
  process.exit(0);
}

let xml = fs.readFileSync(MANIFEST, "utf8");
const missing = PERMS.filter((p) => !xml.includes(p));
if (missing.length === 0) {
  console.log("[build-prep] location permissions already present");
} else {
  xml = xml.replace(/(<manifest[^>]*>)/, `$1\n    ${missing.join("\n    ")}`);
  fs.writeFileSync(MANIFEST, xml);
  console.log(`[build-prep] injected ${missing.length} location permission(s) for the Yards screen`);
}

// ---- Job 2: decode pinned keystore into the android project ----
const B64_PATH = path.join(__dirname, "debug-keystore.b64");
if (!fs.existsSync(B64_PATH)) {
  console.log("[build-prep] no pinned keystore in repo — debug signing will drift per machine");
  process.exit(0);
}
const KS_DEST = path.join(ANDROID, "app", "junkgenius-debug.keystore");
const bytes = Buffer.from(fs.readFileSync(B64_PATH, "utf8").replace(/\s+/g, ""), "base64");
if (fs.existsSync(KS_DEST) && fs.readFileSync(KS_DEST).equals(bytes)) {
  console.log("[build-prep] pinned keystore already in android project");
} else {
  fs.writeFileSync(KS_DEST, bytes);
  console.log(`[build-prep] pinned keystore -> android/app/junkgenius-debug.keystore (${bytes.length} bytes)`);
}

// ---- Job 3: explicit debug signingConfig in build.gradle ----
const GRADLE = path.join(ANDROID, "app", "build.gradle");
const MARK = "// junkgenius: pinned debug signing (added by scripts/patch-manifest.cjs)";
let gradle = fs.readFileSync(GRADLE, "utf8");
if (gradle.includes(MARK)) {
  console.log("[build-prep] explicit debug signingConfig already present");
} else {
  gradle += `

${MARK}
android {
    signingConfigs {
        debug {
            storeFile file('junkgenius-debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
            storeType 'PKCS12'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
    }
}
`;
  fs.writeFileSync(GRADLE, gradle);
  console.log("[build-prep] explicit debug signingConfig appended to build.gradle");
}
