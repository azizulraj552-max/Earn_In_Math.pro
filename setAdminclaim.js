const path = require("path");
const admin = require("firebase-admin");

const uid = process.argv[2];
if (!uid) {
  console.log("Usage: node setAdminClaim.js <UID>");
  process.exit(1);
}

const serviceAccount = require(path.resolve(__dirname, "./serviceAccountKey.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://earninmath-default-rtdb.firebaseio.com"
});

(async () => {
  try {
    await admin.auth().setCustomUserClaims(uid, { admin: true, superadmin: true });
    console.log(`✅ Admin + SuperAdmin claim set for UID: ${uid}`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Failed:", error);
    process.exit(1);
  }
})();