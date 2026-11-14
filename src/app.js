const express = require("express");
const path = require("node:path");
const systemInspector = require("./system-inspector");

function createApp(inspector = systemInspector) {
  const app = express();
  const publicDirectory = path.join(__dirname, "..", "public");
  app.disable("x-powered-by");

  for (const [route, method] of [
    ["/api/interfaces", "getInterfaces"],
    ["/api/ports", "getPorts"],
    ["/api/routes", "getRoutes"],
    ["/api/traffic", "getTrafficCounters"]
  ]) {
    app.get(route, async (request, response, next) => {
      try {
        response.json(await inspector[method]());
      } catch (error) {
        next(error);
      }
    });
    app.all(route, (request, response) => {
      response.set("Allow", "GET").status(405).json({ error: "Method not allowed" });
    });
  }

  app.use("/api", (request, response) => response.status(404).json({ error: "Not found" }));
  app.use(express.static(publicDirectory, { index: "index.html" }));
  app.use((request, response) => response.status(404).send("Not found"));
  app.use((error, request, response, next) => {
    console.error("Network inspection failed:", error);
    if (response.headersSent) return next(error);
    response.status(500).json({ error: "Unable to inspect local network data" });
  });
  return app;
}

module.exports = { createApp };
