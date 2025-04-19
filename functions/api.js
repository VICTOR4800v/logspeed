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
    useUnifiedTopology: true
  });
  
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    cachedDb = db;
    return db;
  } catch (error) {
    console.error("Error connecting to database:", error);
    // Fallback to in-memory if MongoDB fails
    return null;
  }
}

// In-memory storage fallback
let logs = [];
let nextId = 1;

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  
  // Handle preflight request
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers
    };
  }
  
  // Try to connect to MongoDB
  const db = await connectToDatabase();
  let collection = null;
  
  if (db) {
    collection = db.collection(COLLECTION_NAME);
  }
  
  try {
    // POST request from Roblox
    if (event.httpMethod === "POST") {
      const data = JSON.parse(event.body);

      // Basic validation
      if (!data.vehicleName || !data.speed || !data.excess) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing required fields" })
        };
      }

      // Create log entry
      const logEntry = {
        id: collection ? await getNextId(collection) : nextId++,
        vehicleName: data.vehicleName,
        speed: data.speed,
        excess: data.excess,
        timestamp: new Date().toISOString()
      };

      // Store log
      if (collection) {
        await collection.insertOne(logEntry);
      } else {
        // Fallback to in-memory
        logs.push(logEntry);
        // Keep only latest 1000 logs to prevent memory issues
        if (logs.length > 1000) {
          logs = logs.slice(-1000);
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, id: logEntry.id })
      };
    }

    // GET request from frontend
    if (event.httpMethod === "GET") {
      const since = parseInt(event.queryStringParameters?.since || 0);

      let newLogs = [];
      
      if (collection) {
        // Query MongoDB
        newL
