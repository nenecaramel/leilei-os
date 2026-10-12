import { Router, type RequestHandler } from "express";

// The existing /api/v1 Auth0 and ownership middleware protects this router.
// ElevenLabs credentials are server-only and are never returned to the device.
export type SpeechProviderConfig = {
  apiKey?: string;
  voiceId?: string;
  fetcher?: typeof fetch;
  onProviderDiagnostic?: (diagnostic: SpeechProviderDiagnostic) => void;
};

export type SpeechProviderDiagnostic = {
  kind: "provider_http" | "network_error" | "timeout";
  modelId: string;
  upstreamStatus?: number;
};

function publicProviderErrorCode(status: number): string {
  switch (status) {
    case 401: return "VOICE_PROVIDER_AUTH_FAILED";
    case 402: return "VOICE_PROVIDER_QUOTA_EXCEEDED";
    case 403: return "VOICE_PROVIDER_ACCESS_DENIED";
    case 404: return "VOICE_PROVIDER_VOICE_UNAVAILABLE";
    case 400:
    case 422: return "VOICE_PROVIDER_REQUEST_REJECTED";
    case 429: return "VOICE_PROVIDER_RATE_LIMITED";
    default: return "VOICE_PROVIDER_FAILURE";
  }
}

const MAX_TEXT_CHARACTERS = 1_200;
// V3 and V4 use the HTTP Text to Dialogue API; V4 Turbo requires a separate WebSocket transport.
const SPEECH_MODELS = new Set(["eleven_v3", "eleven_v4"]);
const DEFAULT_SPEECH_MODEL = "eleven_v4";
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;

export function createNativeLiveSpeechRouter(
  config: SpeechProviderConfig,
): Router {
  const router = Router();
  const fetcher = config.fetcher ?? fetch;
  const voiceId = config.voiceId?.trim();
  const apiKey = config.apiKey?.trim();
  const reportProviderFailure = config.onProviderDiagnostic ?? ((diagnostic: SpeechProviderDiagnostic) => {
    // Never log the provider response body, API key, user speech or exception message.
    console.warn(JSON.stringify({ event: "elevenlabs_speech_failure", ...diagnostic }));
  });
  const configured = Boolean(
    apiKey && voiceId && /^[A-Za-z0-9]{10,80}$/u.test(voiceId),
  );

  const requireUser: RequestHandler = (request, response, next) => {
    if (!request.webUserId) {
      response.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Sign in required." },
      });
      return;
    }
    next();
  };
  router.use(requireUser);

  router.get("/status", (_request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.json({ success: true, data: { configured } });
  });

  router.post("/speak", async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    if (!configured || !voiceId || !apiKey) {
      response.status(503).json({
        success: false,
        error: { code: "VOICE_UNAVAILABLE", message: "Voice service is not configured." },
      });
      return;
    }

    const raw = request.body;
    const text = raw && typeof raw === "object"
      && !Array.isArray(raw) && typeof raw.text === "string"
        ? raw.text.trim()
        : "";
    if (!text || text.length > MAX_TEXT_CHARACTERS) {
      response.status(400).json({
        success: false,
        error: { code: "INVALID_VOICE_TEXT", message: "Speech text is missing or too long." },
      });
      return;
    }

    const modelId = raw && typeof raw === "object" && !Array.isArray(raw)
      && "model_id" in raw ? raw.model_id : DEFAULT_SPEECH_MODEL;
    if (typeof modelId !== "string" || !SPEECH_MODELS.has(modelId)) {
      response.status(400).json({
        success: false,
        error: { code: "INVALID_VOICE_MODEL", message: "Unsupported speech model." },
      });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const upstream = await fetcher(
        "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128",
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
          },
          body: JSON.stringify({
            inputs: [{ text, voice_id: voiceId }],
            model_id: modelId,
          }),
          signal: controller.signal,
        },
      );

      if (!upstream.ok) {
        reportProviderFailure({ kind: "provider_http", upstreamStatus: upstream.status, modelId });
        // Do not read or echo the provider response body: it may contain private content.
        await upstream.body?.cancel().catch(() => undefined);
        response.status(502).json({
          success: false,
          error: { code: publicProviderErrorCode(upstream.status), message: "ElevenLabs rejected the speech request." },
        });
        return;
      }
      const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";
      const claimedBytes = Number(upstream.headers.get("content-length") ?? 0);
      if (!contentType.startsWith("audio/") || claimedBytes > MAX_AUDIO_BYTES) {
        await upstream.body?.cancel();
        response.status(502).json({
          success: false,
          error: { code: "INVALID_VOICE_RESPONSE", message: "Invalid speech response." },
        });
        return;
      }
      // Bound the response during download, even if the provider omits Content-Length.
      const reader = upstream.body?.getReader();
      if (!reader) {
        response.status(502).json({
          success: false,
          error: { code: "INVALID_VOICE_RESPONSE", message: "Empty speech response." },
        });
        return;
      }
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let exceeded = false;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        totalBytes += chunk.value.byteLength;
        if (totalBytes > MAX_AUDIO_BYTES) {
          exceeded = true;
          await reader.cancel();
          break;
        }
        chunks.push(chunk.value);
      }
      if (exceeded || totalBytes === 0) {
        response.status(502).json({
          success: false,
          error: { code: "INVALID_VOICE_RESPONSE", message: "Speech response too large or empty." },
        });
        return;
      }
      response.type("audio/mpeg").send(Buffer.concat(chunks.map((x) => Buffer.from(x)), totalBytes));
    } catch (error) {
      const timedOut = controller.signal.aborted
        || (error instanceof Error && error.name === "AbortError");
      reportProviderFailure({ kind: timedOut ? "timeout" : "network_error", modelId });
      response.status(502).json({
        success: false,
        error: { code: timedOut ? "VOICE_PROVIDER_TIMEOUT" : "VOICE_PROVIDER_FAILURE", message: "Speech provider unavailable." },
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  return router;
}
