// Capacitor sync hook — CI/local build prep. Runs automatically via the
// "capacitor:sync:after" npm script (Capacitor CLI hooks), so it works the
// same in CI and locally with zero extra steps. Idempotent. Two jobs:
//
// 1. Inject the location permissions the Yards screen needs into the
//    generated AndroidManifest. (Why not commit the manifest? `npx cap add
//    android` regenerates it fresh on every CI run, so a committed copy
//    would just drift. Patching post-sync is the one honest moment.)
//
// 2. Install the repo's PINNED debug keystore to ~/.android/debug.keystore.
//    Without this, every GitHub Actions runner invents a fresh debug key,
//    so consecutive builds sign differently and Android refuses to update
//    ("package conflicts with another package"), forcing an uninstall that
//    wipes the user's inventory. One committed keystore = every build signs
//    identically = updates install over the top forever.
//    (A debug keystore in a public repo is not treated as a secret by
//    design — it gates nothing but debug-build continuity. Play Store
//    release signing, when that day comes, uses a real private key.)
const fs = require("fs");
const os = require("os");
const path = require("path");

// ---- Job 1: manifest permissions ----
const MANIFEST = path.join(__dirname, "..", "android", "app", "src", "main", "AndroidManifest.xml");
const PERMS = [
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
];

if (!fs.existsSync(MANIFEST)) {
  console.log("[build-prep] no android project yet — skipping manifest patch");
} else {
  let xml = fs.readFileSync(MANIFEST, "utf8");
  const missing = PERMS.filter((p) => !xml.includes(p));
  if (missing.length === 0) {
    console.log("[build-prep] location permissions already present");
  } else {
    xml = xml.replace(/(<manifest[^>]*>)/, `$1\n    ${missing.join("\n    ")}`);
    fs.writeFileSync(MANIFEST, xml);
    console.log(`[build-prep] injected ${missing.length} location permission(s) for the Yards screen`);
  }
}

// ---- Job 2: pinned debug signing keystore ----
const B64_PATH = path.join(__dirname, "debug-keystore.b64");
if (!fs.existsSync(B64_PATH)) {
  console.log("[build-prep] no pinned keystore in repo — gradle will use the machine default");
} else {
  const dest = path.join(os.homedir(), ".android", "debug.keystore");
  const bytes = Buffer.from(fs.readFileSync(B64_PATH, "utf8").replace(/\s+/g, ""), "base64");
  const already = fs.existsSync(dest) && fs.readFileSync(dest).equals(bytes);
  if (already) {
    console.log("[build-prep] pinned debug keystore already installed");
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
    console.log(`[build-prep] pinned debug keystore installed -> ${dest} (${bytes.length} bytes)`);
  }
}
