require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// --- Logging in Datei (nur technische Daten) ---
const LOG_PATH = path.join(__dirname, "logs.txt");
function appendLog(entry) {
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
}
function logEvent(type, message, meta = {}) {
  const logEntry = { timestamp: new Date().toISOString(), type, message, meta };
  appendLog(logEntry);
  console.log(`[${type}] ${message}`, meta);
}

// --- CORS & JSON ---
app.use(express.json());
app.use(cors({
  origin: [
    "https://kuendigung.onrender.com",
    "http://localhost:5500",
    "null",
    "http://127.0.0.1:5500"
  ]
}));

// --- In-Memory Speicher für Codes ---
const tokens = new Map();

// --- Hilfsfunktionen ---
function berechneAlter(geburtsdatum) {
  const heute = new Date();
  const geb = new Date(geburtsdatum);
  let alter = heute.getFullYear() - geb.getFullYear();
  const m = heute.getMonth() - geb.getMonth();
  if (m < 0 || (m === 0 && heute.getDate() < geb.getDate())) alter--;
  return alter;
}
function hashValue(val) {
  return crypto.createHash("sha256").update(String(val)).digest("hex");
}
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// --- Konfiguration ---
const CODE_EXPIRE_MS = 10 * 60 * 1000; // 10 Min
const MAX_VERIFY_ATTEMPTS = 5;

