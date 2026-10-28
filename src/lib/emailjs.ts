import { getAppSecret, updateSenderEmail } from "./db";
import { isVaultUnlocked, readVaultSecret, storeVaultSecret, deleteVaultSecret } from "./vault";

const SECRET_KEY = "emailjs_config";
const EMAILJS_SEND_URL = "https://api.emailjs.com/api/v1.0/email/send";

export interface EmailJsConfig {
  serviceId: string;
  templateId: string;
  publicKey: string;
  privateKey: string;
}

interface StoredEmailJsConfig extends EmailJsConfig {}

export interface EmailJsMessage {
  recipient: string;
  subject: string;
  html: string;
}

export function buildEmailJsPayload(config: EmailJsConfig, message: EmailJsMessage) {
  return {
    service_id: config.serviceId,
    template_id: config.templateId,
    user_id: config.publicKey,
    ...(config.privateKey ? { accessToken: config.privateKey } : {}),
    template_params: {
      to_email: message.recipient,
      subject: message.subject,
      html_body: message.html,
    },
  };
}

export async function emailJsConfigured() {
  return Boolean(await getAppSecret(`secret:${SECRET_KEY}`));
}

export async function getEmailJsConfigForUi() {
  const configured = await emailJsConfigured();
  if (!configured || !isVaultUnlocked()) {
    return { config: { serviceId: "", templateId: "", publicKey: "", privateKey: "" }, configured, privateKeyConfigured: false };
  }
  const stored = await readVaultSecret<StoredEmailJsConfig>(SECRET_KEY);
  return {
    config: { serviceId: stored?.serviceId ?? "", templateId: stored?.templateId ?? "", publicKey: stored?.publicKey ?? "", privateKey: "" },
    configured,
    privateKeyConfigured: Boolean(stored?.privateKey),
  };
}

export async function saveEmailJsConfig(input: Omit<EmailJsConfig, "privateKey"> & { privateKey?: string }) {
  if (!isVaultUnlocked()) throw new Error("Desbloquea la bóveda antes de guardar la configuración de EmailJS.");
  const serviceId = input.serviceId.trim();
  const templateId = input.templateId.trim();
  const publicKey = input.publicKey.trim();
  const privateKeyInput = input.privateKey?.trim() ?? "";
  if (!serviceId || !templateId || !publicKey) throw new Error("Completa el Service ID, Template ID y Public Key de EmailJS.");
  if ([serviceId, templateId, publicKey, privateKeyInput].some((value) => value.length > 300)) throw new Error("Revisa los datos de EmailJS; uno supera el tamaño permitido.");

  const current = await readVaultSecret<StoredEmailJsConfig>(SECRET_KEY);
  await storeVaultSecret(SECRET_KEY, {
    serviceId,
    templateId,
    publicKey,
    privateKey: privateKeyInput || current?.privateKey || "",
  } satisfies StoredEmailJsConfig);
  // Remove the previous direct SMTP credential when switching to EmailJS.
  await deleteVaultSecret("gmail_smtp_credentials");
  await updateSenderEmail(null);
}

async function loadEmailJsConfig() {
  if (!isVaultUnlocked()) throw new Error("Desbloquea la bóveda para enviar correo.");
  const config = await readVaultSecret<StoredEmailJsConfig>(SECRET_KEY);
  if (!config?.serviceId || !config.templateId || !config.publicKey) throw new Error("Configura EmailJS en Ajustes antes de enviar correo.");
  return config;
}

export async function sendEmailJsMessage(message: EmailJsMessage) {
  const config = await loadEmailJsConfig();
  const response = await fetch(EMAILJS_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildEmailJsPayload(config, message)),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/[\r\n\t]+/g, " ").slice(0, 300);
    throw new Error(`EmailJS respondió HTTP ${response.status}${detail ? `: ${detail}` : "."}`);
  }
}

export async function sendEmailJsTest(recipient: string) {
  if (!recipient) throw new Error("Configura el correo destinatario antes de enviar la prueba.");
  await sendEmailJsMessage({
    recipient,
    subject: "Prueba de envío · Vuela",
    html: "<!doctype html><html><body style=\"font-family:Arial,sans-serif;color:#26342c\"><h2>Vuela está conectado</h2><p>Este correo confirma que EmailJS puede enviar alertas desde Vuela.</p></body></html>",
  });
}
