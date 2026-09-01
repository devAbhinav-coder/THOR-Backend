import logger from "../types/utils/logger";
import { whatsappConfig, whatsappEnabled } from "../config/whatsapp";

export type WhatsAppTemplateComponent = {
  type: "body" | "header" | "button";
  sub_type?: string;
  index?: string;
  parameters: Array<
    | { type: "text"; text: string }
    | { type: "payload"; payload: string }
  >;
};

export type WhatsAppSendResult = {
  ok: boolean;
  metaMessageId?: string;
  errorMessage?: string;
  statusCode?: number;
};

function messagesUrl(): string {
  return `https://graph.facebook.com/${whatsappConfig.graphVersion}/${whatsappConfig.phoneNumberId}/messages`;
}

function mediaUrl(): string {
  return `https://graph.facebook.com/${whatsappConfig.graphVersion}/${whatsappConfig.phoneNumberId}/media`;
}

export async function sendWhatsAppTemplate(opts: {
  to: string;
  template: string;
  bodyParams: string[];
  buttonUrl?: string;
}): Promise<WhatsAppSendResult> {
  if (!whatsappEnabled()) {
    return { ok: false, errorMessage: "WhatsApp not configured or disabled" };
  }
  if (!opts.template) {
    logger.warn({ msg: "whatsapp_template_missing", to: opts.to });
    return { ok: false, errorMessage: "Template name missing" };
  }

  const components: WhatsAppTemplateComponent[] = [];
  if (opts.bodyParams.length) {
    components.push({
      type: "body",
      parameters: opts.bodyParams.map((text) => ({
        type: "text",
        text: text.slice(0, 1024) || "-",
      })),
    });
  }
  if (opts.buttonUrl?.trim()) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: opts.buttonUrl.trim().slice(0, 1024) }],
    });
  }

  const body = {
    messaging_product: "whatsapp",
    to: opts.to,
    type: "template",
    template: {
      name: opts.template,
      language: { code: whatsappConfig.language },
      ...(components.length ? { components } : {}),
    },
  };

  try {
    const res = await fetch(messagesUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${whatsappConfig.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const errorMessage = errText.slice(0, 500) || `HTTP ${res.status}`;
      logger.warn({
        msg: "whatsapp_send_failed",
        status: res.status,
        template: opts.template,
        to: opts.to,
        error: errorMessage.slice(0, 400),
      });
      return { ok: false, errorMessage, statusCode: res.status };
    }

    const json = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
    };
    return { ok: true, metaMessageId: json.messages?.[0]?.id };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Network error";
    logger.warn({
      msg: "whatsapp_send_failed",
      template: opts.template,
      to: opts.to,
      error: errorMessage,
    });
    return { ok: false, errorMessage };
  }
}

/** Upload PDF/image to Meta — required before sending as WhatsApp document. */
export async function uploadWhatsAppMedia(opts: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}): Promise<{ ok: boolean; mediaId?: string; errorMessage?: string }> {
  if (!whatsappEnabled()) {
    return { ok: false, errorMessage: "WhatsApp not configured" };
  }

  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", opts.mimeType);
    form.append(
      "file",
      new Blob([Uint8Array.from(opts.buffer)], { type: opts.mimeType }),
      opts.filename,
    );

    const res = await fetch(mediaUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${whatsappConfig.accessToken}`,
      },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        ok: false,
        errorMessage: errText.slice(0, 400) || `Upload HTTP ${res.status}`,
      };
    }

    const json = (await res.json().catch(() => ({}))) as { id?: string };
    if (!json.id) {
      return { ok: false, errorMessage: "Media upload returned no id" };
    }
    return { ok: true, mediaId: json.id };
  } catch (err: unknown) {
    return {
      ok: false,
      errorMessage: err instanceof Error ? err.message : "Upload failed",
    };
  }
}

export async function sendWhatsAppDocument(opts: {
  to: string;
  mediaId: string;
  filename: string;
  caption?: string;
}): Promise<WhatsAppSendResult> {
  if (!whatsappEnabled()) {
    return { ok: false, errorMessage: "WhatsApp not configured" };
  }

  const body = {
    messaging_product: "whatsapp",
    to: opts.to,
    type: "document",
    document: {
      id: opts.mediaId,
      filename: opts.filename.slice(0, 240),
      ...(opts.caption ? { caption: opts.caption.slice(0, 1024) } : {}),
    },
  };

  try {
    const res = await fetch(messagesUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${whatsappConfig.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const errorMessage = errText.slice(0, 500) || `HTTP ${res.status}`;
      logger.warn({
        msg: "whatsapp_document_failed",
        to: opts.to,
        error: errorMessage.slice(0, 400),
      });
      return { ok: false, errorMessage, statusCode: res.status };
    }

    const json = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
    };
    return { ok: true, metaMessageId: json.messages?.[0]?.id };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Network error";
    return { ok: false, errorMessage };
  }
}

/** Strip scheme/host so Meta URL-button templates receive only the path suffix. */
export function whatsAppTemplateUrlSuffix(fullUrl: string): string {
  try {
    const u = new URL(fullUrl);
    const path = `${u.pathname}${u.search}${u.hash}`.replace(/^\//, "");
    return path || fullUrl;
  } catch {
    return fullUrl.replace(/^https?:\/\/[^/]+\/?/, "");
  }
}
