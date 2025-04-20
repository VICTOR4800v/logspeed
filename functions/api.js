let admin;
if (!global._firebaseAdminInitialized) {
  admin = require("firebase-admin");
  global._firebaseAdminInitialized = true;
} else {
  admin = require("firebase-admin");
}

let firebaseConfig;
if (process.env.FIREBASE_CONFIG) {
  firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
} else {
  console.warn("FIREBASE_CONFIG not found, using empty config");
  firebaseConfig = {};
}

let db = null;
function initializeFirebase() {
  if (!db) {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(firebaseConfig)
      });
    }
    db = admin.firestore();
  }
  return db;
}

let logs = [];
let nextId = 1;

async function getNextId(db) {
  try {
    const snapshot = await db.collection("detections")
      .orderBy("id", "desc")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return 1;
    } else {
      return snapshot.docs[0].data().id + 1;
    }
  } catch (error) {
    console.error("Error getting next ID:", error);
    return nextId++;
  }
}

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers,
    };
  }

  try {
    const firestore = initializeFirebase();

    if (event.httpMethod === "POST") {
      const data = JSON.parse(event.body);

      if (!data.vehicleName || !data.speed || !data.excess) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing required fields" }),
        };
      }

      const newId = await getNextId(firestore);
      const logEntry = {
        id: newId,
        vehicleName: data.vehicleName,
        speed: data.speed,
        excess: data.excess,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };

      await firestore.collection("detections").add(logEntry);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, id: newId }),
      };
    }

    if (event.httpMethod === "GET") {
      const since = parseInt(event.queryStringParameters?.since || 0, 10);
      const collection = firestore.collection("detections");

      let query = collection.orderBy("id", "desc").limit(20);

      if (since > 0) {
        query = collection.where("id", ">", since).orderBy("id", "asc").limit(100);
      }

      const snapshot = await query.get();
      const newLogs = snapshot.docs.map(doc => {
        const data = doc.data();
        if (data.timestamp?.toDate) {
          data.timestamp = data.timestamp.toDate().toISOString();
        }
        return data;
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(newLogs),
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  } catch (error) {
    console.error("Handler error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Internal server error",
        message: error.message
      }),
    };
  }
};
