// Capacitor sync hook — injects the location permissions the Yards screen
// needs into the generated AndroidManifest. Runs automatically via the
// "capacitor:sync:after" npm script (Capacitor CLI hooks), so it works the
// same in CI and locally with zero extra steps. Idempotent.
//
// Why not commit the manifest? `npx cap add android` regenerates it fresh on
// every CI run, so a committed copy would just drift. Patching post-sync is
// the one honest, always-correct moment.
const fs = require("fs");
const path = require("path");

const MANIFEST = path.join(__dirname, "..", "android", "app", "src", "main", "AndroidManifest.xml");
const PERMS = [
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
];

if (!fs.existsSync(MANIFEST)) {
  console.log("[patch-manifest] no android project yet — skipping (fine before `cap add android`)");
  process.exit(0);
}

let xml = fs.readFileSync(MANIFEST, "utf8");
const missing = PERMS.filter((p) => !xml.includes(p));
if (missing.length === 0) {
  console.log("[patch-manifest] location permissions already present");
  process.exit(0);
}

xml = xml.replace(/(<manifest[^>]*>)/, `$1\n    ${missing.join("\n    ")}`);
fs.writeFileSync(MANIFEST, xml);
console.log(`[patch-manifest] injected ${missing.length} location permission(s) for the Yards screen`);
