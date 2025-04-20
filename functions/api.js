// api.js (Netlify Function) - Versione migliorata
const { MongoClient } = require("mongodb");

// Impostazioni per MongoDB
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://username:password@cluster.mongodb.net/speedSystem";
const DB_NAME = "speedSystem";
const COLLECTION_NAME = "detections";
const MAX_RECORDS = 500; // Numero massimo di record da mantenere

// Cache per evitare connessioni ripetute
let cachedDb = null;
let client = null;

// Connessione al database con retry
async function connectToDatabase(retries = 3) {
  if (cachedDb) {
    return { db: cachedDb, client };
  }
  
  client = new MongoClient(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000 // Timeout ridotto per fallire più velocemente
  });
  
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    cachedDb = db;
    console.log("Successfully connected to MongoDB");
    return { db, client };
  } catch (error) {
    console.error(`Connection error (attempts left: ${retries}):`, error);
    
    if (retries > 0) {
      console.log(`Retrying connection in 1 second...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return connectToDatabase(retries - 1);
    }
    
    console.error("All connection attempts failed");
    return { db: null, client: null };
  }
}

// Pulizia dei vecchi record per rispettare il limite di storage
async function cleanupOldRecords(collection) {
  try {
    // Conta i record totali
    const count = await collection.countDocuments();
    
    // Se superiamo la soglia, elimina i record più vecchi
    if (count > MAX_RECORDS) {
      const recordsToDelete = count - MAX_RECORDS;
      const oldestRecords = await collection.find()
        .sort({ timestamp: 1 })
        .limit(recordsToDelete)
        .toArray();
      
      if (oldestRecords.length > 0) {
        const oldestIds = oldestRecords.map(r => r.id);
        await collection.deleteMany({ id: { $in: oldestIds } });
        console.log(`Deleted ${oldestRecords.length} old records to maintain storage limits`);
      }
    }
  } catch (error) {
    console.error("Error during cleanup:", error);
  }
}

// In-memory storage fallback
let logs = [];
let nextId = 1;

// Funzione per ottenere il prossimo ID da MongoDB
async function getNextId(collection) {
  try {
    const latestLog = await collection.find().sort({ id: -1 }).limit(1).toArray();
    return latestLog.length > 0 ? latestLog[0].id + 1 : 1;
  } catch (error) {
    console.error("Error getting next ID:", error);
    return nextId++;
  }
}

exports.handler = async (event, context) => {
  // Assicurati che la funzione termini correttamente
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
    // Connessione al database con gestione errori migliorata
    const { db, client: mongoClient } = await connectToDatabase();
    let collection = null;
    
    if (db) {
      collection = db.collection(COLLECTION_NAME);
    } else {
      console.warn("Using in-memory fallback due to database connection failure");
    }
    
    if (event.httpMethod === "POST") {
      const data = JSON.parse(event.body);
      
      if (!data.vehicleName || !data.speed || !data.excess) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing required fields" }),
        };
      }
      
      const logEntry = {
        id: collection ? await getNextId(collection) : nextId++,
        vehicleName: data.vehicleName,
        speed: data.speed,
        excess: data.excess,
        timestamp: new Date().toISOString(),
      };
      
      if (collection) {
        await collection.insertOne(logEntry);
        // Pulisci i vecchi record dopo l'inserimento
        await cleanupOldRecords(collection);
      } else {
        logs.push(logEntry);
        if (logs.length > 1000) {
          logs = logs.slice(-1000);
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
      
      if (collection) {
        // Query MongoDB per log con ID maggiore di "since"
        newLogs = await collection.find({ id: { $gt: since } })
          .sort({ id: 1 })
          .limit(100) // Limita il numero di risultati per prestazioni
          .toArray();
      } else {
        // Fallback: in-memory
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
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
      }),
    };
  }
};
