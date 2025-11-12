const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());
app.use(cors({
  origin: [
    "https://fcb1912.github.io", // GitHub Pages
    "http://localhost:5500",     // Lokale Tests
    "null"                       // Direktes Öffnen der Datei im Browser
  ]
}));

// Nodemailer Transporter mit IONOS-SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.ionos.de",
  port: process.env.SMTP_PORT || 587,
  secure: false, // STARTTLS bei Port 587
  auth: {
    user: process.env.SMTP_USER, // z.B. info@fcbadenia.de
    pass: process.env.SMTP_PASS  // dein Mailpasswort
  }
});

// Route für Formular-Submit
app.post("/submit", async (req, res) => {
  const { mitglied_vorname, mitglied_nachname, email } = req.body;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: email,
      subject: "Kündigungsbestätigung",
      text: `Hallo ${mitglied_vorname} ${mitglied_nachname},\n\nIhre Kündigung ist eingegangen.\n\nSportliche Grüße,\nFC Badenia St. Ilgen`
    });

    res.json({ ok: true, message: "Bestätigungsmail gesendet." });
  } catch (err) {
    console.error("❌ Fehler beim Mailversand:", err);
    res.status(500).json({ ok: false, message: "Fehler beim Mailversand." });
  }
});

// Test-Route für Mailversand
app.get("/testmail", async (req, res) => {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.SMTP_USER, // Test an dich selbst
      subject: "Testmail vom FC Badenia Backend",
      text: "Dies ist eine Testmail, um den SMTP-Versand zu prüfen."
    });

    res.json({ ok: true, message: "Testmail gesendet." });
  } catch (err) {
    console.error("❌ Fehler bei Testmail:", err);
    res.status(500).json({ ok: false, message: "Fehler bei Testmail." });
  }
});

// Server starten
app.listen(PORT, () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
