import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import * as querystring from 'querystring';
import * as fs from 'fs';
import * as path from 'path';

type SendConfirmationEmailParams = {
  to: string;
  operationId: number;
  confirmationLink: string;
  clientLabel?: string | null;
  tokenTtlMinutes: number;
  /** Asunto personalizado. Si se omite se usa uno por defecto. */
  subject?: string | null;
  /** Cuerpo de contexto (texto plano, admite saltos de linea). */
  bodyMessage?: string | null;
  /** Nombre del/los servicio(s) de la operación, usado en asunto y encabezado por defecto. */
  serviceLabel?: string | null;
  /** Código de servicio que el cliente reconoce (el que ellos mismos radicaron). */
  serviceCode?: string | null;
};

type SendLiquidationEmailParams = {
  to: string[];
  operationId: number;
  liquidationLink: string;
  clientLabel?: string | null;
  serviceLabel?: string | null;
  serviceCode?: string | null;
};

type SendConfirmationEmailResult = {
  sent: boolean;
  reason?: string;
  messageId?: string;
};

// ─────────────────────────── Identidad visual CARGOBAN ───────────────────────────
const BRAND = {
  navy: '#152A56',
  navySoft: '#1F3A73',
  green: '#8DC63F',
  teal: '#3EC6C6',
  bg: '#eef1f6',
  cardBg: '#ffffff',
  border: '#e5e7eb',
  textMuted: '#6b7280',
  textLabel: '#9ca3af',
  textDark: '#111827',
  textBody: '#374151',
  pillBg: '#E1F5EE',
  pillText: '#0F6E56',
  warnBg: '#FAEEDA',
  warnText: '#854F0B',
  link: '#185FA5',
};

const LOGO_CID = 'cargobanLogo';

@Injectable()
export class OperationEmailService {
  private readonly logger = new Logger(OperationEmailService.name);
  private logoAttachmentCache: Record<string, unknown> | null | undefined;

  async sendSpecialOperationConfirmationEmail(
    params: SendConfirmationEmailParams,
  ): Promise<SendConfirmationEmailResult> {
    return this.sendViaGraphApi(params);
  }

  async sendLiquidationEmail(
    params: SendLiquidationEmailParams,
  ): Promise<SendConfirmationEmailResult> {
    const recipients = params.to.filter((email) => this.isValidEmail(email));
    if (recipients.length === 0) {
      return { sent: false, reason: 'No hay correos de liquidacion validos para esta operacion' };
    }

    try {
      const token = await this.getGraphToken();

      const subjectPrefix =
        process.env.CONFIRMATION_EMAIL_SUBJECT_PREFIX || 'PlannerOP';
      const serviceCode = (params.serviceCode || params.serviceLabel || '').trim();
      const headingSuffix = serviceCode || `Operación #${params.operationId}`;
      const subject = `[${subjectPrefix}] Radicado pendiente — ${headingSuffix}`;

      const clientLabel = params.clientLabel?.trim() || '';
      const now = new Date();
      const dateLabel = now.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });

