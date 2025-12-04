// server/index.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fetch = require("node-fetch"); // v2

const https = require("https");
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

const app = express();
app.use(cors());

const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:3000",
  "https://aj-talk.vercel.app",
];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct";

//using OpenRouter
async function getAiReply(userText, mode = "free") {
  if (!OPENROUTER_API_KEY) {
    console.error("No OPENROUTER API key configured");
    return "AI config error (no API key)";
  }

  const systemPrompt =
    mode === "practice"
      ? "You are a strict but encouraging English speaking practice teacher. You lead the conversation. Always: 1) Briefly correct the user's last sentence if needed. 2) Give a very short explanation (1–2 lines). 3) Ask ONE simple follow-up question in English to keep the conversation going. Keep your whole reply under 70 words."
      : "You are a strict but kind English teacher. Always reply in simple English. If the user makes grammar or vocabulary mistakes, first correct their sentence, then briefly explain the mistake, then ask a short follow-up question to keep the conversation going. Keep answers under 80 words.";

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
        max_tokens: 300,
      }),
      agent: insecureAgent,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("OpenRouter error:", res.status, errText);
      return `Sorry, AI service error. (status ${res.status})`;
    }

    const data = await res.json();

    let reply =
      data.choices?.[0]?.message?.content ||
      "Sorry, I couldn't generate a reply.";

    // just in case any tags appear
    reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    reply = reply.replace(/<think>[\s\S]*/gi, "").trim();
    reply = reply.replace(/<\/think>/gi, "").trim();

    if (!reply || reply.length < 2) {
      reply = "Thanks! Can you tell me more?";
    }

    return reply.trim();
  } catch (err) {
    console.error("Error calling OpenRouter:", err);
    return "Sorry, I couldn't respond. Try again.";
  }
}

// When a client connects
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("chatMessage", async (payload) => {
    // payload can be string (old) or { text, mode }
    let text;
    let mode;

    if (typeof payload === "string") {
      text = payload;
      mode = "free";
    } else {
      text = payload.text;
      mode = payload.mode || "free";
    }

    console.log(`User message [mode=${mode}]:`, text);

    // 1️⃣ Broadcast user's message
    const userPayload = {
      id: socket.id,
      from: "user",
      text,
      time: new Date().toISOString(),
    };
    io.emit("chatMessage", userPayload);

    // 2️⃣ Get AI reply using mode
    const replyText = await getAiReply(text, mode);

    // 3️⃣ Broadcast AI message
    const botPayload = {
      id: "bot",
      from: "bot",
      text: replyText,
      time: new Date().toISOString(),
    };
    io.emit("chatMessage", botPayload);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
