import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Log incoming requests for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Serve static files from root directory
app.use(express.static(__dirname));

// Route aliases for clean navigation
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login_child_safety.html"));
});
app.get("/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "login_child_safety.html"));
});
app.get("/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "sign_up_child_safety.html"));
});
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "home_child_safety_v1.html"));
});

// Serve index.html for root path
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Handle 404
app.use((req, res) => {
  res.status(404).send("Page not found");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
