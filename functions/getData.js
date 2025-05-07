const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();

exports.handler = async function(event, context) {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      body: "Metodo non consentito"
    };
  }

  try {
    const snapshot = await db.collection("speedReports").orderBy("timestamp", "desc").limit(10).get();
    const data = snapshot.docs.map(doc => doc.data());

    return {
      statusCode: 200,
      body: JSON.stringify(data)
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