      const html = `
        <div style="background:${BRAND.bg};padding:24px;font-family:Arial,sans-serif;">
          <div style="max-width:580px;margin:0 auto;background:${BRAND.cardBg};border-radius:12px;border:1px solid ${BRAND.border};overflow:hidden;">

            ${this.renderHeader()}

            <div style="padding:28px 32px 0;">
              <p style="font-size:13px;color:${BRAND.textMuted};margin:0 0 4px;">Estimado equipo de liquidación,</p>
              <h2 style="font-size:18px;font-weight:600;color:${BRAND.textDark};margin:0 0 16px;">
                Servicio confirmado — ${this.escapeHtml(headingSuffix)}
              </h2>

              <p style="font-size:14px;color:${BRAND.textBody};line-height:1.7;margin:0 0 20px;">
                El Supervisor ha confirmado el servicio. Por favor ingrese el número de radicado en el portal adjunto para completar el proceso de liquidación.
              </p>

              <div style="background:#f9fafb;border-radius:8px;border:1px solid ${BRAND.border};padding:16px 20px;margin-bottom:24px;">
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding:6px 0;width:50%;">
                      <p style="font-size:11px;color:${BRAND.textLabel};margin:0 0 2px;text-transform:uppercase;letter-spacing:0.5px;">Código de servicio</p>
                      <p style="font-size:14px;font-weight:600;color:${BRAND.textDark};margin:0;">${this.escapeHtml(headingSuffix)}</p>
                    </td>
                    <td style="padding:6px 0;width:50%;">
                      <p style="font-size:11px;color:${BRAND.textLabel};margin:0 0 2px;text-transform:uppercase;letter-spacing:0.5px;">Estado</p>
                      <p style="margin:0;"><span style="background:${BRAND.pillBg};color:${BRAND.pillText};font-size:12px;padding:2px 10px;border-radius:20px;">Confirmado por el supervisor</span></p>
                    </td>
                  </tr>
                  ${clientLabel ? `
                  <tr>
                    <td style="padding:6px 0;" colspan="2">
                      <p style="font-size:11px;color:${BRAND.textLabel};margin:0 0 2px;text-transform:uppercase;letter-spacing:0.5px;">Cliente</p>
                      <p style="font-size:14px;font-weight:600;color:${BRAND.textDark};margin:0;">${this.escapeHtml(clientLabel)}</p>
                    </td>
                  </tr>` : ''}
                  <tr>
                    <td style="padding:6px 0;" colspan="2">
                      <p style="font-size:11px;color:${BRAND.textLabel};margin:0 0 2px;text-transform:uppercase;letter-spacing:0.5px;">Fecha de confirmación</p>
                      <p style="font-size:14px;font-weight:600;color:${BRAND.textDark};margin:0;">${dateLabel}</p>
                    </td>
                  </tr>
                </table>
              </div>

              <div style="text-align:center;margin-bottom:24px;">
                <a href="${params.liquidationLink}" style="display:inline-block;background:${BRAND.navy};color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
                  Ingresar radicado
                </a>
              </div>

              <div style="border:1px solid ${BRAND.border};border-radius:8px;padding:12px 16px;margin-bottom:24px;">
                <p style="font-size:12px;color:${BRAND.textMuted};margin:0 0 4px;">Si el botón no funciona, copie este enlace en su navegador:</p>
                <p style="font-size:12px;color:${BRAND.link};word-break:break-all;margin:0;">${params.liquidationLink}</p>
              </div>
            </div>

            ${this.renderFooter(params.operationId)}

          </div>
        </div>
      `;

