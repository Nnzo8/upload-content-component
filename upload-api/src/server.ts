import cors from 'cors';
import * as dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { Readable } from 'stream';
import multer from 'multer';

dotenv.config();

const app = express();

// ─── Security Configurations ──────────────────────────────────────────────
// Limit file size to 5MB to prevent memory-based DoS attacks
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } 
});

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];

const PORT = process.env.PORT || 3000;
const FILESTACK_API_KEY = process.env.FILESTACK_API_KEY;

if (!FILESTACK_API_KEY) {
  console.error('ERROR: FILESTACK_API_KEY is not set in .env');
  process.exit(1);
}

const ALLOWED_ORIGINS = ['http://localhost:4200', 'https://your-production-domain.com'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
  })
);

// ─── Routes ──────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.post(
  '/api/upload',
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      // 1. Check if file exists
      if (!req.file) {
        res.status(400).json({ error: 'No file provided.' });
        return;
      }

      // 2. Validate File Type on the server (do not trust browser mimetype)
      if (!ALLOWED_MIMETYPES.includes(req.file.mimetype)) {
        res.status(400).json({ error: 'Invalid file type.' });
        return;
      }

      const { originalname, mimetype, buffer } = req.file;

      // 3. Build Form Data for Filestack
      const form = new FormData();
      form.append('fileUpload', Readable.from(buffer), {
        filename: originalname,
        contentType: mimetype,
        knownLength: buffer.length
      });

      const filestackUrl = `https://www.filestackapi.com/api/store/S3?key=${FILESTACK_API_KEY}`;

      const filestackRes = await fetch(filestackUrl, {
        method: 'POST',
        body: form,
        headers: form.getHeaders()
      });

      if (!filestackRes.ok) {
        const text = await filestackRes.text();
        res.status(502).json({ error: 'Filestack upload failed.', detail: text });
        return;
      }

      const data = await filestackRes.json() as any;

      res.json({
        url: data.url,
        handle: data.handle,
        filename: data.filename ?? originalname,
        size: data.size,
        mimetype: data.mimetype ?? mimetype
      });
    } catch (err) {
      console.error('Proxy upload error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Secure upload-api running on http://localhost:${PORT}`);
});