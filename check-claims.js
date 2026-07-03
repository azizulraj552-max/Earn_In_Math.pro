const path = require("path");
const admin = require("firebase-admin");

const uid = process.argv[2];
if (!uid) {
  console.log("Usage: npm run check-claims -- <UID>");
  process.exit(1);
}

const serviceAccount = require(path.resolve(__dirname, "../serviceAccountKey.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://earninmath-default-rtdb.firebaseio.com"
});

(async () => {
  try {
    const user = await admin.auth().getUser(uid);
    console.log("✅ UID:", user.uid);
    console.log("✅ Email:", user.email || "-");
    console.log("✅ Custom Claims:", user.customClaims || {});
    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to fetch claims:", error);
    process.exit(1);
  }
})();