      const mailFrom = process.env.MAIL_FROM!;
      const payload = JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: recipients.map((email) => ({ emailAddress: { address: email } })),
          attachments: this.getLogoAttachments(),
        },
        saveToSentItems: false,
      });

      await this.graphRequest(token, mailFrom, payload);

      this.logger.log(
        '[Graph] Correo de liquidacion enviado para operacion ' + params.operationId + ' a [' + recipients.join(', ') + ']',
      );

      return { sent: true };
    } catch (error: any) {
      this.logger.error(
        `[Graph] Error enviando correo de liquidacion para operacion ${params.operationId}: ${error?.message || 'unknown'}`,
      );
      return { sent: false, reason: error?.message || 'Error al enviar correo via Graph API' };
    }
  }

  // ─────────────────────────── Microsoft Graph API ───────────────────────────

  private async getGraphToken(): Promise<string> {
    const tenantId = process.env.AZURE_TENANT_ID!;
    const clientId = process.env.AZURE_CLIENT_ID!;
    const clientSecret = process.env.AZURE_CLIENT_SECRET!;

    const body = querystring.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'login.microsoftonline.com',
        path: `/${tenantId}/oauth2/v2.0/token`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.access_token) {
              resolve(json.access_token);
            } else {
              reject(new Error(`Error obteniendo token: ${json.error_description || data}`));
            }
          } catch {
            reject(new Error(`Respuesta inesperada del token endpoint: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private async sendViaGraphApi(
    params: SendConfirmationEmailParams,
  ): Promise<SendConfirmationEmailResult> {
    if (!this.isValidEmail(params.to)) {
      return { sent: false, reason: `Correo destino invalido: ${params.to}` };
    }

    try {
      const token = await this.getGraphToken();

      const subjectPrefix =
        process.env.CONFIRMATION_EMAIL_SUBJECT_PREFIX || 'PlannerOP';
      const serviceCode = (params.serviceCode || params.serviceLabel || '').trim();
      const headingSuffix = serviceCode || `Operación #${params.operationId}`;
      const customSubject = (params.subject || '').trim();
      const subject = customSubject
        ? customSubject
        : `[${subjectPrefix}] Servicios por aprobar — ${headingSuffix}`;

      const customBody = (params.bodyMessage || '').trim();
      const defaultBodyText =
        `Tiene servicios pendientes de aprobación (${headingSuffix}). ` +
        'Use el siguiente enlace para aprobar o rechazar el servicio.';
      const bodyText = customBody || defaultBodyText;
      const bodyHtml = this.escapeHtml(bodyText).replace(/\n/g, '<br/>');

      const now = new Date();
      const dateLabel = now.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });

      const html = `
        <div style="background:${BRAND.bg};padding:24px;font-family:Arial,sans-serif;">
          <div style="max-width:580px;margin:0 auto;background:${BRAND.cardBg};border-radius:12px;border:1px solid ${BRAND.border};overflow:hidden;">

            ${this.renderHeader()}

            <div style="padding:28px 32px 0;">
              <p style="font-size:13px;color:${BRAND.textMuted};margin:0 0 4px;">Estimado cliente,</p>
              <h2 style="font-size:18px;font-weight:600;color:${BRAND.textDark};margin:0 0 16px;">Servicios por aprobar — ${this.escapeHtml(headingSuffix)}</h2>

              <p style="font-size:14px;color:${BRAND.textBody};line-height:1.7;margin:0 0 20px;">
                ${bodyHtml}
              </p>

              <div style="background:#f9fafb;border-radius:8px;border:1px solid ${BRAND.border};padding:16px 20px;margin-bottom:24px;">
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding:6px 0;width:50%;">
                      <p style="font-size:11px;color:${BRAND.textLabel};margin:0 0 2px;text-transform:uppercase;letter-spacing:0.5px;">Código de servicio</p>
                      <p style="font-size:14px;font-weight:600;color:${BRAND.textDark};margin:0;">${this.escapeHtml(headingSuffix)}</p>
                    </td>
                    <td style="padding:6px 0;width:50%;">
                      <p style="font-size:11px;color:${BRAND.textLabel};margin:0 0 2px;text-transform:uppercase;letter-spacing:0.5px;">Estado</p>
                      <p style="margin:0;"><span style="background:${BRAND.pillBg};color:${BRAND.pillText};font-size:12px;padding:2px 10px;border-radius:20px;">Pendiente de confirmación</span></p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;">
                      <p style="font-size:11px;color:${BRAND.textLabel};margin:0 0 2px;text-transform:uppercase;letter-spacing:0.5px;">Vigencia del enlace</p>
                      <p style="font-size:14px;font-weight:600;color:${BRAND.textDark};margin:0;">${params.tokenTtlMinutes} minutos</p>
                    </td>
                    <td style="padding:6px 0;">
                      <p style="font-size:11px;color:${BRAND.textLabel};margin:0 0 2px;text-transform:uppercase;letter-spacing:0.5px;">Fecha</p>
                      <p style="font-size:14px;font-weight:600;color:${BRAND.textDark};margin:0;">${dateLabel}</p>
                    </td>
                  </tr>
                </table>
              </div>

              <div style="text-align:center;margin-bottom:24px;">
                <a href="${params.confirmationLink}" style="display:inline-block;background:${BRAND.navy};color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
                  Abrir portal
                </a>
              </div>

              <div style="border:1px solid ${BRAND.border};border-radius:8px;padding:12px 16px;margin-bottom:24px;">
                <p style="font-size:12px;color:${BRAND.textMuted};margin:0 0 4px;">Si el botón no funciona, copie este enlace en su navegador:</p>
                <p style="font-size:12px;color:${BRAND.link};word-break:break-all;margin:0;">${params.confirmationLink}</p>
              </div>

              <div style="background:${BRAND.warnBg};border-radius:8px;padding:12px 16px;margin-bottom:28px;">
                <p style="font-size:12px;color:${BRAND.warnText};margin:0;line-height:1.6;">
                  &#9200; Este enlace tiene una vigencia de <strong>${params.tokenTtlMinutes} minutos</strong> desde el momento en que fue generado. Si ha expirado, solicite un nuevo enlace al equipo de CARGOBAN.
                </p>
              </div>
            </div>

            ${this.renderFooter(params.operationId)}

          </div>
        </div>
      `;

      const mailFrom = process.env.MAIL_FROM!;
      const payload = JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: params.to } }],
          attachments: this.getLogoAttachments(),
        },
        saveToSentItems: false,
      });

      await this.graphRequest(token, mailFrom, payload);

      this.logger.log(
        `[Graph] Correo enviado para operacion ${params.operationId} a ${params.to}`,
      );

      return { sent: true };
    } catch (error: any) {
      this.logger.error(
        `[Graph] Error enviando correo para operacion ${params.operationId}: ${error?.message || 'unknown'}`,
      );
      return { sent: false, reason: error?.message || 'Error al enviar correo via Graph API' };
    }
  }

  // ─────────────────────────── Plantilla compartida ───────────────────────────

  private renderHeader(): string {
    const logo = this.getLogoAttachments().length
      ? `<img src="cid:${LOGO_CID}" alt="CARGOBAN" style="height:56px;display:block;" />`
      : `<span style="font-size:22px;font-weight:700;color:${BRAND.navy};letter-spacing:1px;">CARGOBAN</span>`;

    return `
      <div style="height:4px;background:linear-gradient(90deg, ${BRAND.green} 0%, ${BRAND.teal} 100%);"></div>
      <div style="background:#ffffff;padding:24px 32px;border-bottom:1px solid ${BRAND.border};">
        ${logo}
      </div>
    `;
  }

  private renderFooter(operationId: number): string {
    return `
      <div style="background:${BRAND.navy};padding:20px 32px;">
        <p style="font-size:12px;color:#ffffff;margin:0;font-weight:600;">CARGOBAN Operador Logístico y Portuario S.A.S.</p>
        <p style="font-size:11px;color:#c7d2e6;margin:4px 0 0;">Este es un mensaje automático, por favor no responda este correo.</p>
        <p style="font-size:10px;color:#8ea0c4;margin:8px 0 0;">Ref. interna: #${operationId}</p>
      </div>
    `;
  }

  /**
   * Adjunta el logo como imagen inline (cid) via Graph API para que se vea
   * embebido en el correo sin depender de que el cliente de correo cargue
   * imágenes externas. Se cachea en memoria tras la primera lectura.
   */
  private getLogoAttachments(): Record<string, unknown>[] {
    if (this.logoAttachmentCache === undefined) {
      try {
        const logoPath = path.join(process.cwd(), 'public', 'assets', 'cargoban-logo.png');
        const contentBytes = fs.readFileSync(logoPath).toString('base64');
        this.logoAttachmentCache = {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: 'cargoban-logo.png',
          contentType: 'image/png',
          contentBytes,
          isInline: true,
          contentId: LOGO_CID,
        };
      } catch (error: any) {
        this.logger.warn(`No se pudo cargar el logo para los correos: ${error?.message || 'unknown'}`);
        this.logoAttachmentCache = null;
      }
    }

    return this.logoAttachmentCache ? [this.logoAttachmentCache] : [];
  }

  private graphRequest(token: string, mailFrom: string, payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'graph.microsoft.com',
        path: `/v1.0/users/${encodeURIComponent(mailFrom)}/sendMail`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 202) {
            resolve();
          } else {
            reject(new Error(`Graph API respondió ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  private isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
