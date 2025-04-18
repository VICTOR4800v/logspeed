// api.js (Netlify Function)
const { MongoClient } = require("mongodb");
// For free database, we can use MongoDB Atlas free tier
// Or for simpler solution, we could use something like JSONBin.io or a flat file

// In-memory storage (for simple testing without DB)
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
        id: nextId++,
        vehicleName: data.vehicleName,
        speed: data.speed,
        excess: data.excess,
        timestamp: new Date().toISOString()
      };
      
      // Store log (in-memory for this example)
      logs.push(logEntry);
      
      // Keep only latest 100 logs to prevent memory issues
      if (logs.length > 100) {
        logs = logs.slice(-100);
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
      
      // Return logs newer than the specified ID
      const newLogs = logs.filter(log => log.id > since);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(newLogs)
      };
    }
    
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
