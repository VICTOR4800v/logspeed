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
let speedLogs = [];
let tyreLogs = [];
let nextSpeedId = 1;
let nextTyreId = 1;

// Funzione per ottenere il prossimo ID per una collezione specifica
async function getNextId(db, collection) {
  try {
    const snapshot = await db.collection(collection)
      .orderBy("id", "desc")
      .limit(1)
      .get();
    
    if (snapshot.empty) {
      return 1;
    } else {
      return snapshot.docs[0].data().id + 1;
    }
  } catch (error) {
    console.error(`Error getting next ID for ${collection}:`, error);
    return collection === "speed_detections" ? nextSpeedId++ : nextTyreId++;
  }
}

// Pulizia dati vecchi (mantiene ultimi 500 record per ogni collezione)
async function cleanupOldRecords(db, collection) {
  try {
    const collectionRef = db.collection(collection);
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
      console.log(`Deleted ${oldRecords.size} old records from ${collection}`);
    }
  } catch (error) {
    console.error(`Cleanup error for ${collection}:`, error);
  }
}

// Gestione delle rilevazioni di velocità
async function handleSpeedDetection(data, firestore) {
  // Valida i dati richiesti per le rilevazioni di velocità
  if (!data.vehicleName || data.speed === undefined || data.excess === undefined) {
    return {
      success: false,
      error: "Missing required fields for speed detection"
    };
  }
  
  let logEntry;
  
  if (firestore) {
    const newId = await getNextId(firestore, "speed_detections");
    logEntry = {
      id: newId,
      vehicleName: data.vehicleName,
      speed: data.speed,
      excess: data.excess,
      zone: data.zone || "Non specificata",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      type: "speed"
    };
    
    await firestore.collection("speed_detections").add(logEntry);
    await cleanupOldRecords(firestore, "speed_detections");
  } else {
    logEntry = {
      id: nextSpeedId++,
      vehicleName: data.vehicleName,
      speed: data.speed,
      excess: data.excess,
      zone: data.zone || "Non specificata",
      timestamp: new Date().toISOString(),
      type: "speed"
    };
    speedLogs.push(logEntry);
    if (speedLogs.length > 500) {
      speedLogs = speedLogs.slice(-500);
    }
  }
  
  return {
    success: true,
    id: logEntry.id
  };
}

// Gestione dei cambi gomme
async function handleTyreChange(data, firestore) {
  // Valida i dati richiesti per i cambi gomme
  if (!data.vehicleName || !data.tyreType) {
    return {
      success: false,
      error: "Missing required fields for tyre change"
    };
  }
  
  let logEntry;
  
  if (firestore) {
    const newId = await getNextId(firestore, "tyre_changes");
    logEntry = {
      id: newId,
      vehicleName: data.vehicleName,
      tyreType: data.tyreType,
      box: data.zone, // Manteniamo zone ma concettualmente è un box
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      type: "tyre"
    };
    
    await firestore.collection("tyre_changes").add(logEntry);
    await cleanupOldRecords(firestore, "tyre_changes");
  } else {
    logEntry = {
      id: nextTyreId++,
      vehicleName: data.vehicleName,
      tyreType: data.tyreType,
      box: data.zone,
      timestamp: new Date().toISOString(),
      type: "tyre"
    };
    tyreLogs.push(logEntry);
    if (tyreLogs.length > 500) {
      tyreLogs = tyreLogs.slice(-500);
    }
  }
  
  return {
    success: true,
    id: logEntry.id
  };
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
    // Inizializza Firebase
    const firestore = initializeFirebase();
    
    if (event.httpMethod === "POST") {
      const data = JSON.parse(event.body);
      let result;
      
      // Determina il tipo di richiesta in base ai campi presenti nei dati
      if (data.speed !== undefined && data.excess !== undefined) {
        // È una rilevazione di velocità dal primo script
        result = await handleSpeedDetection(data, firestore);
      } else if (data.tyreType !== undefined) {
        // È un cambio gomme dal secondo script
        result = await handleTyreChange(data, firestore);
      } else {
        // Nessuno dei due tipi riconosciuti
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: "Invalid data format - couldn't determine request type" 
          }),
        };
      }
      
      if (result.success) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, id: result.id }),
        };
      } else {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: result.error }),
        };
      }
    }
    
    if (event.httpMethod === "GET") {
      const since = parseInt(event.queryStringParameters?.since || 0, 10);
      const type = event.queryStringParameters?.type; // speed, tyre, o undefined (entrambi)
      let newLogs = [];
      
      if (firestore) {
        // Recupera dati in base al tipo richiesto
        if (!type || type === "speed") {
          const speedSnapshot = await firestore.collection("speed_detections")
            .where("id", ">", since)
            .orderBy("id", "asc")
            .limit(100)
            .get();
          
          const speedData = speedSnapshot.docs.map(doc => {
            const data = doc.data();
            // Converte Timestamp in ISO string per compatibilità
            if (data.timestamp && typeof data.timestamp.toDate === 'function') {
              data.timestamp = data.timestamp.toDate().toISOString();
            }
            return data;
          });
          
          newLogs = [...newLogs, ...speedData];
        }
        
        if (!type || type === "tyre") {
          const tyreSnapshot = await firestore.collection("tyre_changes")
            .where("id", ">", since)
            .orderBy("id", "asc")
            .limit(100)
            .get();
          
          const tyreData = tyreSnapshot.docs.map(doc => {
            const data = doc.data();
            // Converte Timestamp in ISO string per compatibilità
            if (data.timestamp && typeof data.timestamp.toDate === 'function') {
              data.timestamp = data.timestamp.toDate().toISOString();
            }
            return data;
          });
          
          newLogs = [...newLogs, ...tyreData];
        }
        
        // Ordina tutti i log per timestamp se ci sono entrambi i tipi
        if (!type) {
          newLogs.sort((a, b) => {
            return new Date(a.timestamp) - new Date(b.timestamp);
          });
        }
      } else {
        // Versione in-memory
        if (!type || type === "speed") {
          newLogs = [...newLogs, ...speedLogs.filter(log => log.id > since)];
        }
        if (!type || type === "tyre") {
          newLogs = [...newLogs, ...tyreLogs.filter(log => log.id > since)];
        }
        
        // Ordina per timestamp se ci sono entrambi i tipi
        if (!type) {
          newLogs.sort((a, b) => {
            return new Date(a.timestamp) - new Date(b.timestamp);
          });
        }
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
