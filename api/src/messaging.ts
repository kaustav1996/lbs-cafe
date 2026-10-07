/**
 * Sending WhatsApp template messages. Production uses Meta's WhatsApp Cloud API once it's set up (part 2 of the
 * loyalty spec); until then nothing is configured and card sign-in says it's coming soon. Tests use LogMessenger.
 */
export interface Messenger {
  sendTemplate(phone: string, template: string, language: string, params: string[]): Promise<{ id: string }>;
}

/** Keeps what it was asked to send, so tests (and local runs) can read the codes. */
export class LogMessenger implements Messenger {
  sent: { phone: string; template: string; params: string[] }[] = [];
  async sendTemplate(phone: string, template: string, _language: string, params: string[]) {
    this.sent.push({ phone, template, params });
    return { id: `log-${this.sent.length}` };
  }
  lastCode(phone: string) {
    return [...this.sent].reverse().find(m => m.phone === phone && m.template === 'lbs_login_code')?.params[0];
  }
}

/** Local development only (CARD_CODES_IN_LOG=yes in .dev.vars): prints sign-in codes in the Worker log. */
export class ConsoleMessenger implements Messenger {
  async sendTemplate(phone: string, template: string, _language: string, params: string[]) {
    console.log(`[dev messenger] ${template} to ${phone}: ${params.join(', ')}`);
    return { id: `console-${Date.now()}` };
  }
}
