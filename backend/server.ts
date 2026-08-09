// server.ts
//
// TTB Label Verification API. Thin routing layer only: each endpoint
// parses the request, calls a service function, and shapes the
// response. No business logic here, that lives in services/. This
// keeps each service portable to a Lambda handler later without
// touching the underlying logic.
//
// Endpoints:
//   GET  /api/health         — liveness check
//   GET  /api/docs           — Swagger UI (current + planned endpoints)
//   POST /api/verify         — single label verification
//   POST /api/verify/batch   — batch label verification

import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./swagger-spec";

import { extractLabelFields } from "./services/extraction";
import { matchLabelToApplication, ApplicationData } from "./services/matching";
import { verifyBatch, BatchItem } from "./services/batch";

const app = express();
const PORT = process.env.PORT || 3002;
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

/**
 * GET /api/health
 */
app.get("/api/health", (req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "ttb-label-verify-backend",
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/docs
 */
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * POST /api/verify
 * multipart/form-data: labelImage + application fields.
 */
app.post(
  "/api/verify",
  upload.single("labelImage"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ ok: false, error: "labelImage is required" });
        return;
      }
      const extracted = await extractLabelFields(
        req.file.buffer,
        req.file.mimetype
      );
      const result = matchLabelToApplication(
        extracted,
        req.body as ApplicationData
      );
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ ok: false, error: message });
    }
  }
);

/**
 * POST /api/verify/batch
 * multipart/form-data: multiple labelImages[] + a JSON array of
 * matching application data under `applications`.
 */
app.post(
  "/api/verify/batch",
  upload.array("labelImages"),
  async (req: Request, res: Response) => {
    try {
      const applications: ApplicationData[] = JSON.parse(
        req.body.applications || "[]"
      );
      const files = (req.files as Express.Multer.File[]) || [];
      const items: BatchItem[] = files.map((file, i) => ({
        imageBuffer: file.buffer,
        mimeType: file.mimetype,
        applicationData: applications[i] || {}
      }));
      const results = await verifyBatch(items);
      res.json({ results });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ ok: false, error: message });
    }
  }
);

app.listen(PORT, () => {
  console.log(`ttb-label-verify-backend listening on port ${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/api/docs`);
});
