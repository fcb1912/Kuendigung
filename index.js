require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;
const tokens = new Map();

app.use(express.json());
app.use(cors({
  origin: [
    "https://fcb1912.github.io",
    "http://localhost:5500",
    "null"
  ]
}));

function berechneAlter(geburtsdatum) {
  const heute = new Date();
  const geb = new Date(geburtsdatum);
  let alter = heute.getFullYear() - geb.getFullYear();
  const m = heute.getMonth() - geb.getMonth();
  if (m < 0 || (m === 0 && heute.getDate() < geb.getDate())) {
    alter--;
  }
  return alter;
}

app.post("/submit", async (req, res) => {
  const { mitglied_vorname, mitglied_nachname, geburtsdatum, email, telefon, bemerkung, elternName } = req.body;

  if (!email || email.trim() === "") {
    return res.status(400).json({ ok: false, message: "Keine gültige E-Mailadresse angegeben." });
  }

  const alter = berechneAlter(geburtsdatum);
  const token = crypto.randomUUID();
  tokens.set(token, { vorname: mitglied_vorname, nachname: mitglied_nachname, geburtsdatum, email, telefon, bemerkung, elternName, alter });

  try {
    const empfaengerText = alter < 18 ? (elternName || "Erziehungsberechtigter") : mitglied_vorname;
    const verifyLink = `https://kuendigung.onrender.com/verify?token=${token}`;

    await axios.post("https://api.brevo.com/v3/smtp/email", {
      sender: { email: "mitglieder@fc-badenia-stilgen.de" },
      to: [{ email }],
      subject: "Bitte bestätigen Sie die Kündigung",
      textContent: `Hallo ${empfaengerText},

Bitte bestätigen Sie die Kündigung von ${mitglied_vorname} ${mitglied_nachname}.
Hier der Bestätigungslink:
${verifyLink}

Sportliche Grüße,
FC Badenia St. Ilgen`,
      htmlContent: `
        <p>Hallo ${empfaengerText},</p>
        <p>Bitte bestätigen Sie die Kündigung von <strong>${mitglied_vorname} ${mitglied_nachname}</strong>.</p>
        <p>
          <a href="${verifyLink}" style="display:inline-block;padding:10px 14px;background:#b30000;color:#fff;text-decoration:none;border-radius:4px;">
            Kündigung bestätigen
          </a>
        </p>
        <p>Falls der Button nicht funktioniert, nutzen Sie diesen Link:<br>
          <a href="${verifyLink}">${verifyLink}</a>
        </p>
        <p>Sportliche Grüße,<br>FC Badenia St. Ilgen</p>
      `
    }, {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json"
      }
    });

    res.json({ ok: true, message: "Bestätigungsmail gesendet." });
  } catch (err) {
    console.error("❌ Fehler beim Mailversand:", err.response?.data || err.message);
    res.status(500).json({ ok: false, message: "Fehler beim Mailversand." });
  }
});

app.get("/verify", async (req, res) => {
  const { token } = req.query;
  const data = tokens.get(token);

  if (!data) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="de">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Ungültiger Link</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #fff0f0; color: #990000; text-align: center; padding: 2rem; }
          .box { background: #fff; border: 2px solid #990000; border-radius: 8px; padding: 2rem; max-width: 500px; margin: auto; }
          h1 { margin-bottom: 1rem; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>❌ Ungültiger oder abgelaufener Link</h1>
          <p>Bitte prüfen Sie Ihre E-Mail oder wenden Sie sich an den Verein.</p>
        </div>
      </body>
      </html>
    `);
  }

  try {
    let adminText = `✅ Wir haben Ihre Kündigung erhalten und werden sie schnellstmöglich bestätigen.\n\n`;
    adminText += `--- Mitgliedsdaten ---\n`;
    adminText += `Name: ${data.vorname} ${data.nachname}\n`;
    adminText += `Geburtsdatum: ${data.geburtsdatum} (Alter: ${data.alter})\n\n`;
    adminText += `--- Kontakt ---\n`;
    adminText += `E-Mail: ${data.email}\n`;
    adminText += `Telefon: ${data.telefon || "-"}\n\n`;
    if (data.alter < 18) {
      adminText += `--- Erziehungsberechtigte Person ---\n${data.elternName || "-"}\n\n`;
    }
    if (data.bemerkung) {
      adminText += `--- Bemerkung ---\n${data.bemerkung}\n\n`;
    }

    await axios.post("https://api.brevo.com/v3/smtp/email", {
      sender: { email: "mitglieder@fc-badenia-stilgen.de" },
      to: [{ email: data.email }],
      cc: [{ email: "mitglieder@fc-badenia-stilgen.de" }],
      subject: `Kündigung von ${data.vorname} ${data.nachname}`,
      textContent: adminText,
      htmlContent: `
        <h2>✅ Wir haben Ihre Kündigung erhalten</h2>
        <p>Wir werden sie schnellstmöglich bestätigen.</p>
        <h3>Mitgliedsdaten</h3>
        <p><strong>Name:</strong> ${data.vorname} ${data.nachname}<br>
        <strong>Geburtsdatum:</strong> ${data.geburtsdatum} (Alter: ${data.alter})</p>
        <h3>Kontakt</h3>
        <p><strong>E-Mail:</strong> ${data.email}<br>
        <strong>Telefon:</strong> ${data.telefon || "-"}</p>
        ${data.alter < 18 ? `<h3>Erziehungsberechtigte Person</h3><p>${data.elternName || "-"}</p>` : ""}
        ${data.bemerkung ? `<h3>Bemerkung</h3><p>${data.bemerkung}</p>` : ""}
      `
    }, {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json"
      }
    });

    res.send(`
      <!DOCTYPE html>
      <html lang="de">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>E-Mailadresse bestätigt</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #222; text-align: center; padding: 2rem; }
          .box { background: #ffffff; border: 2px solid #b30000; border-radius: 8px; padding: 2rem; max-width: 500px; margin: auto; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
          h1 { color: #b30000; margin-bottom: 1rem; }
          button { margin-top: 2rem; padding: 0.6rem 1.2rem; background: #b30000; color: #fff; border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; }
          button:hover { background: #990000; }
        </style>
      </head>
      <body>
        <div class="box">
          <p>Die E-Mailadresse wurde erfolgreich bestätigt.</p>
          <button onclick="window.close()">Fenster schließen</button>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ Fehler beim Admin-Mailversand:",