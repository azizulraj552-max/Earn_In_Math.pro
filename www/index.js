const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.database();

// ============================================
// 🔐 AUTH MIDDLEWARE
// ============================================
function assertAuth(context) {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }
}

function assertAdmin(context) {
  assertAuth(context);
  if (context.auth.token.admin !== true && context.auth.token.superadmin !== true) {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }
}

// ============================================
// 🛠 UTILITY FUNCTIONS
// ============================================
async function writeAuditLog(type, requestId, data, actorUid) {
  try {
    await db.ref("auditLogs").push({
      type,
      requestId: requestId || null,
      uid: data?.uid || null,
      actorUid: actorUid || null,
      amount: data?.amount ?? null,
      method: data?.method || null,
      timestamp: admin.database.ServerValue.TIMESTAMP
    });
  } catch(e) {
    console.error("Audit log error:", e);
  }
}

// ============================================
// 🔐 SECURE: Validate Points
// ============================================
exports.validatePoints = functions.https.onCall(async (data, context) => {
  try {
    assertAuth(context);
    
    const { uid, points } = data;
    if (!uid || points === undefined) {
      throw new functions.https.HttpsError("invalid-argument", "Missing parameters");
    }

    // Check if user exists
    const userSnap = await db.ref(`users/${uid}`).once("value");
    if (!userSnap.exists()) {
      return { valid: false, error: "User not found" };
    }

    const userData = userSnap.val();
    const currentPoints = userData.points || 0;
    
    // Check if points are reasonable (anti-cheat)
    const maxPointsPerDay = 500;
    const pointsDiff = points - currentPoints;
    
    if (pointsDiff > maxPointsPerDay) {
      await writeAuditLog("suspicious_points", null, { 
        uid, 
        amount: pointsDiff, 
        method: "validation" 
      }, context.auth.uid);
      return { valid: false, error: "Points exceeded daily limit" };
    }

    return { valid: true };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError("internal", error.message);
  }
});

// ============================================
// 💳 WITHDRAW APPROVAL
// ============================================
async function updateWithdrawStatus(requestId, status, context) {
  const snap = await db.ref(`requests/${requestId}`).once("value");
  if (!snap.exists()) {
    throw new functions.https.HttpsError("not-found", "Request not found");
  }

  const req = snap.val() || {};
  const updates = {
    [`requests/${requestId}/status`]: status,
    [`requests/${requestId}/updatedAt`]: admin.database.ServerValue.TIMESTAMP
  };

  if (req.uid) {
    updates[`users/${req.uid}/withdrawStatus`] = status;
    updates[`users/${req.uid}/withdrawUpdatedAt`] = admin.database.ServerValue.TIMESTAMP;
  }

  await db.ref().update(updates);
  await writeAuditLog(status === "approved" ? "withdraw_approved" : "withdraw_rejected", 
    requestId, req, context.auth.uid);
  
  return { success: true, requestId, status };
}

exports.approveWithdraw = functions.https.onCall(async (data, context) => {
  try {
    assertAdmin(context);
    const requestId = data && data.requestId;
    if (!requestId || typeof requestId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "requestId required");
    }
    return await updateWithdrawStatus(requestId, "approved", context);
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError("internal", error.message || "Approve failed");
  }
});

exports.rejectWithdraw = functions.https.onCall(async (data, context) => {
  try {
    assertAdmin(context);
    const requestId = data && data.requestId;
    if (!requestId || typeof requestId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "requestId required");
    }
    return await updateWithdrawStatus(requestId, "rejected", context);
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError("internal", error.message || "Reject failed");
  }
});

// ============================================
// 👥 REFERRAL SYSTEM
// ============================================
exports.creditReferralBonus = functions.https.onCall(async (data, context) => {
  try {
    assertAuth(context);

    const ownerUid = data && data.ownerUid;
    if (!ownerUid || typeof ownerUid !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "ownerUid required");
    }

    if (ownerUid === context.auth.uid) {
      throw new functions.https.HttpsError("failed-precondition", "Self referral not allowed");
    }

    const ownerSnap = await db.ref(`users/${ownerUid}`).once("value");
    if (!ownerSnap.exists()) {
      throw new functions.https.HttpsError("not-found", "Owner not found");
    }

    const owner = ownerSnap.val() || {};
    const newPoints = (owner.points || 0) + 100;
    const newCount = (owner.successfulReferrals || 0) + 1;

    await db.ref().update({
      [`users/${ownerUid}/points`]: newPoints,
      [`users/${ownerUid}/successfulReferrals`]: newCount
    });

    await writeAuditLog("referral_bonus", null, 
      { uid: ownerUid, amount: 100, method: "referral" }, 
      context.auth.uid
    );

    return { success: true, ownerUid, bonus: 100, points: newPoints, successfulReferrals: newCount };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError("internal", error.message || "Referral bonus failed");
  }
});

// ============================================
// 👑 ADMIN CLAIM MANAGEMENT
// ============================================
async function mergeCustomClaims(uid, extraClaims) {
  const user = await admin.auth().getUser(uid);
  const oldClaims = user.customClaims || {};
  const nextClaims = { ...oldClaims, ...extraClaims };
  await admin.auth().setCustomUserClaims(uid, nextClaims);
  return nextClaims;
}

exports.bootstrapSuperAdmin = functions.https.onCall(async (data, context) => {
  try {
    assertAuth(context);
    const code = data && data.code;
    const targetUid = data && data.uid;
    
    if (code !== "BOOTSTRAP_2026_SUPERADMIN") {
      throw new functions.https.HttpsError("permission-denied", "Invalid bootstrap code");
    }
    if (!targetUid || typeof targetUid !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "uid required");
    }
    
    const targetUser = await admin.auth().getUser(targetUid);
    const claims = await mergeCustomClaims(targetUid, {
      superadmin: true,
      admin: true
    });
    
    return { success: true, uid: targetUid, claims };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError("internal", error.message || "Bootstrap failed");
  }
});

exports.setAdminClaim = functions.https.onCall(async (data, context) => {
  try {
    assertAdmin(context);
    const uid = data && data.uid;
    if (!uid || typeof uid !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "uid required");
    }
    const claims = await mergeCustomClaims(uid, { admin: true });
    return { success: true, uid, claims };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError("internal", error.message || "Failed to set admin claim");
  }
});

exports.removeAdminClaim = functions.https.onCall(async (data, context) => {
  try {
    assertAdmin(context);
    const uid = data && data.uid;
    if (!uid || typeof uid !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "uid required");
    }
    const user = await admin.auth().getUser(uid);
    const oldClaims = user.customClaims || {};
    const { admin: _admin, ...rest } = oldClaims;
    await admin.auth().setCustomUserClaims(uid, rest);
    return { success: true, uid, claims: rest };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError("internal", error.message || "Failed to remove admin claim");
  }
});