// --- Submit Route ---
app.post("/submit", async (req, res) => {
  try {
    const { mitglied_vorname, mitglied_nachname, geburtsdatum, email, telefon, bemerkung, elternName } = req.body || {};
    if (!email || !telefon) {
      logEvent("WARN", "Ungültige Anfrage auf /submit", { reason: "missing_contact_fields" });
      return res.status(400).json({ ok: false, message: "E-Mail und Telefon sind erforderlich." });
    }

    const alter = berechneAlter(geburtsdatum);
    const code = generateCode();
    const codeHash = hashValue(code);

    tokens.set(code, {
      data: { vorname: mitglied_vorname || "", nachname: mitglied_nachname || "", geburtsdatum: geburtsdatum || "", email, telefon, bemerkung: bemerkung || "", elternName: elternName || "", alter },
      created: Date.now(),
      attempts: 0
    });

    logEvent("INFO", "Bestätigungscode erzeugt", { codeHash, expireMs: CODE_EXPIRE_MS });

    const empfaengerText = alter < 18 ? (elternName || "Erziehungsberechtigte Person") : (mitglied_vorname || "Mitglied");
    const emailHtml = `<div style="font-family:Arial,sans-serif;">
        <p>Hallo ${empfaengerText},</p>
        <p>Ihr Bestätigungscode für die Kündigung lautet:</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:6px;margin:14px 0;color:#b30000;">
          ${code}
        </div>
        <p>Geben Sie diesen Code bitte auf der Bestätigungsseite ein. Der Code ist ${Math.floor(CODE_EXPIRE_MS/60000)} Minuten gültig.</p>
        <p>Sportliche Grüße,<br>FC Badenia St. Ilgen</p>
      </div>`;

    try {
      await axios.post(
        "https://api.brevo.com/v3/smtp/email",
        {
          sender: { email: "mitglieder@fc-badenia-stilgen.de" },
          to: [{ email }],
          subject: "Ihr Bestätigungscode zur Kündigung",
          htmlContent: emailHtml,
          textContent: `Ihr Bestätigungscode: ${code} — gültig ${Math.floor(CODE_EXPIRE_MS/60000)} Minuten.`
        },
        { headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" } }
      );
      logEvent("INFO", "Bestätigungsmail versandt", { codeHash });
      return res.json({ ok: true, message: "Bestätigungscode versendet." });
    } catch (err) {
      const brevoError = err.response?.data || err.message;
      logEvent("ERROR", "Fehler beim Mailversand", { codeHash, brevoError });
      console.error("Brevo Mail Error:", brevoError);
      return res.status(500).json({ ok: false, message: `Fehler beim Mailversand: ${brevoError?.message || brevoError}` });
    }

  } catch (err) {
    logEvent("ERROR", "Unhandled error in /submit", { error: err.message });
    return res.status(500).json({ ok: false, message: "Interner Serverfehler." });
  }
});

// --- Verify Code Route (unverändert, nur Logging erweitert) ---
app.post("/verify-code", async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code || !/^\d{6}$/.test(code)) {
      logEvent("WARN", "Verify attempt with invalid code format", {});
      return res.status(400).json({ ok: false, message: "Ungültiges Code-Format." });
    }

    const entry = tokens.get(code);
    if (!entry) {
      logEvent("WARN", "Ungültiger oder abgelaufener Code eingegeben", { codeHash: hashValue(code) });
      return res.json({ ok: false, message: "Ungültiger oder abgelaufener Code." });
    }

    if (Date.now() - entry.created > CODE_EXPIRE_MS) {
      tokens.delete(code);
      logEvent("INFO", "Code abgelaufen", { codeHash: hashValue(code) });
      return res.json({ ok: false, message: "Code abgelaufen." });
    }

    entry.attempts = (entry.attempts || 0) + 1;
    if (entry.attempts > MAX_VERIFY_ATTEMPTS) {
      tokens.delete(code);
      logEvent("WARN", "Max attempts exceeded for code", { codeHash: hashValue(code) });
      return res.json({ ok: false, message: "Zu viele Versuche. Neuer Code erforderlich." });
    }

    const data = entry.data;
    tokens.delete(code);

    const logoUrl = "https://kuendigung.onrender.com/logo.png";
    const htmlMail = `<div style="font-family:Arial,sans-serif; color:#222; padding:20px;">
      <div style="text-align:center; margin-bottom:20px;">
        <img src="${logoUrl}" alt="FC Badenia Logo" style="height:80px;">
      </div>
      <h2 style="color:#b30000;">Kündigung bestätigt</h2>
      <p>Wir haben Ihre Kündigung erhalten und werden sie schnellstmöglich bearbeiten.</p>
      <hr style="margin:20px 0;">
      <h3 style="color:#b30000;">Mitgliedsdaten</h3>
      <p><strong>Name:</strong> ${data.vorname} ${data.nachname}<br>
         <strong>Geburtsdatum:</strong> ${data.geburtsdatum} (Alter: ${data.alter})</p>
      <h3 style="color:#b30000;">Kontakt</h3>
      <p><strong>E-Mail:</strong> ${data.email}<br>
         <strong>Telefon:</strong> ${data.telefon}</p>
      ${data.alter < 18 ? `<h3 style="color:#b30000;">Erziehungsberechtigte Person</h3><p>${data.elternName || "-"}</p>` : ""}
      ${data.bemerkung ? `<h3 style="color:#b30000;">Bemerkung</h3><p>${data.bemerkung}</p>` : ""}
      <hr style="margin:20px 0;">
      <p>Sportliche Grüße<br>FC Badenia St. Ilgen</p>
    </div>`;

    const textMail = `Kündigung bestätigt\nName: ${data.vorname} ${data.nachname}\nGeburtsdatum: ${data.geburtsdatum} (Alter: ${data.alter})\nE-Mail: ${data.email}\nTelefon: ${data.telefon}\n${data.alter < 18 ? `Erziehungsberechtigte Person: ${data.elternName}\n` : ""}${data.bemerkung ? `Bemerkung: ${data.bemerkung}\n` : ""}`;

    try {
      await axios.post(
        "https://api.brevo.com/v3/smtp/email",
        {
          sender: { email: "mitglieder@fc-badenia-stilgen.de" },
          to: [{ email: data.email }],
          cc: [{ email: "mitglieder@fc-badenia-stilgen.de" }],
          subject: `Kündigung bestätigt – ${data.vorname} ${data.nachname}`,
          htmlContent: htmlMail,
          textContent: textMail
        },
        { headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" } }
      );
      logEvent("INFO", "Kündigung final bestätigt & Bestätigungsmail verschickt", { codeHash: hashValue(code) });
      return res.json({ ok: true, message: "Kündigung bestätigt." });
    } catch (err) {
      const brevoError = err.response?.data || err.message;
      logEvent("ERROR", "Fehler beim finalen Mailversand", { codeHash: hashValue(code), brevoError });
      console.error("Brevo Final Mail Error:", brevoError);
      return res.status(500).json({ ok: false, message: `Fehler beim finalen Mailversand: ${brevoError?.message || brevoError}` });
    }

  } catch (err) {
    logEvent("ERROR", "Unhandled error in /verify-code", { error: err.message });
    return res.status(500).json({ ok: false, message: "Interner Serverfehler." });
  }
});

// --- Periodic Cleanup ---
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of tokens.entries()) {
    if (now - entry.created > CODE_EXPIRE_MS) {
      tokens.delete(code);
      logEvent("INFO", "Token expired and removed (cleanup)", { codeHash: hashValue(code) });
    }
  }
}, 60 * 1000);

// --- Start Server ---
app.listen(PORT, () => {
  logEvent("INFO", `Server gestartet auf Port ${PORT}`, { port: PORT });
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
