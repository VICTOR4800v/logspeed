// api.js (Netlify Function)
const { MongoClient } = require("mongodb");

// Impostazioni per MongoDB
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://username:password@cluster.mongodb.net/speedSystem";
const DB_NAME = "speedSystem";
const COLLECTION_NAME = "detections";

// Cache per evitare connessioni ripetute
let cachedDb = null;

// Connessione al database
async function connectToDatabase() {
  if (cachedDb) {
    return cachedDb;
  }

  const client = new MongoClient(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    cachedDb = db;
    return db;
  } catch (error) {
    console.error("Error connecting to database:", error);
    return null;
  }
}

// In-memory storage fallback
let logs = [];
let nextId = 1;

// Funzione per ottenere il prossimo ID da MongoDB
async function getNextId(collection) {
  const latestLog = await collection.find().sort({ id: -1 }).limit(1).toArray();
  return latestLog.length > 0 ? latestLog[0].id + 1 : 1;
}

exports.handler = async (event, context) => {
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

  const db = await connectToDatabase();
  let collection = null;

  if (db) {
    collection = db.collection(COLLECTION_NAME);
  }

  try {
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
        newLogs = await collection.find({ id: { $gt: since } }).sort({ id: 1 }).toArray();
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
    console.error(error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
