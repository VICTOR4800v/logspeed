const admin = require("firebase-admin");

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

async function cleanupOldRecords(db) {
  try {
    const collectionRef = db.collection("detections");
    const countSnapshot = await collectionRef.count().get();
    const count = countSnapshot.data().count;

    if (count > 500) {
      const toDelete = count - 500;
      const oldRecords = await collectionRef
        .orderBy("timestamp")
        .limit(toDelete)
        .get();

      const batch = db.batch();
      oldRecords.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      console.log(`Deleted ${oldRecords.size} old records`);
    }
  } catch (error) {
    console.error("Cleanup error:", error);
  }
}

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // CORS preflight
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
      await cleanupOldRecords(firestore);

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
// api.js (Netlify Function) con Firebase
const admin = require("firebase-admin");

// Assicurati di aggiungere queste variabili nelle impostazioni di Netlify
// O in un file .env locale per lo sviluppo
let firebaseConfig;
if (process.env.FIREBASE_CONFIG) {
  firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
} else {
  console.warn("FIREBASE_CONFIG not found, using empty config");
  firebaseConfig = {};
}

// Inizializza Firebase solo una volta
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

// In-memory fallback
let logs = [];
let nextId = 1;

// Funzione per ottenere il prossimo ID
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

// Pulizia dati vecchi (mantiene ultimi 500 record)
async function cleanupOldRecords(db) {
  try {
    const collectionRef = db.collection("detections");
    const countSnapshot = await collectionRef.count().get();
    const count = countSnapshot.data().count;
    
    if (count > 500) {
      const toDelete = count - 500;
      const oldRecords = await collectionRef
        .orderBy("timestamp")
        .limit(toDelete)
        .get();
      
      const batch = db.batch();
      oldRecords.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      console.log(`Deleted ${oldRecords.size} old records`);
    }
  } catch (error) {
    console.error("Cleanup error:", error);
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
  let newLogs = [];

if (firestore) {
  const collection = firestore.collection("detections");

  let query = collection.orderBy("id", "desc").limit(20); // default ultimi 20

  const since = parseInt(event.queryStringParameters?.since || 0, 10);
  if (since > 0) {
    query = collection.where("id", ">", since).orderBy("id", "asc").limit(100);
  }

  const snapshot = await query.get();
  newLogs = snapshot.docs.map(doc => {
    const data = doc.data();
    if (data.timestamp?.toDate) {
      data.timestamp = data.timestamp.toDate().toISOString();
    }
    return data;
  });
}


  try {
    // Inizializza Firebase
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
      
      let logEntry;
      
      if (firestore) {
        const newId = await getNextId(firestore);
        logEntry = {
          id: newId,
          vehicleName: data.vehicleName,
          speed: data.speed,
          excess: data.excess,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        };
        
        await firestore.collection("detections").add(logEntry);
        await cleanupOldRecords(firestore);
      } else {
        logEntry = {
          id: nextId++,
          vehicleName: data.vehicleName,
          speed: data.speed,
          excess: data.excess,
          timestamp: new Date().toISOString(),
        };
        logs.push(logEntry);
        if (logs.length > 500) {
          logs = logs.slice(-500);
        }
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, id: logEntry.id }),
      };
    }
    
    if (event.httpMethod === "GET") {
      const since = parseInt(event.queryStringParameters?.since || 0, 10);
      let newLogs = [];
      
      if (firestore) {
        const snapshot = await firestore.collection("detections")
          .where("id", ">", since)
          .orderBy("id", "asc")
          .limit(100)
          .get();
        
        newLogs = snapshot.docs.map(doc => {
          const data = doc.data();
          // Converte Timestamp in ISO string per compatibilità
          if (data.timestamp && typeof data.timestamp.toDate === 'function') {
            data.timestamp = data.timestamp.toDate().toISOString();
          }
          return data;
        });
      } else {
        newLogs = logs.filter(log => log.id > since);
      }
      
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
