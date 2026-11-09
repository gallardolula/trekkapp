/** Sending mail, and what happens when there is nowhere to send it.
 *
 *  One address to reach, the person registering, and one thing to say to
 *  them. So this is a transport and a template and nothing more; a mail
 *  library with layouts and queues would be more machinery than the single
 *  message this server sends.
 *
 *  Configured through the environment because the credential is a secret
 *  that belongs to whoever runs the server, not to the repository. With
 *  Gmail, SMTP_PASS is an application password generated for this server
 *  and never the account's own password, which Google no longer accepts
 *  over SMTP anyway.
 *
 *  Unconfigured, it does not fail. It writes the message to the log and
 *  keeps it in memory, which is what lets the tests read a code and what
 *  lets somebody run the server locally without a mail account. The
 *  warning at startup is deliberately loud, because a server that silently
 *  stopped delivering codes looks exactly like one that works.
 */
import { createTransport, type Transporter } from 'nodemailer';

export interface Message {
  to: string;
  subject: string;
  text: string;
}

/** Messages that were never sent, newest last. Only filled while unconfigured. */
export const outbox: Message[] = [];

/** Forgets the captured messages, so one test cannot read another's. */
export function clearOutbox(): void {
  outbox.length = 0;
}

let transport: Transporter | null = null;
let announced = false;

/** Whether a real transport is configured, which the startup log reports. */
export function mailConfigured(): boolean {
  return Boolean(process.env['SMTP_HOST'] && process.env['SMTP_USER'] && process.env['SMTP_PASS']);
}

function reach(): Transporter | null {
  if (!mailConfigured()) return null;
  if (!transport) {
    const port = Number(process.env['SMTP_PORT'] ?? 587);
    transport = createTransport({
      host: process.env['SMTP_HOST'],
      port,
      // 465 is implicit TLS; 587 opens plainly and upgrades with STARTTLS.
      secure: port === 465,
      auth: { user: process.env['SMTP_USER']!, pass: process.env['SMTP_PASS']! },
    });
  }
  return transport;
}

/** Who the message comes from, which Gmail requires to be the account. */
function sender(): string {
  return process.env['MAIL_FROM'] ?? process.env['SMTP_USER'] ?? 'trekkapp@localhost';
}

/**
 * Sends a message, or records it when there is no transport.
 *
 * Never throws. A code that could not be delivered is a reason to tell the
 * person to ask for another one, not to fail their registration half way
 * through and leave an account behind that they cannot reach.
 */
export async function sendMail(message: Message): Promise<{ delivered: boolean }> {
  const to = reach();

  if (!to) {
    if (!announced) {
      announced = true;
      console.warn(
        'mail is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS): ' +
          'verification codes are written to this log and delivered to nobody',
      );
    }
    outbox.push(message);
    console.info(`mail not sent to ${message.to}: ${message.text.replace(/\s+/g, ' ').trim()}`);
    return { delivered: false };
  }

  try {
    await to.sendMail({ from: sender(), to: message.to, subject: message.subject, text: message.text });
    return { delivered: true };
  } catch (error) {
    console.error(`mail to ${message.to} failed: ${(error as Error).message}`);
    return { delivered: false };
  }
}

/** The one message this server sends. */
export function verificationMessage(code: string, minutes: number): Omit<Message, 'to'> {
  return {
    subject: `${code} es tu código de TrekkApp`,
    text:
      `Tu código para confirmar la dirección es ${code}.\n\n` +
      `Vence en ${minutes} minutos y sirve una sola vez.\n\n` +
      'Si no te registraste en TrekkApp, podés ignorar este mensaje. ' +
      'Sin el código la cuenta no se crea.\n',
  };
}
